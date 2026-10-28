import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import type { AgentRunners } from "../agents/agent-runners.js";
import { confirmedHypotheses, type CheckResult, type ConfirmedHypothesis } from "../diagnosis/check.js";
import type { ClusterDiagnosis, QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { ContextManifest } from "../diagnosis/context.js";
import { readSealedManifest } from "../diagnosis/diagnosis-service.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { recordNamespace, setLabels, type RepairStage } from "../evals/eval-record.js";
import { draftFiles, draftFixRecord } from "../fixes/fix-draft.js";
import type { BranchGit } from "../git/branch-git.js";
import { threadBranches, threadSource } from "../git/thread-source.js";
import type { Worktrees } from "../git/worktrees.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { maximumTries, triesOf, usesFixChanges, type RunOptions } from "../options/run-options.js";
import { readDocument } from "../steps/read-document.js";
import { attemptFolder, tryFolderName, writeArchive, type AttemptDocument, type TryDocument, type TrySummary } from "./attempt-archive.js";
import { judgeNarrowCheck, type AttemptBuild, type CheckRow, type NarrowCheck } from "./attempt-host.js";
import type { AttemptSummary, CheckExecution, ClusterRepair, EarlierAttempt, RepairStatus, RepairUpdate } from "./cluster-repair.js";
import { commitPatch, type Patch } from "./patch.js";
import { guardPatch } from "./patch-guard.js";
import { PlannedAttempt, type JobsOutcome } from "./planned-attempt.js";
import { repairPrompt, type EarlierBrief, type EarlierTry, type RepairBrief } from "./repair-prompt.js";
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

/** How a try ended once its model jobs finished. */
type Ending = {
  readonly patch: Patch | null;
  readonly guard: readonly string[];
  readonly build: AttemptDocument["build"];
  readonly check: { readonly execution: CheckExecution; readonly rows: readonly CheckRow[] } | null;
  readonly stage: RepairStage | null;
  readonly reason: string | null;
};

type FinishedJobs = Extract<JobsOutcome, { kind: "finished" }>;

/** One try of an attempt: its hypothesis, record, branch, workspace and what its jobs are told. */
type Try = {
  readonly tryNumber: number;
  readonly hypothesis: ConfirmedHypothesis;
  readonly label: string;
  readonly recordId: string;
  readonly branch: string;
  readonly subtaskBranch: (task: number) => string;
  readonly logFile: (suffix: string) => string;
  readonly brief: RepairBrief;
  readonly scratch: ScratchFolder;
  readonly workspace: AttemptWorkspace;
};

/** A try judged and documented, before the attempt is archived. */
type FinishedTry = {
  readonly item: Try;
  readonly finished: FinishedJobs;
  readonly ending: Ending;
  readonly commit: string | null;
  /** The run budget stopped the try before or between its jobs. */
  readonly stoppedByBudget: boolean;
  readonly document: TryDocument;
  /** The draft of a fix change of a passed planned try, by its path in the archive. */
  readonly draft: Readonly<Record<string, string>>;
};

/** Diagnosis's history-less copy of the source the candidate was built from, which the thread's source commit holds. */
function snapshotFolder(threadFolder: string): string {
  return join(threadFolder, "diagnosis", "source");
}

/** The message of an attempt or try commit: what the jobs left in its worktree. */
function attemptMessage(threadId: string, clusterId: string, attempt: number, tryNumber: number | null, recordId: string, summary: string | null): string {
  return `Repair attempt ${attempt}${tryNumber === null ? "" : `, try ${tryNumber},`} of discrepancy ${clusterId}\n\n${summary ?? "The job's changes as it left them."}\n\n`
    + `Workflow-Thread: ${threadId}\nDiscrepancy: ${clusterId}\nRepair-Attempt: ${recordId}\n`;
}

/**
 * The tries of an attempt: round by round one per confirmed hypothesis, `tries` rounds, at most `maximumTries` in all,
 * numbered from 1.
 */
export function tryPlan(hypotheses: readonly ConfirmedHypothesis[], tries: number): { tryNumber: number; hypothesis: ConfirmedHypothesis }[] {
  const plan: { tryNumber: number; hypothesis: ConfirmedHypothesis }[] = [];
  for (let round = 0; round < tries; round++) {
    for (const hypothesis of hypotheses) {
      if (plan.length < maximumTries) plan.push({ tryNumber: plan.length + 1, hypothesis });
    }
  }
  return plan;
}

/** The size the selection compares: changed lines (added plus removed), then files. */
type TrySize = { readonly lines: number; readonly files: number; readonly tryNumber: number };

/** The passed try with the fewest changed lines, then the fewest files, then the lowest number; null when none passed. */
export function selectBest<T extends TrySize>(passed: readonly T[]): T | null {
  return [...passed].sort((left, right) => left.lines - right.lines || left.files - right.files || left.tryNumber - right.tryNumber)[0] ?? null;
}

function selectTry(tries: readonly FinishedTry[]): FinishedTry | null {
  const passed = tries.filter((item) => item.document.outcome === "passed").map((item) => ({
    item, lines: item.ending.patch!.added + item.ending.patch!.removed, files: item.ending.patch!.files.length, tryNumber: item.item.tryNumber,
  }));
  return selectBest(passed)?.item ?? null;
}

/** Waits for every promise and then throws the first failure, so nothing a try started is still running when the attempt ends. */
async function settled<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  const failure = results.find((result) => result.status === "rejected");
  if (failure !== undefined) throw (failure as PromiseRejectedResult).reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function recordIds(outcome: JobsOutcome): string[] {
  return outcome.kind === "quota" ? [...outcome.records] : outcome.records.map((record) => record.recordId);
}

/** The model time of a try's finished jobs; a usage limit's own job is not charged. */
function chargedOf(outcome: JobsOutcome): number {
  return outcome.kind === "quota" ? outcome.chargedMs : outcome.records.reduce((sum, record) => sum + record.durationMs, 0);
}

/** The records an attempt may hold under its record ID: its own or its plan's, its subtasks', and each try's with its subtasks'. */
function attemptRecordIds(recordId: string): string[] {
  const withTasks = (id: string) => [id, ...Array.from({ length: maximumSubtasks }, (_, index) => `${id}/task-${index + 1}`)];
  return [...withTasks(recordId), ...Array.from({ length: maximumTries }, (_, index) => withTasks(`${recordId}/try-${index + 1}`)).flat()];
}

/**
 * The record ID and number of a cluster's next attempt, after the attempts its records list, and the stored records of
 * attempts they do not list (an interrupted attempt stored some of its jobs' records): an attempt number is taken when
 * any record of it is stored.
 */
async function nextAttemptRecord(store: BaseStore, prefix: string, records: readonly string[]): Promise<{ recordId: string; attempt: number; unlisted: string[] }> {
  const listed = new Set(records.flatMap((id) => {
    const number = id.startsWith(`${prefix}/`) ? /^(\d+)(?:\/|$)/.exec(id.slice(prefix.length + 1)) : null;
    return number === null ? [] : [number[1]!];
  }));
  const unlisted: string[] = [];
  for (let attempt = listed.size + 1; ; attempt++) {
    const recordId = `${prefix}/${attempt}`;
    const ids = attemptRecordIds(recordId);
    const found = await Promise.all(ids.map((id) => store.get(recordNamespace("repair"), id)));
    const stored = ids.filter((_, index) => found[index] !== null);
    if (stored.length === 0) return { recordId, attempt, unlisted };
    unlisted.push(...stored);
  }
}

/**
 * Repair on the real host: each attempt of a confirmed cluster makes its tries side by side, each by one repair job, or
 * with fix changes by a plan and its subtasks, in its own worktree, judged by the patch guard, the build and the narrow
 * check; the attempt passes with its best passed try.
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
    const { repair, options } = input;
    const clusterId = repair.clusterId;
    const label = `repair ${clusterId}`;
    const settings = options.repair;
    const choice = options.agents.jobs.repair;
    // A thread whose options lack the field was started by another version of the workflow and cannot be repaired.
    if (settings === null || settings === undefined || choice === undefined) throw new SetupError(`${label}: the thread was started without repair settings; start a new thread.`);
    // Each try repairs from one of the cluster's confirmed hypotheses, with that hypothesis's challenge.
    const hypotheses = confirmedHypotheses(input.diagnosis, input.check);
    if (hypotheses.some((item) => item.diagnosis.hypothesis?.output.explanation == null)) throw new Error(`${label}: the cluster has no hypothesis to repair from.`);
    const budgetMs = options.agents.runBudgetMinutes * 60_000;
    const budgetSpent = () => this.spentMs(input.threadId, input.spentMs) >= budgetMs;
    if (budgetSpent()) return this.budgetExhausted(label, clusterId, options.agents.runBudgetMinutes);
    const manifest = readSealedManifest(input.diagnosis);
    const threadFolder = this.dependencies.threadFolder(input.threadId);
    const { recordId, attempt, unlisted } = await nextAttemptRecord(store, `${input.threadId}/${clusterId}/repair`, repair.records);
    const before = [...repair.records, ...unlisted];
    const deadlineMs = settings.deadlineMinutes * 60_000;
    const source = this.sourceCommit(input.threadId, input.diagnosis);
    const jobs: AttemptJobs = {
      runner: this.dependencies.agents(options.agents), store, threadId: input.threadId, clusterId, contextHash: input.diagnosis.contextHash, choice,
      now: this.dependencies.now, budgetSpent, charge: (milliseconds) => this.charge(input.threadId, input.spentMs, milliseconds),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const planned = usesFixChanges(options);
    // A thread stored before attempts had tries repairs from its first confirmed hypothesis alone, as it did.
    const plan = settings.tries === undefined ? tryPlan(hypotheses.slice(0, 1), 1) : tryPlan(hypotheses, triesOf(settings));
    const several = plan.length > 1;
    // The earlier attempts are read before any workspace exists, so a lost archive leaves nothing behind.
    const earlier = (repair.earlier ?? []).map(earlierBrief);
    const tries: Try[] = [];
    let failing = false;
    try {
      for (const { tryNumber, hypothesis } of plan) {
        const brief = this.brief(input, hypothesis.diagnosis, manifest, earlier);
        const scratch = this.dependencies.createScratchFolder("workflow-repair-");
        const name = several ? `-try-${tryNumber}` : "";
        tries.push({
          tryNumber, hypothesis, scratch, workspace: workspaceIn(scratch, clusterId), label: several ? `${label} try ${tryNumber}` : label,
          // An attempt of one try keeps the attempt's own record and branch.
          recordId: several ? `${recordId}/try-${tryNumber}` : recordId,
          branch: several ? threadBranches.attemptTry(input.threadId, clusterId, attempt, tryNumber) : threadBranches.attempt(input.threadId, clusterId, attempt),
          subtaskBranch: (task) => (several ? threadBranches.trySubtask(input.threadId, clusterId, attempt, tryNumber, task) : threadBranches.subtask(input.threadId, clusterId, attempt, task)),
          logFile: (suffix) => join(threadFolder, "repair", "logs", `${clusterId}-repair-${attempt}${name}${suffix}.jsonl`),
          brief,
        });
      }
      this.dependencies.log(`${label}: running ${several ? `${plan.length} tries side by side (hypotheses ${plan.map((item) => item.hypothesis.variant).join(", ")}), each ` : ""}`
        + `${planned ? "a plan and its subtasks " : ""}on ${choice.provider} (${choice.model ?? "default model"}, effort ${choice.effort}), deadline ${settings.deadlineMinutes} min.`);
      const outcomes = await settled(tries.map((item) => this.runJobs(item, jobs, manifest, input.diagnosis.contextFolder, source, deadlineMs, settings.deadlineMinutes, planned)));
      const parked = outcomes.find((outcome) => outcome.kind === "quota");
      if (parked !== undefined && parked.kind === "quota") {
        // A usage limit in any try parks the whole attempt; the jobs the tries finished are charged.
        this.dependencies.log(`${label}: ${parked.failure.kind}: ${parked.failure.message}`);
        const waiting: QuotaWaitMark = { job: "repair", provider: choice.provider, since: this.dependencies.now().toISOString(), processId: this.dependencies.quota.processId, message: parked.failure.message };
        return { update: { clusterId, waiting, records: [...before, ...outcomes.flatMap(recordIds)] }, chargedMs: outcomes.reduce((sum, outcome) => sum + chargedOf(outcome), 0) };
      }
      if (outcomes.every((outcome) => outcome.kind === "not-started" && outcome.records.length === 0)) return this.budgetExhausted(label, clusterId, options.agents.runBudgetMinutes);
      if (outcomes.some((outcome) => outcome.kind === "finished" && outcome.failure === null)) this.dependencies.quota.reset();
      const judged = await settled(tries.map((item, index) => this.finishTry(input, item, outcomes[index] as Exclude<JobsOutcome, { kind: "quota" }>, manifest, attempt, source, deadlineMs, several)));
      return await this.conclude(input, store, judged, { attempt, label, folder: attemptFolder(threadFolder, clusterId, attempt), before, several });
    } catch (error) {
      failing = true;
      throw error;
    } finally {
      const leftovers: unknown[] = [];
      for (const item of tries) {
        try {
          removeWorkspace(this.dependencies.worktrees, item.workspace, item.scratch, item.label, this.dependencies.log, failing);
        } catch (error) {
          leftovers.push(error);
        }
      }
      if (leftovers.length > 0) throw leftovers[0];
    }
  }

  /** What a try's jobs are told: its hypothesis and challenge, the check's observations of their predictions, and the cluster's earlier attempts. */
  private brief(input: RepairInput, diagnosis: ClusterDiagnosis, manifest: ContextManifest, earlier: readonly EarlierBrief[]): RepairBrief {
    const predicted = new Set([...(diagnosis.hypothesis?.output.explanation?.predictions ?? []), ...(diagnosis.challenge?.output.alternative?.predictions ?? [])]
      .map((prediction) => `${prediction.case}/${prediction.capture}`));
    return {
      manifest, hypothesis: diagnosis.hypothesis!.output.explanation!, challenge: diagnosis.challenge?.output ?? null,
      observations: input.check.observations.filter((item) => predicted.has(`${item.case}/${item.capture}`)),
      earlier,
    };
  }

  /** A try's model jobs: one repair job, or with fix changes a plan and its subtasks, in the try's own worktree. */
  private runJobs(item: Try, jobs: AttemptJobs, manifest: ContextManifest, contextFolder: string, source: string, deadlineMs: number,
    deadlineMinutes: number, planned: boolean): Promise<JobsOutcome> {
    if (planned) {
      return new PlannedAttempt({
        label: item.label, jobs, recordId: item.recordId, brief: item.brief, manifest, workspace: item.workspace, contextFolder, logFile: item.logFile, deadlineMs,
        git: { worktrees: this.dependencies.worktrees, source, branch: item.branch, subtaskBranch: item.subtaskBranch },
        createScratchFolder: this.dependencies.createScratchFolder, log: this.dependencies.log,
      }).run();
    }
    return this.singleJob(item.label, jobs, item.recordId, item.brief, item.workspace, contextFolder, (folder) => this.dependencies.worktrees.add(folder, item.branch, source),
      item.logFile(""), deadlineMinutes, new WorktreeGuard(this.dependencies.worktrees));
  }

  /** A try once its jobs ended without a usage limit: its commit, judged by the guard, the build and the narrow check, and its document. */
  private async finishTry(input: RepairInput, item: Try, outcome: Exclude<JobsOutcome, { kind: "quota" }>, manifest: ContextManifest, attempt: number,
    source: string, deadlineMs: number, several: boolean): Promise<FinishedTry> {
    const { clusterId } = input.repair;
    const budgetMinutes = input.options.agents.runBudgetMinutes;
    const diagnosis = item.hypothesis.diagnosis;
    if (outcome.kind === "not-started" && outcome.records.length === 0) {
      // The budget was spent before the try's first job could start, while another try's jobs ran.
      const finished: FinishedJobs = { kind: "finished", answer: null, failure: null, records: [], started: this.dependencies.now(), planned: null, rejection: null };
      const ending: Ending = {
        patch: null, guard: [], build: null, check: null, stage: "model", reason: `the run budget of ${budgetMinutes} min was spent before the try's first job could start`,
      };
      return { item, finished, ending, commit: null, stoppedByBudget: true, document: this.document(input, diagnosis, manifest, attempt, item, finished, ending, null), draft: {} };
    }
    // A budget that stopped the try after some of its jobs finished: those jobs are archived like any rejected try.
    const stoppedByBudget = outcome.kind === "not-started";
    const finished: FinishedJobs = outcome.kind === "finished" ? outcome : {
      kind: "finished", answer: null, failure: null, records: outcome.records, started: outcome.started ?? this.dependencies.now(), planned: outcome.planned,
      rejection: { stage: "model", reason: `the run budget of ${budgetMinutes} min was spent after ${outcome.records.length} of the attempt's jobs finished, before the next could start` },
    };
    // Whatever the jobs left in the worktree is the try's commit, also when a job failed: the branch keeps it.
    const commit = existsSync(item.workspace.source)
      ? this.dependencies.worktrees.commitAll(item.workspace.source,
        attemptMessage(input.threadId, clusterId, attempt, several ? item.tryNumber : null, item.recordId, finished.answer?.summary ?? null))
      : null;
    const ending = await this.judge(item.label, { ...input, diagnosis }, item.workspace, finished, finished.started.getTime() + deadlineMs, source, commit);
    const document = this.document(input, diagnosis, manifest, attempt, item, finished, ending, commit);
    const draft = finished.planned !== null && document.outcome === "passed"
      ? draftFiles(draftFixRecord({
        threadId: input.threadId, manifest, diagnosis, check: input.check, observations: item.brief.observations, planned: finished.planned,
        patch: ending.patch!, narrowCheck: ending.check!.execution,
      }))
      : {};
    return { item, finished, ending, commit, stoppedByBudget, document, draft };
  }

  /** Selects the best passed try, archives the attempt with every try, labels each try's records and makes the cluster's update. */
  private async conclude(input: RepairInput, store: BaseStore, tries: readonly FinishedTry[],
    attempt: { readonly attempt: number; readonly label: string; readonly folder: string; readonly before: readonly string[]; readonly several: boolean }): Promise<RepairStep> {
    const { clusterId } = input.repair;
    const selected = selectTry(tries);
    const failed = tries.filter((item) => item.finished.failure !== null && item.finished.failure.kind !== "timeout");
    // The budget ends the cluster only when it stopped every try; a try that ran to its end decides the attempt otherwise.
    const ran = tries.filter((item) => !item.stoppedByBudget);
    const status: RepairStatus = selected !== null ? "passed" : failed.length > 0 ? "failed" : ran.length === 0 ? "budget_exhausted" : "rejected";
    // A rejected attempt is shown by the try that explains its status, an execution failure before any other rejection.
    const lost = tries.find((item) => item.ending.check !== null && (item.ending.check.execution.status === 2 || !item.ending.check.execution.coverageValid));
    const top = selected ?? (status === "failed" ? failed[0] : undefined) ?? lost ?? ran[0] ?? tries[0]!;
    const stage = selected === null ? top.ending.stage : null;
    const reason = selected !== null ? null
      : attempt.several ? tries.map((item) => `try ${item.item.tryNumber} (hypothesis ${item.item.hypothesis.variant}) at ${item.ending.stage}: ${item.ending.reason}`).join("; ")
        : top.ending.reason;
    const summaries: TrySummary[] = tries.map((item) => ({
      try: item.item.tryNumber, hypothesis: item.item.hypothesis.variant, hypothesisRecord: item.document.hypothesisRecord, recordId: item.item.recordId,
      branch: item.item.branch, commit: item.commit, folder: tryFolderName(item.item.tryNumber), outcome: item.document.outcome, stage: item.ending.stage,
      reason: item.ending.reason, selected: item === selected,
      patch: item.ending.patch === null ? null : { files: item.ending.patch.files.length, added: item.ending.patch.added, removed: item.ending.patch.removed },
      check: item.ending.check?.execution ?? null,
    }));
    const { try: _try, hypothesis: _hypothesis, ...own } = top.document;
    const document: AttemptDocument = { ...own, outcome: selected === null ? "rejected" : "passed", stage, reason, tries: summaries, selectedTry: selected?.item.tryNumber ?? null };
    const archived = (item: FinishedTry) => ({
      patchText: item.ending.patch?.text ?? "", layout: item.ending.patch === null ? null : item.item.workspace.patch,
      buildLog: item.ending.build === null ? null : item.item.workspace.buildLog,
    });
    writeArchive({
      folder: attempt.folder, document, ...archived(top), extra: selected === null ? {} : selected.draft,
      tries: tries.map((item) => ({ document: item.document, ...archived(item) })),
    });
    for (const item of tries) {
      const labels = { repair: { outcome: item.document.outcome, stage: item.ending.stage, reason: item.ending.reason, labelledUtc: this.dependencies.now().toISOString() } };
      for (const record of item.finished.records) await setLabels(store, record, labels);
    }
    if (attempt.several) {
      for (const item of summaries) {
        this.dependencies.log(`${attempt.label}: try ${item.try} (hypothesis ${item.hypothesis}) ${item.outcome}${item.stage === null ? "" : ` at ${item.stage}: ${item.reason}`}`
          + `${item.patch === null ? "" : `, ${item.patch.added + item.patch.removed} lines in ${item.patch.files} files`}${item.selected ? ", selected" : ""}.`);
      }
    }
    this.dependencies.log(`${attempt.label}: ${document.outcome}${stage === null ? "" : ` at ${stage}: ${reason}`}`
      + `${selected === null || !attempt.several ? "" : ` with try ${selected.item.tryNumber}`}; ${attempt.folder}`);
    const summary: AttemptSummary = {
      attempt: attempt.attempt, recordId: top.item.recordId, folder: attempt.folder, outcome: document.outcome, stage, reason, check: top.ending.check?.execution ?? null,
      branch: top.item.branch, commit: top.commit, ...(attempt.several ? { tries: summaries } : {}),
    };
    const records = tries.flatMap((item) => item.finished.records);
    return {
      update: { clusterId, status, attempt: summary, records: [...attempt.before, ...records.map((record) => record.recordId)] },
      chargedMs: records.reduce((sum, record) => sum + record.durationMs, 0),
    };
  }

  /** The single repair job of a try in a thread without fix changes, in the try's writable worktree. */
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

  /** `attempt.json` of a finished try; a try whose job never started names the agent its jobs would have had. */
  private document(input: RepairInput, diagnosis: ClusterDiagnosis, manifest: ContextManifest, attempt: number, item: Try, outcome: FinishedJobs, ending: Ending,
    commit: string | null): TryDocument {
    const choice = input.options.agents.jobs.repair!;
    return {
      schemaVersion: 1, threadId: input.threadId, clusterId: input.repair.clusterId, attempt, recordId: item.recordId, contextHash: diagnosis.contextHash, branch: item.branch, commit,
      snapshotIdentity: manifest.source.identity, hypothesisRecord: diagnosis.hypothesis!.recordId,
      agent: outcome.records[0]?.agent ?? { provider: choice.provider, model: choice.model, effort: choice.effort },
      answer: outcome.answer, failure: outcome.failure,
      patch: ending.patch === null ? null : { files: ending.patch.files, added: ending.patch.added, removed: ending.patch.removed },
      guard: ending.guard, build: ending.build, check: ending.check === null ? null : { ...ending.check.execution, rows: ending.check.rows },
      outcome: ending.stage === null ? "passed" : "rejected", stage: ending.stage, reason: ending.reason,
      startedUtc: outcome.started.toISOString(), finishedUtc: this.dependencies.now().toISOString(),
      ...(outcome.planned === null ? {} : { planned: outcome.planned }),
      try: item.tryNumber, hypothesis: item.hypothesis.variant,
    };
  }

  /** The guard, the build and the narrow check of a try whose model jobs finished, each only when the step before passed. */
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

/** An earlier attempt as a next attempt's jobs are told about it, with every try and its patch when it made several. */
function earlierBrief(item: EarlierAttempt): EarlierBrief {
  const tries = earlierTries(item.archive);
  return {
    attempt: item.attempt, rejectedBy: item.rejectedBy, stage: item.stage, reason: item.reason, patch: patchText(item.archive),
    ...(tries === null ? {} : { tries }),
  };
}

/** What a next attempt reads of an earlier attempt's tries. */
const ArchivedTriesSchema = z.object({
  tries: z.array(z.object({
    try: z.number().int().positive(), hypothesis: z.number().int().positive(), outcome: z.enum(["passed", "rejected"]),
    stage: z.string().nullable(), reason: z.string().nullable(), selected: z.boolean(), folder: z.string(),
  })).optional(),
});

/** Every try of an earlier attempt with its patch, or null for an attempt of one try or an archive written before attempts had tries. */
function earlierTries(archive: string): EarlierTry[] | null {
  const document = readDocument(join(archive, "attempt.json"), ArchivedTriesSchema);
  if (document.tries === undefined || document.tries.length < 2) return null;
  return document.tries.map((item) => ({
    try: item.try, hypothesis: item.hypothesis, outcome: item.outcome, stage: item.stage, reason: item.reason, selected: item.selected,
    patch: patchText(join(archive, item.folder)),
  }));
}

/** The build log's name in the archive, or null when the build wrote none. */
function logName(workspace: AttemptWorkspace): string | null {
  return existsSync(workspace.buildLog) ? "build.log" : null;
}
