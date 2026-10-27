import { join } from "node:path";
import type { AgentFailure } from "../agents/agent-job.js";
import type { ContextManifest } from "../diagnosis/context.js";
import type { RepairStage } from "../evals/eval-record.js";
import type { Worktrees } from "../git/worktrees.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { planPrompt, subtaskPrompt } from "./plan-prompt.js";
import { blockerClosure, PlanOutputSchema, planPromptVersion, subtaskPromptVersion, validatePlan, type PlanOutput, type Subtask } from "./plan-schemas.js";
import type { RepairBrief } from "./repair-prompt.js";
import { runRecordedJob, type AttemptJobs, type RecordedJob } from "./repair-job.js";
import { RepairOutputSchema, validateRepair, type RepairOutput } from "./repair-schemas.js";
import { applyJoin, joinChanges, joinedPaths, subtaskChanges, type Conflict, type JoinedFile, type SourceBlobs, type SubtaskChange } from "./subtask-join.js";
import { changesOutsideSource, removeWorkspace, stageWorkspace, workspaceIn, WorktreeGuard, type AttemptWorkspace } from "./workspace.js";

/** A subtask as the attempt's archive keeps it. */
export type SubtaskOutcome = {
  readonly id: number;
  readonly recordId: string;
  readonly answer: RepairOutput | null;
  readonly failure: AgentFailure | null;
  /** The files the subtask changed, against the copy it started with. */
  readonly files: readonly string[];
};

/** The plan and the subtasks of a planned attempt, for its archive. */
export type PlannedWork = {
  readonly plan: { readonly recordId: string; readonly output: PlanOutput | null; readonly failure: AgentFailure | null };
  readonly subtasks: readonly SubtaskOutcome[];
};

/**
 * How an attempt's model jobs ended: not started for the budget (with the jobs that finished before it, if any),
 * parked for a usage limit, or finished with a source to judge.
 */
export type JobsOutcome =
  | {
    readonly kind: "not-started";
    readonly records: readonly RecordedJob<unknown>["record"][];
    readonly started: Date | null;
    readonly planned: PlannedWork | null;
  }
  | {
    readonly kind: "quota";
    readonly failure: AgentFailure;
    readonly records: readonly string[];
    /** The model time the jobs that finished before the usage limit used. */
    readonly chargedMs: number;
  }
  | {
    readonly kind: "finished";
    /** The answer the guard checks the patch against; null when a job failed or declined. */
    readonly answer: RepairOutput | null;
    readonly failure: AgentFailure | null;
    /** A rejection the jobs decided before the guard (a declined plan or subtask, a conflict), or null. */
    readonly rejection: { readonly stage: RepairStage; readonly reason: string } | null;
    /** Every job's record, the attempt's first. */
    readonly records: readonly RecordedJob<unknown>["record"][];
    readonly started: Date;
    readonly planned: PlannedWork | null;
  };

export type PlannedAttemptInput = {
  readonly label: string;
  readonly jobs: AttemptJobs;
  /** The attempt's record ID, which the plan job takes; subtask `k` takes `<recordId>/task-<k>`. */
  readonly recordId: string;
  readonly brief: RepairBrief;
  readonly manifest: ContextManifest;
  /** The attempt's workspace: the plan job reads its worktree, and the join is written into it. */
  readonly workspace: AttemptWorkspace;
  readonly contextFolder: string;
  /** The worktrees, the thread's source commit, the attempt's branch and a subtask's branch. */
  readonly git: { readonly worktrees: Worktrees; readonly source: string; readonly branch: string; readonly subtaskBranch: (task: number) => string };
  readonly logFile: (suffix: string) => string;
  readonly deadlineMs: number;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly log: (line: string) => void;
};

const crops = (manifest: ContextManifest, context: string) => manifest.members.flatMap((member) => [join(context, member.canonicalCrop), join(context, member.candidateCrop)]);

type SubtaskRun =
  | { readonly kind: "not-started" }
  | { readonly kind: "ran"; readonly job: RecordedJob<RepairOutput>; readonly changes: readonly SubtaskChange[]; readonly others: readonly string[] };

/** An attempt planned as subtasks: the plan job, waves of subtask jobs in their own copies, and the join of their changes. */
export class PlannedAttempt {
  private started: Date | null = null;
  private readonly records: RecordedJob<unknown>["record"][] = [];
  private readonly outcomes: SubtaskOutcome[] = [];
  private readonly changes = new Map<number, readonly SubtaskChange[]>();
  private plan: PlannedWork["plan"];
  private blobs: SourceBlobs | null = null;

  constructor(private readonly input: PlannedAttemptInput) {
    this.plan = { recordId: input.recordId, output: null, failure: null };
  }

  private minutesLeft(): number {
    const start = this.started ?? this.input.jobs.now();
    return (start.getTime() + this.input.deadlineMs - this.input.jobs.now().getTime()) / 60_000;
  }

  private work(): PlannedWork {
    return { plan: this.plan, subtasks: [...this.outcomes].sort((left, right) => left.id - right.id) };
  }

  private finished(rest: { answer?: RepairOutput; failure?: AgentFailure; rejection?: { stage: RepairStage; reason: string } }): JobsOutcome {
    return {
      kind: "finished", answer: rest.answer ?? null, failure: rest.failure ?? null, rejection: rest.rejection ?? null, records: this.records,
      started: this.started ?? this.input.jobs.now(), planned: this.work(),
    };
  }

  private parked(failure: AgentFailure): JobsOutcome {
    // The usage limit's own job is not charged, as the job runner did not charge it.
    const chargedMs = this.records.filter((record) => record.result.status !== "quota_exhausted").reduce((sum, record) => sum + record.durationMs, 0);
    return { kind: "quota", failure, records: this.records.map((record) => record.recordId), chargedMs };
  }

  /** The source commit's blobs, taken once for the attempt. */
  private snapshot(): SourceBlobs {
    return (this.blobs ??= this.input.git.worktrees.blobs(this.input.git.source));
  }

  async run(): Promise<JobsOutcome> {
    const { input } = this;
    const { workspace, jobs } = input;
    const guard = new WorktreeGuard(input.git.worktrees);
    const ran = await runRecordedJob<PlanOutput>(jobs, {
      label: `${input.label} plan`, recordId: input.recordId, promptVersion: planPromptVersion,
      prompt: planPrompt(input.brief, { sourceFolder: workspace.source, contextFolder: workspace.context }),
      images: crops(input.manifest, workspace.context), schema: PlanOutputSchema, validate: validatePlan,
      workspace: { folder: workspace.source, readOnly: [workspace.context] }, timeoutMinutes: () => Math.min(jobs.choice.timeoutMinutes, input.deadlineMs / 60_000),
      logFile: input.logFile(""),
      stage: () => {
        stageWorkspace(workspace, input.contextFolder, (folder) => {
          input.git.worktrees.add(folder, input.git.branch, input.git.source);
          guard.record(folder);
        });
        this.started = jobs.now();
      },
      outside: () => changesOutsideSource(workspace, input.contextFolder, guard),
    });
    if (ran === null) return { kind: "not-started", records: [], started: null, planned: null };
    this.records.push(ran.record);
    if (!ran.result.ok) {
      this.plan = { ...this.plan, failure: ran.result.failure };
      if (ran.result.failure.kind === "quota_exhausted") return this.parked(ran.result.failure);
      return this.finished({ failure: ran.result.failure });
    }
    const plan = ran.result.output;
    this.plan = { ...this.plan, output: plan };
    if (plan.outcome === "no_plan") return this.finished({ rejection: { stage: "model", reason: `no_plan: ${plan.reason}` } });
    input.log(`${input.label}: planned ${plan.tasks.length} subtasks: ${plan.tasks.map((task) => `${task.id}${task.blockedBy.length === 0 ? "" : ` after ${task.blockedBy.join(", ")}`}`).join("; ")}.`);
    return this.implement(plan);
  }

  /** Runs the subtasks in waves (each subtask once its blockers are done), checks each wave and joins them. */
  private async implement(plan: PlanOutput): Promise<JobsOutcome> {
    const { input } = this;
    const closure = blockerClosure(plan.tasks);
    let remaining = [...plan.tasks];
    while (remaining.length > 0) {
      const wave = remaining.filter((task) => task.blockedBy.every((blocker) => this.changes.has(blocker)));
      remaining = remaining.filter((task) => !wave.includes(task));
      if (this.minutesLeft() <= 0) {
        return this.finished({ rejection: { stage: "deadline", reason: `the deadline passed before subtask ${wave.map((task) => task.id).join(", ")} could start` } });
      }
      const settled = await Promise.allSettled(wave.map((task) => this.runSubtask(plan, task, closure.get(task.id)!)));
      const thrown = settled.find((item) => item.status === "rejected");
      const runs = settled.flatMap((item, index) => (item.status === "fulfilled" ? [{ task: wave[index]!, run: item.value }] : []));
      for (const { task, run } of runs) {
        if (run.kind === "not-started") continue;
        this.records.push(run.job.record);
        const result = run.job.result;
        this.outcomes.push({
          id: task.id, recordId: run.job.record.recordId, answer: result.ok ? result.output : null, failure: result.ok ? null : result.failure,
          files: run.changes.map((change) => change.path),
        });
      }
      if (thrown !== undefined) throw (thrown as PromiseRejectedResult).reason;
      const quota = runs.find(({ run }) => run.kind === "ran" && !run.job.result.ok && run.job.result.failure.kind === "quota_exhausted");
      if (quota !== undefined && quota.run.kind === "ran" && !quota.run.job.result.ok) return this.parked(quota.run.job.result.failure);
      // The subtasks that ran are judged first: a failure or a decline among them is the attempt's end, whether or not the budget stopped another.
      const decided = this.judgeWave(runs.flatMap(({ task, run }) => (run.kind === "ran" ? [{ task, run }] : [])));
      if (decided !== null) return decided;
      if (runs.some(({ run }) => run.kind === "not-started")) return { kind: "not-started", records: this.records, started: this.started, planned: this.work() };
    }
    const joined = joinChanges(this.snapshot(), plan.tasks.map((task) => ({ id: task.id, changes: this.changes.get(task.id)! })));
    if ("conflict" in joined) return this.finished({ rejection: conflictRejection(joined.conflict) });
    applyJoin(input.git.worktrees, joined.joined, input.workspace.source);
    // What the joined source changes against the source commit: a file a later subtask set back is not among them.
    const files = joinedPaths(this.snapshot(), joined.joined);
    return this.finished({ answer: { outcome: "patched", reason: plan.reason, summary: plan.summary, files } });
  }

  /** A failed, declining or mislisting subtask, or a conflict among the subtasks done so far, ends the attempt; null lets it go on. */
  private judgeWave(runs: readonly { task: Subtask; run: Extract<SubtaskRun, { kind: "ran" }> }[]): JobsOutcome | null {
    for (const { task, run } of runs) {
      const result = run.job.result;
      if (!result.ok) return this.finished({ failure: { kind: result.failure.kind, message: `subtask ${task.id}: ${result.failure.message}` } });
      if (result.output.outcome === "no_patch") return this.finished({ rejection: { stage: "model", reason: `subtask ${task.id}: no_patch: ${result.output.reason}` } });
    }
    for (const { task, run } of runs) {
      const answer = (run.job.result as { output: RepairOutput }).output;
      if (run.others.length > 0) {
        return this.finished({ rejection: { stage: "patch", reason: `subtask ${task.id}: ${run.others.map((path) => `${path} is neither a file nor a folder`).join("; ")}` } });
      }
      const changed = run.changes.map((change) => change.path);
      const unlisted = changed.filter((path) => !answer.files.includes(path));
      const unchanged = answer.files.filter((path) => !changed.includes(path));
      if (unlisted.length > 0 || unchanged.length > 0) {
        const parts = [unlisted.length > 0 ? `changed but not listed: ${unlisted.join(", ")}` : null, unchanged.length > 0 ? `listed but not changed: ${unchanged.join(", ")}` : null];
        return this.finished({ rejection: { stage: "patch", reason: `subtask ${task.id}: ${parts.filter((part) => part !== null).join("; ")}` } });
      }
      this.changes.set(task.id, run.changes);
    }
    const joined = joinChanges(this.snapshot(), [...this.changes].map(([id, changes]) => ({ id, changes })));
    return "conflict" in joined ? this.finished({ rejection: conflictRejection(joined.conflict) }) : null;
  }

  /** The content a subtask starts from: the join of its blockers, every one of them done. */
  private startOf(blockers: ReadonlySet<number>): Map<string, JoinedFile> {
    const joined = joinChanges(this.snapshot(), [...blockers].map((id) => ({ id, changes: this.changes.get(id)! })));
    // Blockers are joined after every wave, so their changes cannot conflict here.
    if ("conflict" in joined) throw new Error(`The blockers ${[...blockers].join(", ")} conflict on ${joined.conflict.path}, which their wave's join let through.`);
    return joined.joined;
  }

  private async runSubtask(plan: PlanOutput, task: Subtask, blockers: ReadonlySet<number>): Promise<SubtaskRun> {
    const { input } = this;
    const scratch = input.createScratchFolder("workflow-subtask-");
    const copy = workspaceIn(scratch, input.jobs.clusterId);
    const start = this.startOf(blockers);
    const label = `${input.label} subtask ${task.id}`;
    const { worktrees } = input.git;
    // The commit the subtask starts from: the source commit with its blockers' join, once its worktree is made.
    let startCommit = input.git.source;
    const guard = new WorktreeGuard(worktrees);
    let failing = false;
    try {
      const job = await runRecordedJob<RepairOutput>(input.jobs, {
        label, recordId: `${input.recordId}/task-${task.id}`, promptVersion: subtaskPromptVersion,
        prompt: subtaskPrompt(input.brief, plan, task, { sourceFolder: copy.source, contextFolder: copy.context }),
        images: crops(input.manifest, copy.context), schema: RepairOutputSchema, validate: validateRepair,
        workspace: { folder: copy.source, readOnly: [copy.context], writable: true },
        timeoutMinutes: () => Math.max(Math.min(input.jobs.choice.timeoutMinutes, this.minutesLeft()), 1 / 60), logFile: input.logFile(`-task-${task.id}`),
        stage: () => stageWorkspace(copy, input.contextFolder, (folder) => {
          worktrees.add(folder, input.git.subtaskBranch(task.id), input.git.source);
          applyJoin(worktrees, start, folder);
          startCommit = worktrees.commitAll(folder, `Start of subtask ${task.id}: the changes of the subtasks that block it\n`) ?? input.git.source;
          guard.record(folder);
        }),
        outside: () => changesOutsideSource(copy, input.contextFolder, guard),
      });
      if (job === null) return { kind: "not-started" };
      // Whatever the job left is the subtask's commit; only an answer makes it the subtask's change.
      const commit = worktrees.commitAll(copy.source, `Subtask ${task.id}: ${task.title}\n`);
      const { changes, others } = job.result.ok ? subtaskChanges(worktrees, startCommit, commit) : { changes: [], others: [] };
      input.log(`${label}: ${job.result.ok ? `${job.result.output.outcome}, ${changes.length + others.length} files changed` : `${job.result.failure.kind}: ${job.result.failure.message}`}`);
      return { kind: "ran", job, changes, others };
    } catch (error) {
      failing = true;
      throw error;
    } finally {
      removeWorkspace(worktrees, copy, scratch, label, input.log, failing);
    }
  }
}

function conflictRejection(conflict: Conflict): { stage: RepairStage; reason: string } {
  if (conflict.other !== undefined) {
    const by = conflict.first === conflict.second ? `subtask ${conflict.second}` : `subtasks ${conflict.first} and ${conflict.second}`;
    return { stage: "patch", reason: `${by} left ${conflict.path} and ${conflict.other} where one is a file and the other lies inside it, which cannot both exist` };
  }
  return { stage: "patch", reason: `subtasks ${conflict.first} and ${conflict.second} both changed ${conflict.path}, and ${conflict.first} does not block ${conflict.second}` };
}
