import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { z } from "zod";
import { wasNotStarted, type AgentResult, type NotStarted } from "../agents/agent-job.js";
import type { AgentRunners } from "../agents/agent-runners.js";
import { compiledFoldersIn } from "../compiled-source.js";
import type { QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import { measuredDuration } from "../diagnosis/diagnosis-service.js";
import { stageJobFolder } from "../diagnosis/job-folder.js";
import type { PromptPaths } from "../diagnosis/prompts.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { nextRecordId, noLabels, putRecord, type EvalRecord } from "../evals/eval-record.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { DiscoveryOptions, JobState } from "./discovery-state.js";

export type JobDependencies = {
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** One discovery job: its kind, record prefix, context and how to prompt and check it. */
export type DiscoveryJob<T> = {
  readonly kind: "rank" | "scenario";
  readonly label: string;
  /** Record IDs are `<prefix>/<attempt>`. */
  readonly recordPrefix: string;
  readonly subject: EvalRecord["subject"];
  readonly contextFolder: string;
  readonly contextHash: string;
  readonly snapshotFolder: string;
  readonly logsFolder: string;
  readonly promptVersion: string;
  readonly prompt: (paths: PromptPaths) => string;
  readonly schema: z.ZodType<T>;
  readonly validate: (output: T) => readonly string[];
};

export type JobInput = {
  readonly threadId: string;
  readonly options: DiscoveryOptions;
  /** Model time the thread's finished jobs used, in milliseconds. */
  readonly spentMs: number;
  readonly signal?: AbortSignal;
};

/** A job node's result: the job's new state and the model time to charge to the run budget. */
export type JobStep<T> = { readonly state: JobState<T>; readonly chargedMs: number };

/** Runs discovery jobs like diagnosis jobs: budget checked when a job gets its place, a scratch copy, a record per attempt. */
export class DiscoveryJobs {
  /** Model time the jobs finished in this process charged to each thread, before the graph state has them. */
  private readonly charged = new Map<string, number>();

  constructor(private readonly dependencies: JobDependencies) {}

  async waitForQuota(marks: readonly QuotaWaitMark[], signal?: AbortSignal): Promise<void> {
    await this.dependencies.quota.wait(marks.map((mark) => mark.processId), signal);
  }

  private spentMs(threadId: string, stateMs: number): number {
    return Math.max(stateMs, this.charged.get(threadId) ?? 0);
  }

  async run<T>(job: DiscoveryJob<T>, current: JobState<T>, input: JobInput, store: BaseStore): Promise<JobStep<T>> {
    const { options } = input;
    const budgetMs = options.agents.runBudgetMinutes * 60_000;
    const budgetSpent = () => this.spentMs(input.threadId, input.spentMs) >= budgetMs;
    const exhausted = (): JobStep<T> => {
      this.dependencies.log(`${job.label}: the run budget of ${options.agents.runBudgetMinutes} min is spent; not started.`);
      return { state: { ...current, status: "budget_exhausted", waiting: null }, chargedMs: 0 };
    };
    if (budgetSpent()) return exhausted();
    const { recordId, unlisted } = await nextRecordId(store, job.kind, job.recordPrefix, current.records.length);
    const choice = options.agents.jobs[job.kind];
    const scratch = this.dependencies.createScratchFolder("workflow-discovery-");
    let started = this.dependencies.now();
    let result: AgentResult<T> | NotStarted;
    try {
      const staged = { context: join(scratch.path, "context"), source: join(scratch.path, "source") };
      const paths: PromptPaths = { contextFolder: staged.context, snapshotFolder: staged.source, compiledFolders: compiledFoldersIn(job.snapshotFolder) };
      this.dependencies.log(`${job.label}: running on ${choice.provider} (${choice.model ?? "default model"}, effort ${choice.effort}).`);
      result = await this.dependencies.agents(options.agents).run<T>({
        kind: job.kind, label: job.label, choice, images: [], prompt: job.prompt(paths), schema: job.schema, validate: job.validate,
        workspace: { folder: staged.context, readOnly: [staged.source] },
        logFile: join(job.logsFolder, `${recordId.split("/").slice(1).join("-").replace(/[^A-Za-z0-9._-]+/g, "_")}.jsonl`),
        // The copy is made only when the job gets its place, so jobs that wait or are refused hold none.
        mayStart: () => {
          if (budgetSpent()) return false;
          stageJobFolder(staged, job.contextFolder, job.snapshotFolder);
          started = this.dependencies.now();
          return true;
        },
        onResult: (outcome) => {
          const charged = !outcome.ok && ["quota_exhausted", "infra", "timeout"].includes(outcome.failure.kind) ? 0 : measuredDuration(job.label, outcome);
          this.charged.set(input.threadId, this.spentMs(input.threadId, input.spentMs) + charged);
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } finally {
      try {
        // A copy that stays behind is only disk in a temporary folder, and failing here would discard the answer of a finished job: it is logged by name instead.
        scratch.remove();
      } catch (error) {
        this.dependencies.log(`${job.label}: the scratch copy ${scratch.path} could not be removed (${(error as Error).message}); remove it by hand.`);
      }
    }
    if (wasNotStarted(result)) return exhausted();
    const finished = this.dependencies.now();
    const durationMs = measuredDuration(job.label, result);
    await putRecord(store, {
      schemaVersion: 2, recordId, jobKind: job.kind, origin: "workflow", threadId: input.threadId, subject: job.subject, challenged: null,
      contextHash: job.contextHash, promptVersion: job.promptVersion, agent: { provider: choice.provider, model: choice.model, effort: choice.effort },
      startedUtc: started.toISOString(), finishedUtc: finished.toISOString(), durationMs, usage: result.usage,
      result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
      output: result.ok ? result.output : null, labels: noLabels,
    });
    const records = [...current.records, ...unlisted, recordId];
    if (result.ok) {
      this.dependencies.quota.reset();
      const answer = { recordId, provider: choice.provider, model: choice.model, effort: choice.effort, output: job.schema.parse(result.output) };
      return { state: { status: "done", answer, waiting: null, failure: null, records }, chargedMs: durationMs };
    }
    const failure = result.failure;
    this.dependencies.log(`${job.label}: ${failure.kind}: ${failure.message}`);
    if (failure.kind === "quota_exhausted") {
      const waiting: QuotaWaitMark = { job: job.kind, provider: choice.provider, since: finished.toISOString(), processId: this.dependencies.quota.processId, message: failure.message };
      return { state: { ...current, waiting, records }, chargedMs: 0 };
    }
    if (failure.kind === "infra" || failure.kind === "timeout") throw new SetupError(`${job.label} failed: ${failure.message} (record ${recordId})`);
    return { state: { status: "failed", answer: null, waiting: null, failure: { kind: failure.kind, message: failure.message }, records }, chargedMs: durationMs };
  }
}
