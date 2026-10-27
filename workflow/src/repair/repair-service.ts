import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { AgentRunners } from "../agents/agent-runners.js";
import type { CheckResult } from "../diagnosis/check.js";
import type { ClusterDiagnosis, QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { ContextManifest } from "../diagnosis/context.js";
import { readSealedManifest } from "../diagnosis/diagnosis-service.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { nextRecordId, recordNamespace, setLabels, type RepairStage } from "../evals/eval-record.js";
import { draftFiles, draftFixRecord } from "../fixes/fix-draft.js";
import type { BranchGit } from "../git/branch-git.js";
import { threadBranches, threadSource } from "../git/thread-source.js";
import type { Worktrees } from "../git/worktrees.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { usesFixChanges, type RunOptions } from "../options/run-options.js";
import { attemptFolder, writeArchive, type AttemptDocument } from "./attempt-archive.js";
import { judgeNarrowCheck, type AttemptBuild, type CheckRow, type NarrowCheck } from "./attempt-host.js";
import type { AttemptSummary, CheckExecution, ClusterRepair, RepairStatus, RepairUpdate } from "./cluster-repair.js";
import { commitPatch, type Patch } from "./patch.js";
import { guardPatch } from "./patch-guard.js";
import { PlannedAttempt, type JobsOutcome } from "./planned-attempt.js";
import { repairPrompt, type RepairBrief } from "./repair-prompt.js";
import { runRecordedJob, type AttemptJobs } from "./repair-job.js";
import { repairDocument, writeRepairDocument } from "./repair-report.js";
import { maximumSubtasks } from "./plan-schemas.js";
import { RepairOutputSchema, repairPromptVersion, validateRepair, type RepairOutput } from "./repair-schemas.js";
import { changesOutsideSource, removeWorkspace, stageWorkspace, workspaceIn, WorktreeGuard, type AttemptWorkspace } from "./workspace.js";

export type RepairDependencies = {
  readonly threadFolder: (threadId: string) => string;
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly build: AttemptBuild;
  readonly narrowCheck: NarrowCheck;
  /** A scratch folder outside the repository, where an attempt gets its workspace. */
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  /** The repository's git and worktrees: the thread's source commit, the attempts' worktrees, branches and commits. */
  readonly git: BranchGit;
  readonly worktrees: Worktrees;
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

/** How an attempt ended once its model jobs finished. */
type Ending = {
  readonly patch: Patch | null;
  readonly guard: readonly string[];
  readonly build: AttemptDocument["build"];
  readonly check: { readonly execution: CheckExecution; readonly rows: readonly CheckRow[] } | null;
  readonly stage: RepairStage | null;
  readonly reason: string | null;
};

type FinishedJobs = Extract<JobsOutcome, { kind: "finished" }>;

/** Diagnosis's history-less copy of the source the candidate was built from, which the thread's source commit holds. */
function snapshotFolder(threadFolder: string): string {
  return join(threadFolder, "diagnosis", "source");
}

/** The message of an attempt commit: what the job left in its worktree. */
function attemptMessage(threadId: string, clusterId: string, attempt: number, recordId: string, summary: string | null): string {
  return `Repair attempt ${attempt} of discrepancy ${clusterId}\n\n${summary ?? "The job's changes as it left them."}\n\n`
    + `Workflow-Thread: ${threadId}\nDiscrepancy: ${clusterId}\nRepair-Attempt: ${recordId}\n`;
}

/**
 * Repair on the real host: one attempt per confirmed cluster, made by one repair job, or with fix changes by a plan
 * and its subtasks, and judged by the patch guard, the build and the narrow check.
 */
export class RepairService {
  /** Model time the attempts finished in this process charged to each thread, before the graph state has them. */
  private readonly charged = new Map<string, number>();

  constructor(private readonly dependencies: RepairDependencies) {}

  /** A pending repair for every cluster the check confirmed, and the thread's source commit they start from when there is any. */
  prepare(threadId: string, clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): Record<string, ClusterRepair> {
    const confirmed = Object.values(clusters).filter((cluster) => check?.clusters[cluster.clusterId]?.outcome === "confirmed");
    if (confirmed.length > 0) this.sourceCommit(threadId, confirmed[0]!);
    return Object.fromEntries(confirmed.map((cluster) => [cluster.clusterId, { clusterId: cluster.clusterId, status: "pending", attempt: null, earlier: [], waiting: null, records: [] }]));
  }

  /** The thread's source commit, made from the snapshot the first time it is asked for. */
  private sourceCommit(threadId: string, diagnosis: ClusterDiagnosis): string {
    const threadFolder = this.dependencies.threadFolder(threadId);
    return threadSource(this.dependencies.git, threadId, readSealedManifest(diagnosis).source.commit, snapshotFolder(threadFolder), join(threadFolder, "repair", "source.index"));
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
    // A planned attempt lists its subtasks' records too; attempts are numbered by their own records only.
    const listed = repair.records.filter((id) => /\/repair\/\d+$/.test(id)).length;
    const { recordId, attempt, unlisted } = await nextRecordId(store, "repair", `${input.threadId}/${clusterId}/repair`, listed);
    // An interrupted planned attempt stored its plan record and some of its subtasks' records `<attempt record>/task-<k>`.
    const interrupted: string[] = [];
    for (const id of unlisted) {
      interrupted.push(id);
      for (let task = 1; task <= maximumSubtasks; task++) {
        if ((await store.get(recordNamespace("repair"), `${id}/task-${task}`)) !== null) interrupted.push(`${id}/task-${task}`);
      }
    }
    const before = [...repair.records, ...interrupted];
    const deadlineMs = settings.deadlineMinutes * 60_000;
    const source = this.sourceCommit(input.threadId, diagnosis);
    const branch = threadBranches.attempt(input.threadId, clusterId, attempt);
    const scratch = this.dependencies.createScratchFolder("workflow-repair-");
    const workspace = workspaceIn(scratch, clusterId);
    let failing = false;
    try {
      const predicted = new Set([...(diagnosis.hypothesis?.output.explanation?.predictions ?? []), ...(diagnosis.challenge?.output.alternative?.predictions ?? [])]
        .map((prediction) => `${prediction.case}/${prediction.capture}`));
      const brief: RepairBrief = {
        manifest, hypothesis: explanation, challenge: diagnosis.challenge?.output ?? null,
        observations: input.check.observations.filter((item) => predicted.has(`${item.case}/${item.capture}`)),
        earlier: (repair.earlier ?? []).map((item) => ({
          attempt: item.attempt, rejectedBy: item.rejectedBy, stage: item.stage, reason: item.reason, patch: patchText(item.archive),
        })),
      };
      const jobs: AttemptJobs = {
        runner: this.dependencies.agents(options.agents), store, threadId: input.threadId, clusterId, contextHash: diagnosis.contextHash, choice,
        now: this.dependencies.now, budgetSpent, charge: (milliseconds) => this.charge(input.threadId, input.spentMs, milliseconds),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      };
      const logFile = (suffix: string) => join(threadFolder, "repair", "logs", `${clusterId}-repair-${attempt}${suffix}.jsonl`);
      const planned = usesFixChanges(options);
      this.dependencies.log(`${label}: running ${planned ? "a plan and its subtasks " : ""}on ${choice.provider} (${choice.model ?? "default model"}, effort ${choice.effort}), deadline ${settings.deadlineMinutes} min.`);
      const outcome: JobsOutcome = planned
        ? await new PlannedAttempt({
          label, jobs, recordId, brief, manifest, workspace, contextFolder: diagnosis.contextFolder, logFile, deadlineMs,
          git: { worktrees: this.dependencies.worktrees, source, branch, subtaskBranch: (task) => threadBranches.subtask(input.threadId, clusterId, attempt, task) },
          createScratchFolder: this.dependencies.createScratchFolder, log: this.dependencies.log,
        }).run()
        : await this.singleJob(label, jobs, recordId, brief, workspace, diagnosis.contextFolder, (folder) => this.dependencies.worktrees.add(folder, branch, source),
          logFile(""), settings.deadlineMinutes, new WorktreeGuard(this.dependencies.worktrees));
      if (outcome.kind === "not-started" && outcome.records.length === 0) return this.budgetExhausted(label, clusterId, options.agents.runBudgetMinutes);
      if (outcome.kind === "quota") {
        this.dependencies.log(`${label}: ${outcome.failure.kind}: ${outcome.failure.message}`);
        const waiting: QuotaWaitMark = { job: "repair", provider: choice.provider, since: this.dependencies.now().toISOString(), processId: this.dependencies.quota.processId, message: outcome.failure.message };
        return { update: { clusterId, waiting, records: [...before, ...outcome.records] }, chargedMs: outcome.chargedMs };
      }
      // A budget that stopped the attempt after some of its jobs finished: those jobs are archived like any rejected attempt.
      const stoppedByBudget = outcome.kind === "not-started";
      const finished: FinishedJobs = outcome.kind === "finished" ? outcome : {
        kind: "finished", answer: null, failure: null, records: outcome.records, started: outcome.started ?? this.dependencies.now(), planned: outcome.planned,
        rejection: { stage: "model", reason: `the run budget of ${options.agents.runBudgetMinutes} min was spent after ${outcome.records.length} of the attempt's jobs finished, before the next could start` },
      };
      if (finished.failure === null && !stoppedByBudget) this.dependencies.quota.reset();
      // Whatever the jobs left in the worktree is the attempt commit, also when a job failed: the branch keeps it.
      const commit = existsSync(workspace.source)
        ? this.dependencies.worktrees.commitAll(workspace.source, attemptMessage(input.threadId, clusterId, attempt, recordId, finished.answer?.summary ?? null))
        : null;
      const ending = await this.judge(label, input, workspace, finished, finished.started.getTime() + deadlineMs, source, commit);
      const document = this.document(input, manifest, attempt, recordId, finished, ending, branch, commit);
      const folder = attemptFolder(threadFolder, clusterId, attempt);
      const draft = finished.planned !== null && document.outcome === "passed"
        ? draftFiles(draftFixRecord({
          threadId: input.threadId, manifest, diagnosis, check: input.check, observations: brief.observations, planned: finished.planned,
          patch: ending.patch!, narrowCheck: ending.check!.execution,
        }))
        : {};
      writeArchive({
        folder, document, patchText: ending.patch?.text ?? "", layout: ending.patch === null ? null : workspace.patch,
        buildLog: ending.build === null ? null : workspace.buildLog, extra: draft,
      });
      const labels = { repair: { outcome: document.outcome, stage: ending.stage, reason: ending.reason, labelledUtc: this.dependencies.now().toISOString() } };
      for (const record of finished.records) await setLabels(store, record, labels);
      this.dependencies.log(`${label}: ${document.outcome}${ending.stage === null ? "" : ` at ${ending.stage}: ${ending.reason}`}; ${folder}`);
      const summary: AttemptSummary = { attempt, recordId, folder, outcome: document.outcome, stage: ending.stage, reason: ending.reason, check: ending.check?.execution ?? null, branch, commit };
      const status: RepairStatus = stoppedByBudget ? "budget_exhausted" : finished.failure !== null && finished.failure.kind !== "timeout" ? "failed" : document.outcome;
      const records = [...before, ...finished.records.map((record) => record.recordId)];
      return { update: { clusterId, status, attempt: summary, records }, chargedMs: finished.records.reduce((sum, record) => sum + record.durationMs, 0) };
    } catch (error) {
      failing = true;
      throw error;
    } finally {
      removeWorkspace(this.dependencies.worktrees, workspace, scratch, label, this.dependencies.log, failing);
    }
  }

  /** The single repair job of an attempt in a thread without fix changes, in the attempt's writable copy. */
  private async singleJob(label: string, jobs: AttemptJobs, recordId: string, brief: RepairBrief, workspace: AttemptWorkspace,
    contextFolder: string, checkout: (folder: string) => void, logFile: string, deadlineMinutes: number, guard: WorktreeGuard): Promise<JobsOutcome> {
    const ran = await runRecordedJob<RepairOutput>(jobs, {
      label, recordId, promptVersion: repairPromptVersion, prompt: repairPrompt(brief, { sourceFolder: workspace.source, contextFolder: workspace.context }),
      images: brief.manifest.members.flatMap((member) => [join(workspace.context, member.canonicalCrop), join(workspace.context, member.candidateCrop)]),
      schema: RepairOutputSchema, validate: validateRepair,
      workspace: { folder: workspace.source, readOnly: [workspace.context], writable: true },
      // The deadline starts with the model job, so the job may not run past it.
      timeoutMinutes: () => Math.min(jobs.choice.timeoutMinutes, deadlineMinutes), logFile,
      stage: () => stageWorkspace(workspace, contextFolder, (folder) => {
        checkout(folder);
        guard.record(folder);
      }),
      outside: () => changesOutsideSource(workspace, contextFolder, guard),
    });
    if (ran === null) return { kind: "not-started", records: [], started: null, planned: null };
    const { record, result } = ran;
    if (!result.ok && result.failure.kind === "quota_exhausted") return { kind: "quota", failure: result.failure, records: [record.recordId], chargedMs: 0 };
    return {
      kind: "finished", answer: result.ok ? result.output : null, failure: result.ok ? null : result.failure, rejection: null, records: [record],
      started: new Date(record.startedUtc), planned: null,
    };
  }

  /** `attempt.json` of a finished attempt. */
  private document(input: RepairInput, manifest: ContextManifest, attempt: number, recordId: string, outcome: FinishedJobs, ending: Ending,
    branch: string, commit: string | null): AttemptDocument {
    return {
      schemaVersion: 1, threadId: input.threadId, clusterId: input.repair.clusterId, attempt, recordId, contextHash: input.diagnosis.contextHash, branch, commit,
      snapshotIdentity: manifest.source.identity, hypothesisRecord: input.diagnosis.hypothesis!.recordId, agent: outcome.records[0]!.agent,
      answer: outcome.answer, failure: outcome.failure,
      patch: ending.patch === null ? null : { files: ending.patch.files, added: ending.patch.added, removed: ending.patch.removed },
      guard: ending.guard, build: ending.build, check: ending.check === null ? null : { ...ending.check.execution, rows: ending.check.rows },
      outcome: ending.stage === null ? "passed" : "rejected", stage: ending.stage, reason: ending.reason,
      startedUtc: outcome.started.toISOString(), finishedUtc: this.dependencies.now().toISOString(),
      ...(outcome.planned === null ? {} : { planned: outcome.planned }),
    };
  }

  /** The guard, the build and the narrow check of an attempt whose model jobs finished, each only when the step before passed. */
  private async judge(label: string, input: RepairInput, workspace: AttemptWorkspace, jobs: FinishedJobs, deadline: number, source: string, commit: string | null): Promise<Ending> {
    const { answer, failure } = jobs;
    const patch = commitPatch(this.dependencies.worktrees, source, commit, workspace.patch);
    const rejected = (stage: RepairStage, reason: string, rest: Partial<Ending> = {}): Ending => ({ patch, guard: [], build: null, check: null, ...rest, stage, reason });
    if (failure !== null) return rejected(failure.kind === "timeout" ? "deadline" : "model", `${failure.kind}: ${failure.message}`);
    if (jobs.rejection !== null) return rejected(jobs.rejection.stage, jobs.rejection.reason);
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

  /** The cluster out of budget before an attempt's first job could start. */
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
