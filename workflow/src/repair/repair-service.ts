import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { wasNotStarted, type AgentFailure, type AgentResult, type NotStarted } from "../agents/agent-job.js";
import type { AgentRunners } from "../agents/agent-runners.js";
import type { CheckResult } from "../diagnosis/check.js";
import type { ClusterDiagnosis, QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import { measuredDuration, readSealedManifest } from "../diagnosis/diagnosis-service.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { nextRecordId, noLabels, putRecord, setLabels, type EvalRecord, type RepairStage } from "../evals/eval-record.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import { attemptFolder, writeArchive, type AttemptDocument } from "./attempt-archive.js";
import { judgeNarrowCheck, type AttemptBuild, type CheckRow, type NarrowCheck } from "./attempt-host.js";
import type { AttemptSummary, CheckExecution, ClusterRepair, RepairStatus, RepairUpdate } from "./cluster-repair.js";
import { computePatch, type Patch } from "./patch.js";
import { guardPatch } from "./patch-guard.js";
import { repairPrompt } from "./repair-prompt.js";
import { repairDocument, writeRepairDocument } from "./repair-report.js";
import { RepairOutputSchema, repairPromptVersion, validateRepair, type RepairOutput } from "./repair-schemas.js";
import { changesOutsideSource, stageWorkspace, workspaceIn, type AttemptWorkspace } from "./workspace.js";

export type RepairDependencies = {
  readonly threadFolder: (threadId: string) => string;
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly build: AttemptBuild;
  readonly narrowCheck: NarrowCheck;
  /** A scratch folder outside the repository, where an attempt gets its workspace. */
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

export type RepairInput = {
  readonly threadId: string;
  readonly options: RunOptions;
  readonly repair: ClusterRepair;
  readonly diagnosis: ClusterDiagnosis;
  readonly check: CheckResult;
  /** Model time the thread's finished jobs used, in milliseconds. */
  readonly spentMs: number;
  readonly signal?: AbortSignal;
};

export type RepairStep = { readonly update: RepairUpdate; readonly chargedMs: number };

/** How an attempt ended once its model job finished. */
type Ending = {
  readonly patch: Patch | null;
  readonly guard: readonly string[];
  readonly build: AttemptDocument["build"];
  readonly check: { readonly execution: CheckExecution; readonly rows: readonly CheckRow[] } | null;
  readonly stage: RepairStage | null;
  readonly reason: string | null;
};

/** The snapshot every attempt of a thread starts from: diagnosis's history-less copy of the source the candidate was built from. */
function snapshotFolder(threadFolder: string): string {
  return join(threadFolder, "diagnosis", "source");
}

/** Repair on the real host: one attempt per confirmed cluster, judged by the patch guard, the build and the narrow check. */
export class RepairService {
  /** Model time the attempts finished in this process charged to each thread, before the graph state has them. */
  private readonly charged = new Map<string, number>();

  constructor(private readonly dependencies: RepairDependencies) {}

  /** A pending repair for every cluster the check confirmed. */
  prepare(clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): Record<string, ClusterRepair> {
    const confirmed = Object.values(clusters).filter((cluster) => check?.clusters[cluster.clusterId]?.outcome === "confirmed");
    return Object.fromEntries(confirmed.map((cluster) => [cluster.clusterId, { clusterId: cluster.clusterId, status: "pending", attempt: null, earlier: [], waiting: null, records: [] }]));
  }

  async waitForQuota(marks: readonly QuotaWaitMark[], signal?: AbortSignal): Promise<void> {
    await this.dependencies.quota.wait(marks.map((mark) => mark.processId), signal);
  }

  /** Writes the thread's `repair.json` and returns its path. */
  finish(threadId: string, repairs: Readonly<Record<string, ClusterRepair>>): string {
    const path = join(this.dependencies.threadFolder(threadId), "repair.json");
    writeRepairDocument(path, repairDocument(threadId, repairs));
    return path;
  }

  async repair(input: RepairInput, store: BaseStore): Promise<RepairStep> {
    const { repair, diagnosis, options } = input;
    const clusterId = repair.clusterId;
    const label = `repair ${clusterId}`;
    const settings = options.repair;
    const choice = options.agents.jobs.repair;
    // A thread whose options lack the field was started by another version of the workflow and cannot be repaired.
    if (settings === null || settings === undefined || choice === undefined) throw new SetupError(`${label}: the thread was started without repair settings; start a new thread.`);
    const explanation = diagnosis.hypothesis?.output.explanation ?? null;
    if (explanation === null) throw new Error(`${label}: the cluster has no hypothesis to repair from.`);
    const budgetMs = options.agents.runBudgetMinutes * 60_000;
    const budgetSpent = () => this.spentMs(input.threadId, input.spentMs) >= budgetMs;
    if (budgetSpent()) return this.budgetExhausted(label, clusterId, options.agents.runBudgetMinutes);
    const manifest = readSealedManifest(diagnosis);
    const threadFolder = this.dependencies.threadFolder(input.threadId);
    const { recordId, attempt, unlisted } = await nextRecordId(store, "repair", `${input.threadId}/${clusterId}/repair`, repair.records.length);
    const records = [...repair.records, ...unlisted, recordId];
    const deadlineMs = settings.deadlineMinutes * 60_000;
    const scratch = this.dependencies.createScratchFolder("workflow-repair-");
    const workspace = workspaceIn(scratch, clusterId);
    let started = this.dependencies.now();
    try {
      const predicted = new Set([...(diagnosis.hypothesis?.output.explanation?.predictions ?? []), ...(diagnosis.challenge?.output.alternative?.predictions ?? [])]
        .map((prediction) => `${prediction.case}/${prediction.capture}`));
      const brief = {
        manifest, hypothesis: explanation, challenge: diagnosis.challenge?.output ?? null,
        observations: input.check.observations.filter((item) => predicted.has(`${item.case}/${item.capture}`)),
        earlier: (repair.earlier ?? []).map((item) => ({
          attempt: item.attempt, rejectedBy: item.rejectedBy, stage: item.stage, reason: item.reason, patch: patchText(item.archive),
        })),
      };
      this.dependencies.log(`${label}: running on ${choice.provider} (${choice.model ?? "default model"}, effort ${choice.effort}), deadline ${settings.deadlineMinutes} min.`);
      const ran: AgentResult<RepairOutput> | NotStarted = await this.dependencies.agents(options.agents).run<RepairOutput>({
        kind: "repair", label, prompt: repairPrompt(brief, { sourceFolder: workspace.source, contextFolder: workspace.context }),
        images: manifest.members.flatMap((member) => [join(workspace.context, member.canonicalCrop), join(workspace.context, member.candidateCrop)]),
        schema: RepairOutputSchema, validate: validateRepair,
        workspace: { folder: workspace.source, readOnly: [workspace.context], writable: true },
        // The deadline starts with the model job, so the job may not run past it.
        choice: { ...choice, timeoutMinutes: Math.min(choice.timeoutMinutes, settings.deadlineMinutes) },
        logFile: join(threadFolder, "repair", "logs", `${clusterId}-repair-${attempt}.jsonl`),
        mayStart: () => {
          if (budgetSpent()) return false;
          stageWorkspace(workspace, diagnosis.contextFolder, snapshotFolder(threadFolder));
          started = this.dependencies.now();
          return true;
        },
        onResult: (outcome) => this.charge(input.threadId, input.spentMs, chargedMilliseconds(label, outcome)),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (wasNotStarted(ran)) return this.budgetExhausted(label, clusterId, options.agents.runBudgetMinutes);
      // Only the source copy may change: a job that touched the context copy or the scratch folder fails as infra, whichever provider ran it.
      const outside = await changesOutsideSource(workspace, diagnosis.contextFolder);
      const result: AgentResult<RepairOutput> = outside.length === 0 ? ran
        : { ok: false, failure: { kind: "infra", message: `${label}: the job changed files outside its source copy: ${outside.join("; ")}.` }, usage: ran.usage, durationMs: ran.durationMs, sessionId: ran.sessionId };
      const finished = this.dependencies.now();
      const record: EvalRecord = {
        schemaVersion: 2, recordId, jobKind: "repair", origin: "workflow", threadId: input.threadId, subject: { kind: "discrepancy-cluster", id: clusterId },
        challenged: null, contextHash: diagnosis.contextHash, promptVersion: repairPromptVersion,
        agent: { provider: choice.provider, model: choice.model, effort: choice.effort },
        startedUtc: started.toISOString(), finishedUtc: finished.toISOString(), durationMs: measuredDuration(label, result), usage: result.usage,
        result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
        output: result.ok ? result.output : null, labels: noLabels,
      };
      await putRecord(store, record);
      const failure: AgentFailure | null = result.ok ? null : result.failure;
      if (failure?.kind === "quota_exhausted") {
        this.dependencies.log(`${label}: ${failure.kind}: ${failure.message}`);
        const waiting: QuotaWaitMark = { job: "repair", provider: choice.provider, since: finished.toISOString(), processId: this.dependencies.quota.processId, message: failure.message };
        return { update: { clusterId, waiting, records }, chargedMs: 0 };
      }
      if (failure?.kind === "infra") throw new SetupError(`${label} failed: ${failure.message} (record ${recordId})`);
      if (result.ok) this.dependencies.quota.reset();
      const answer = result.ok ? result.output : null;
      const ending = await this.judge(label, input, workspace, answer, failure, started.getTime() + deadlineMs);
      const folder = attemptFolder(threadFolder, clusterId, attempt);
      const document: AttemptDocument = {
        schemaVersion: 1, threadId: input.threadId, clusterId, attempt, recordId, contextHash: diagnosis.contextHash, snapshotIdentity: manifest.source.identity,
        hypothesisRecord: diagnosis.hypothesis!.recordId, agent: record.agent, answer, failure,
        patch: ending.patch === null ? null : { files: ending.patch.files, added: ending.patch.added, removed: ending.patch.removed },
        guard: ending.guard, build: ending.build, check: ending.check === null ? null : { ...ending.check.execution, rows: ending.check.rows },
        outcome: ending.stage === null ? "passed" : "rejected", stage: ending.stage, reason: ending.reason,
        startedUtc: started.toISOString(), finishedUtc: this.dependencies.now().toISOString(),
      };
      writeArchive({ folder, document, patchText: ending.patch?.text ?? "", layout: ending.patch === null ? null : workspace.patch, buildLog: ending.build === null ? null : workspace.buildLog });
      await setLabels(store, record, { repair: { outcome: document.outcome, stage: ending.stage, reason: ending.reason, labelledUtc: this.dependencies.now().toISOString() } });
      this.dependencies.log(`${label}: ${document.outcome}${ending.stage === null ? "" : ` at ${ending.stage}: ${ending.reason}`}; ${folder}`);
      const summary: AttemptSummary = { attempt, recordId, folder, outcome: document.outcome, stage: ending.stage, reason: ending.reason, check: ending.check?.execution ?? null };
      const status: RepairStatus = failure !== null && failure.kind !== "timeout" ? "failed" : document.outcome;
      return { update: { clusterId, status, attempt: summary, records }, chargedMs: record.durationMs };
    } finally {
      // A leftover copy is not a failure of the attempt: its result is still recorded, and the copy is named for the operator.
      try {
        scratch.remove();
      } catch (error) {
        this.dependencies.log(`${label}: the scratch folder ${scratch.path} could not be removed (${(error as Error).message}); remove it by hand.`);
      }
    }
  }

  /** The guard, the build and the narrow check of an attempt whose model job finished, each only when the step before passed. */
  private async judge(label: string, input: RepairInput, workspace: AttemptWorkspace, answer: RepairOutput | null, failure: AgentFailure | null, deadline: number): Promise<Ending> {
    const patch = computePatch(snapshotFolder(this.dependencies.threadFolder(input.threadId)), workspace.source, workspace.patch);
    const rejected = (stage: RepairStage, reason: string, rest: Partial<Ending> = {}): Ending => ({ patch, guard: [], build: null, check: null, ...rest, stage, reason });
    if (failure !== null) return rejected(failure.kind === "timeout" ? "deadline" : "model", `${failure.kind}: ${failure.message}`);
    if (answer === null) throw new Error(`${label}: a finished job without a failure has an answer.`);
    if (answer.outcome === "no_patch") return rejected("model", `no_patch: ${answer.reason}`);
    const guard = guardPatch(patch, answer.files);
    if (guard.length > 0) return rejected("patch", guard.join("; "), { guard });
    const remaining = deadline - this.dependencies.now().getTime();
    if (remaining <= 0) return rejected("deadline", "the deadline passed before the build could start");
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), remaining);
    const signal = input.signal === undefined ? stop.signal : AbortSignal.any([input.signal, stop.signal]);
    const buildStarted = this.dependencies.now().getTime();
    let status: number;
    try {
      this.dependencies.log(`${label}: building ${patch.files.length} changed files (${patch.added} lines added, ${patch.removed} removed).`);
      status = await this.dependencies.build({ label: `${label} build`, source: workspace.source, output: workspace.build, log: workspace.buildLog, signal });
    } catch (error) {
      // Only the deadline's own stop rejects the attempt; a stopped run, or any other failure, stays a failure of the run.
      if (input.signal?.aborted === true || !stop.signal.aborted) throw error;
      return rejected("deadline", "the build was still running at the deadline and was stopped",
        { build: { status: -1, durationMs: this.dependencies.now().getTime() - buildStarted, log: logName(workspace) } });
    } finally {
      clearTimeout(timer);
    }
    const build = { status, durationMs: this.dependencies.now().getTime() - buildStarted, log: logName(workspace) };
    if (status === 1) return rejected("build", "the patched source does not build; see build.log", { build });
    if (status !== 0) throw new SetupError(`${label}: the build script exited with ${status} (see its output above).`);
    const manifest = readSealedManifest(input.diagnosis);
    const run = await this.dependencies.narrowCheck({
      label: `${label} check`, cases: manifest.cluster.cases, captures: manifest.cluster.captures,
      candidateExecutable: join(workspace.build, "bin", "ChummerGenSR4.exe"), options: input.options, ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const judged = judgeNarrowCheck(run.status, run.runFolder);
    const check = { execution: judged.execution, rows: judged.rows };
    return judged.rejection === null ? { patch, guard: [], build, check, stage: null, reason: null } : rejected("check", judged.rejection, { build, check });
  }

  private spentMs(threadId: string, stateMs: number): number {
    return Math.max(stateMs, this.charged.get(threadId) ?? 0);
  }

  private charge(threadId: string, stateMs: number, milliseconds: number): void {
    this.charged.set(threadId, this.spentMs(threadId, stateMs) + milliseconds);
  }

  private budgetExhausted(label: string, clusterId: string, budgetMinutes: number): RepairStep {
    this.dependencies.log(`${label}: the run budget of ${budgetMinutes} min is spent; not started.`);
    return { update: { clusterId, status: "budget_exhausted" }, chargedMs: 0 };
  }
}

/** The patch an archived attempt made, empty when it made none; an archive always holds the file, so a missing one is a lost archive. */
function patchText(archive: string): string {
  const path = join(archive, "patch.diff");
  if (!existsSync(path)) throw new SetupError(`The archive of an earlier attempt lost its patch: ${path} does not exist; restore ${archive} or start a new thread.`);
  return readFileSync(path, "utf8");
}

/** The build log's name in the archive, or null when the build wrote none. */
function logName(workspace: AttemptWorkspace): string | null {
  return existsSync(workspace.buildLog) ? "build.log" : null;
}

/** The model time a result charges to the run budget: not a usage limit, and an infra failure ends the run. */
function chargedMilliseconds(label: string, result: AgentResult<unknown>): number {
  return !result.ok && (result.failure.kind === "quota_exhausted" || result.failure.kind === "infra") ? 0 : measuredDuration(label, result);
}
