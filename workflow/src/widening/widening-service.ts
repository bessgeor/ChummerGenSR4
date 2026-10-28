import { cpSync, existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import type { PlannedCase } from "../cases/case-plan.js";
import type { ClusterDiagnosis } from "../diagnosis/cluster-diagnosis.js";
import { readSealedManifest } from "../diagnosis/diagnosis-service.js";
import { setLabels } from "../evals/eval-record.js";
import { fixArchiveInRepository, type FixChangeArchiver } from "../fixes/fix-archiver.js";
import { fixChangeFiles } from "../fixes/fix-documents.js";
import { fixLevel } from "../fixes/fix-draft.js";
import { FixRecordSchema } from "../fixes/fix-record.js";
import { compiledFolders } from "../compiled-source.js";
import type { BranchGit } from "../git/branch-git.js";
import { snapshotFolders } from "../diagnosis/source-snapshot.js";
import { requireSourceOfSnapshot, sourceMessage, threadBranches } from "../git/thread-source.js";
import type { Worktrees } from "../git/worktrees.js";
import { SetupError } from "../host/setup-error.js";
import { usesFixChanges, type RunOptions } from "../options/run-options.js";
import { judgeNarrowCheck, type AttemptBuild } from "../repair/attempt-host.js";
import type { CheckExecution, ClusterRepair } from "../repair/cluster-repair.js";
import { requireCoveredCases } from "../steps/capture-step.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import { readDocument } from "../steps/read-document.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";
import { AcceptedBranch, promote } from "./accepted-branch.js";
import { attribute, BaselineIndex, blocks, key, readResults, type Finding } from "./attribution.js";
import type { AcceptedState, ClusterWidening, LevelResult, WideningStage, WideningUpdate } from "./cluster-widening.js";
import { levelSelection, nextLevel, type LevelName } from "./ladder.js";
import type { LevelCapture } from "./level-capture.js";
import { describeWidening, wideningDocument, writeJson } from "./widening-report.js";

export type WideningDependencies = {
  readonly threadFolder: (threadId: string) => string;
  readonly build: AttemptBuild;
  readonly capture: LevelCapture;
  /** Every case of a case file. */
  readonly allCases: (caseFile: string) => readonly PlannedCase[];
  readonly git: BranchGit;
  readonly worktrees: Worktrees;
  /** The repository's fixes root and the archiver that turns a promoted attempt's fix record into an archived fix change. */
  readonly fixes: { readonly root: string; readonly archive: FixChangeArchiver };
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** What the pixels of a level or baseline capture depend on besides the executable. */
  readonly inputs: {
    /** The capture runner's fingerprint of the environment. */
    readonly environment: (signal?: AbortSignal) => Promise<string>;
    /** The names of the thread's inputs that changed since it started; empty when none did. */
    readonly changed: (options: RunOptions, fingerprints: InputFingerprints) => Promise<readonly string[]>;
  };
};

/** A capture run of the thread's candidate, which is the accepted source until a promotion. */
export type CandidateRun = { readonly runFolder: string; readonly status: 0 | 1 | 2 };

export type WideningPrepareInput = {
  readonly threadId: string;
  readonly repairs: Readonly<Record<string, ClusterRepair>>;
  readonly clusters: Readonly<Record<string, ClusterDiagnosis>>;
  readonly triagePath: string;
  /** The runs of the thread's candidate, oldest first: its capture runs and its diagnosis check run. */
  readonly candidateRuns: readonly CandidateRun[];
  /** The thread's widenings so far: a passed attempt that has one is not widened again. */
  readonly widenings: Readonly<Record<string, ClusterWidening>>;
  /** The source accepted so far, kept as it is; null before the thread's first widening. */
  readonly accepted: AcceptedState | null;
};

export type WideningInput = {
  readonly threadId: string;
  readonly options: RunOptions;
  /** The fingerprints of the thread's inputs, taken when it started. */
  readonly fingerprints: InputFingerprints;
  readonly widening: ClusterWidening;
  readonly accepted: AcceptedState;
  readonly signal?: AbortSignal;
};

/** A step's change to its widening, and the accepted state when the step changed it. */
export type WideningStep = { readonly update: WideningUpdate; readonly accepted: AcceptedState | null };

const executable = (build: string) => join(build, "bin", "ChummerGenSR4.exe");

/** Where a fix commit holds its archived fix change, relative to the repository. */
const fixArchiveFolder = fixArchiveInRepository();

/** What widening reads from a repair archive's `attempt.json`. */
const ArchivedAttemptSchema = z.object({
  recordId: z.string(),
  /** Absent in an archive made before attempts had commits. */
  commit: z.string().nullable().optional(),
  outcome: z.enum(["passed", "rejected"]),
  answer: z.object({ summary: z.string() }).nullable(),
  patch: z.object({
    files: z.array(z.object({
      path: z.string(), change: z.enum(["added", "modified", "deleted"]), before: z.string().nullable(), after: z.string().nullable(),
      added: z.number(), removed: z.number(), binary: z.boolean(),
    })),
  }).nullable(),
  /** Absent in an archive written before attempts had tries. */
  tries: z.array(z.object({ try: z.number().int().positive(), recordId: z.string(), commit: z.string().nullable(), selected: z.boolean() })).optional(),
  selectedTry: z.number().int().positive().nullable().optional(),
});

/** The commit a widening starts at: the accepted branch's after a promotion, else the thread's source commit. */
function acceptedCommit(accepted: AcceptedState): string {
  const commit = accepted.commit ?? accepted.sourceCommit;
  if (commit === undefined) throw new SetupError("The thread's accepted state names no source commit; it was stored before widening worked in worktrees. Start a new thread.");
  return commit;
}

/**
 * The files an attempt commit changes whose blob in the accepted commit is not the one they had in the attempt commit's
 * parent (an added file must be absent there), and the files it adds whose path the accepted commit uses as a folder, or
 * has a file inside: the attempt cannot be applied while any is listed.
 */
export function staleFiles(worktrees: Worktrees, attemptCommit: string, accepted: string): string[] {
  const changes = worktrees.changes(worktrees.parent(attemptCommit), attemptCommit);
  const stale = new Set(changes.filter((change) => worktrees.blob(accepted, change.path) !== change.before).map((change) => change.path));
  const added = changes.filter((change) => change.before === null && change.after !== null);
  if (added.length > 0) {
    const deleted = new Set(changes.filter((change) => change.after === null).map((change) => change.path));
    const kept = [...worktrees.blobs(accepted).keys()].filter((path) => !deleted.has(path));
    const keptFiles = new Set(kept);
    for (const { path } of added) {
      const parts = path.split("/");
      const insideFile = parts.slice(1).some((_, index) => keptFiles.has(parts.slice(0, index + 1).join("/")));
      if (insideFile || kept.some((other) => other.startsWith(`${path}/`))) stale.add(path);
    }
  }
  return [...stale].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** A passed attempt's `attempt.json`, whose top level, when it made tries, must be its one selected try's. */
export function readAttempt(archive: string) {
  const attempt = readDocument(join(archive, "attempt.json"), ArchivedAttemptSchema);
  if (attempt.outcome !== "passed" || attempt.patch === null || attempt.answer === null) throw new SetupError(`The repair archive ${archive} is not of a passed attempt with a patch.`);
  // The top level is the selected try's: its record and commit are the ones widened, and no other try is.
  if (attempt.tries !== undefined || attempt.selectedTry !== undefined) {
    const tries = attempt.tries ?? [];
    const selected = tries.filter((item) => item.selected);
    if (selected.length !== 1 || new Set(tries.map((item) => item.try)).size !== tries.length || selected[0]!.try !== attempt.selectedTry
      || selected[0]!.recordId !== attempt.recordId || selected[0]!.commit !== (attempt.commit ?? null)) {
      throw new SetupError(`The repair archive ${archive} does not keep its one selected try's record and commit at its top level; restore it or start a new thread.`);
    }
  }
  return { ...attempt, patch: attempt.patch, answer: attempt.answer };
}

/** The selected try and the number of tries of a passed attempt's archive, for its widening; none for an archive written before attempts had tries. */
function selectionOf(attempt: ReturnType<typeof readAttempt>): Pick<ClusterWidening, "selectedTry" | "tries"> {
  return attempt.tries === undefined ? {} : { selectedTry: attempt.selectedTry!, tries: attempt.tries.length };
}

/** Widening on the real host: the widened candidate, one level per step, promotion on the accepted branch and rollback. */
export class WideningService {
  constructor(private readonly dependencies: WideningDependencies) {}

  /**
   * A widening for each cluster whose latest repair attempt passed and has none yet, and the accepted state: the one the
   * thread has, else that of the thread's snapshot, or null when nothing is widened. Only candidate runs without
   * execution failures are baselines.
   */
  prepare(input: WideningPrepareInput): { widenings: Record<string, ClusterWidening>; accepted: AcceptedState | null } {
    const passed = Object.values(input.repairs).filter((repair) => repair.status === "passed" && repair.attempt !== null && input.widenings[repair.clusterId] === undefined);
    if (passed.length === 0) return { widenings: {}, accepted: input.accepted };
    const triage = readDocument(input.triagePath, TriageDocumentSchema);
    const threadFolder = this.dependencies.threadFolder(input.threadId);
    const widenings: Record<string, ClusterWidening> = {};
    let base: string | null = null;
    for (const repair of passed) {
      const cluster = triage.clusters.find((item) => item.id === repair.clusterId);
      const diagnosis = input.clusters[repair.clusterId];
      if (cluster === undefined || diagnosis === undefined) throw new SetupError(`Triage or diagnosis has no cluster ${repair.clusterId}, whose repair passed.`);
      base ??= readSealedManifest(diagnosis).source.commit;
      const archived = readAttempt(repair.attempt!.folder);
      if (archived.recordId !== repair.attempt!.recordId) throw new SetupError(`The repair archive ${repair.attempt!.folder} is of record ${archived.recordId}, not of the thread's ${repair.attempt!.recordId}.`);
      widenings[repair.clusterId] = {
        clusterId: repair.clusterId, attempt: repair.attempt!.attempt, recordId: repair.attempt!.recordId, archive: repair.attempt!.folder,
        ...selectionOf(archived),
        folder: join(threadFolder, "widening", repair.clusterId, `attempt-${repair.attempt!.attempt}`), scope: { cases: cluster.cases, captures: cluster.captures },
        targets: [...new Set(cluster.members.map((member) => key(member.case, member.capture)))],
        status: "pending", build: null, levels: [], rejection: null, commit: null,
      };
    }
    if (input.accepted !== null) return { widenings, accepted: input.accepted };
    const baselineRuns: string[] = [];
    for (const run of input.candidateRuns) {
      const { execution } = judgeNarrowCheck(run.status, run.runFolder);
      if (execution.status === 2 || !execution.coverageValid) {
        this.dependencies.log(`Widening: the run ${run.runFolder} had execution failures, so its rows are no baseline.`);
      } else {
        baselineRuns.push(run.runFolder);
      }
    }
    const sourceCommit = this.dependencies.worktrees.resolve(`refs/heads/${threadBranches.source(input.threadId)}`);
    if (sourceCommit === null) throw new SetupError(`The thread's source branch ${threadBranches.source(input.threadId)} does not exist, though its repair passed; restore it or start a new thread.`);
    this.requireThreadSource(input.threadId, sourceCommit, base!);
    requireSourceOfSnapshot(this.dependencies.git, input.threadId, sourceCommit, base!, join(threadFolder, "diagnosis", "source"), join(threadFolder, "widening", "source.index"));
    const accepted: AcceptedState = {
      branch: `accepted/${input.threadId}`, base: base!, sourceCommit, commit: null, source: join(threadFolder, "diagnosis", "source"), build: null,
      baselineRuns, promoted: [],
    };
    return { widenings, accepted };
  }

  /**
   * Fails unless the source branch still holds what the thread made of its snapshot: the snapshot's commit, or a commit on
   * it that changes only the snapshot's folders and carries the thread's message. A branch that moved is not the source
   * the attempts were made on.
   */
  private requireThreadSource(threadId: string, sourceCommit: string, base: string): void {
    const { worktrees, git } = this.dependencies;
    const moved = new SetupError(`The thread's source branch ${threadBranches.source(threadId)} is at ${sourceCommit}, which is neither the snapshot's commit ${base} nor the thread's commit of the snapshot's folders on it; it moved after the attempts were made. Restore it or start a new thread.`);
    if (sourceCommit === base) return;
    if (worktrees.parent(sourceCommit) !== base) throw moved;
    if (git(["log", "-1", "--format=%B", sourceCommit]).trim() !== sourceMessage(threadId).trim()) throw moved;
    const outside = worktrees.changes(base, sourceCommit).filter((change) => !snapshotFolders.some((folder) => change.path.startsWith(`${folder}/`)));
    if (outside.length > 0) throw moved;
  }

  /** Fails when an input the pixels depend on is not the one the thread started with: its level runs would differ from the baselines for that reason. */
  private async requireSameInputs(input: WideningInput, label: string): Promise<void> {
    const changed = [...await this.dependencies.inputs.changed(input.options, input.fingerprints)];
    if (await this.dependencies.inputs.environment(input.signal) !== input.fingerprints.environment) changed.push("environment");
    if (changed.length > 0) throw new SetupError(`${label}: inputs changed since the thread started (${changed.join(", ")}); start a new thread.`);
  }

  /** The next step of a widening that is not verified or failed: the widened candidate first, then one level. */
  async widen(input: WideningInput): Promise<WideningStep> {
    if (input.widening.status === "pending") return this.prepareCandidate(input);
    if (input.widening.status === "widening") return this.runLevel(input);
    throw new Error(`Widening ${input.widening.clusterId} is ${input.widening.status}; it has no level to run.`);
  }

  private async prepareCandidate(input: WideningInput): Promise<WideningStep> {
    const { widening, accepted } = input;
    const label = `widen ${widening.clusterId}`;
    const attempt = readAttempt(widening.archive);
    const { worktrees } = this.dependencies;
    if (attempt.commit === undefined || attempt.commit === null) {
      throw new SetupError(`The passed attempt ${widening.archive} names no attempt commit, so it cannot be applied with git; start a new thread.`);
    }
    const start = acceptedCommit(accepted);
    // The attempt was made on the thread's source commit, which the accepted state holds as it was verified.
    if (accepted.sourceCommit !== undefined && worktrees.parent(attempt.commit) !== accepted.sourceCommit) {
      throw new SetupError(`The attempt commit ${attempt.commit} of ${widening.archive} was not made on the thread's source commit ${accepted.sourceCommit}; start a new thread.`);
    }
    const missing = worktrees.missingFolders(start, compiledFolders);
    if (missing.length > 0) throw new SetupError(`The accepted commit ${start} has no ${missing.map((folder) => `${folder}/`).join(" or ")}, which the candidate is compiled from.`);
    const source = join(widening.folder, "source");
    // A step interrupted after its worktree was made starts again from nothing.
    worktrees.remove(source);
    rmSync(widening.folder, { recursive: true, force: true });
    // The branch is made before the patch is looked at, so a rejected attempt keeps it; the rollback removes the worktree.
    worktrees.add(source, threadBranches.widening(input.threadId, widening.clusterId, widening.attempt), start);
    const conflicts = staleFiles(worktrees, attempt.commit, start);
    if (conflicts.length > 0) {
      return this.failed(widening, "apply", `the patch does not apply to the accepted source: ${conflicts.join(", ")} differ in the accepted source from what the patch was made on`, false);
    }
    this.dependencies.git(["cherry-pick", "--no-commit", attempt.commit], { worktree: source });
    this.dependencies.log(`${label}: building the patch on the accepted source.`);
    const started = this.dependencies.now().getTime();
    const status = await this.dependencies.build({
      label: `${label} build`, source, output: join(widening.folder, "build"), log: join(widening.folder, "build.log"), signal: input.signal ?? new AbortController().signal,
    });
    const build = { status, durationMs: this.dependencies.now().getTime() - started };
    if (status === 1) return { update: { clusterId: widening.clusterId, build, status: "failed", rejection: { stage: "build", reason: "the widened source does not build; see build.log", executionFailure: false } }, accepted: null };
    if (status !== 0) throw new SetupError(`${label}: the build script exited with ${status} (see its output above).`);
    return { update: { clusterId: widening.clusterId, build, status: "widening" }, accepted: null };
  }

  private async runLevel(input: WideningInput): Promise<WideningStep> {
    const { widening, options } = input;
    const level = nextLevel(widening.levels.at(-1)?.level ?? null);
    if (level === null) throw new Error(`Widening ${widening.clusterId} ran every level but is not verified.`);
    const selection = levelSelection(level, this.dependencies.allCases(options.caseFile), widening.scope);
    const label = `widen ${widening.clusterId} ${level}`;
    let accepted = input.accepted;
    let result: LevelResult;
    if (selection.cases.length === 0) {
      this.dependencies.log(`${label}: nothing new to capture.`);
      result = { level, ...selection, run: null, baseline: null, findings: [], outcome: "nothing-new", reason: null, executionFailure: false };
    } else {
      const signal = input.signal === undefined ? {} : { signal: input.signal };
      await this.requireSameInputs(input, label);
      const ran = await this.dependencies.capture({ label, ...selection, candidateExecutable: executable(join(widening.folder, "build")), options, ...signal });
      requireCoveredCases(label, ran.runFolder, selection.cases);
      const run = judgeNarrowCheck(ran.status, ran.runFolder).execution;
      const judged = await this.judge(input, label, level, run, accepted);
      accepted = judged.accepted;
      result = { level, ...selection, run, ...judged.result };
    }
    this.dependencies.log(`${label}: ${result.outcome}${result.reason === null ? "" : `: ${result.reason}`}`);
    const update: WideningUpdate = { clusterId: widening.clusterId, levels: [...widening.levels, result] };
    const step = result.outcome === "failed"
      ? { ...update, status: "failed" as const, rejection: { stage: level, reason: result.reason ?? "the level failed", executionFailure: result.executionFailure } }
      : { ...update, status: level === "suite" ? "verified" as const : "widening" as const };
    return { update: step, accepted: accepted === input.accepted ? null : accepted };
  }

  /** Attributes a level run's failing rows, capturing the accepted build first for rows without a baseline. */
  private async judge(input: WideningInput, label: string, level: LevelName, run: CheckExecution, start: AcceptedState): Promise<{ result: Omit<LevelResult, "level" | "cases" | "captures" | "run">; accepted: AcceptedState }> {
    let accepted = start;
    const lost = (execution: CheckExecution, what: string) => ({
      result: { baseline: what === "baseline capture" ? execution : null, findings: [], outcome: "failed" as const, executionFailure: true,
        reason: `execution failure in the ${what}: capture status ${execution.status}, coverage ${execution.coverageValid ? "valid" : `invalid (${execution.invalidReasons.join("; ")})`}` },
      accepted,
    });
    if (run.status === 2 || !run.coverageValid) return lost(run, "level run");
    const failing = readResults(run.runFolder).results.filter((row) => !row.passed).map((row) => ({ runFolder: run.runFolder, row }));
    const targets = new Set(input.widening.targets);
    const index = new BaselineIndex(accepted.baselineRuns);
    const missing = failing.filter((found) => !targets.has(key(found.row.case, found.row.capture)) && index.find(found.row.case, found.row.capture) === null);
    let baseline: CheckExecution | null = null;
    if (missing.length > 0) {
      accepted = await this.acceptedBuild(input, accepted);
      const cases = [...new Set(missing.map((found) => found.row.case))];
      await this.requireSameInputs(input, `${label} baseline`);
      const ran = await this.dependencies.capture({
        label: `${label} baseline`, cases, captures: [...new Set(missing.map((found) => found.row.capture))],
        candidateExecutable: executable(accepted.build!), options: input.options, ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      requireCoveredCases(`${label} baseline`, ran.runFolder, cases);
      baseline = judgeNarrowCheck(ran.status, ran.runFolder).execution;
      if (baseline.status === 2 || !baseline.coverageValid) return lost(baseline, "baseline capture");
      accepted = { ...accepted, baselineRuns: [...accepted.baselineRuns, ran.runFolder] };
      index.add(ran.runFolder);
    }
    const threshold = readResults(run.runFolder).threshold;
    const findings: Finding[] = failing.map((found) => attribute(found, targets, index.find(found.row.case, found.row.capture), threshold));
    const blocking = findings.filter(blocks);
    return {
      result: {
        baseline, findings, outcome: blocking.length === 0 ? "passed" : "failed", executionFailure: false,
        reason: blocking.length === 0 ? null : blocking.map((finding) => `${finding.case}/${finding.capture} ${finding.attribution}`).join(", "),
      },
      accepted,
    };
  }

  /** The accepted build: the promoted attempt's, or the snapshot built once into `widening/accepted/`. */
  private async acceptedBuild(input: WideningInput, accepted: AcceptedState): Promise<AcceptedState> {
    if (accepted.build !== null) return accepted;
    const folder = join(this.dependencies.threadFolder(input.threadId), "widening", "accepted");
    rmSync(folder, { recursive: true, force: true });
    this.dependencies.log(`widen ${input.widening.clusterId}: building the accepted source for a baseline capture.`);
    const status = await this.dependencies.build({
      label: "build accepted source", source: accepted.source, output: join(folder, "build"), log: join(folder, "build.log"), signal: input.signal ?? new AbortController().signal,
    });
    if (status !== 0) throw new SetupError(`The accepted source, which the thread's candidate was built from, did not build (exit ${status}); see ${join(folder, "build.log")}.`);
    return { ...accepted, build: join(folder, "build") };
  }

  /** Commits a verified widening on the accepted branch; its source, build and level runs become the accepted state. */
  async promote(input: WideningInput, store: BaseStore): Promise<WideningStep> {
    const { widening, accepted } = input;
    if (widening.status !== "verified") throw new Error(`Widening ${widening.clusterId} is ${widening.status}, not verified.`);
    const attempt = readAttempt(widening.archive);
    const branch = new AcceptedBranch(this.dependencies.git, input.threadId);
    const worktree = join(widening.folder, "source");
    const { worktrees } = this.dependencies;
    // A promotion committed before an interruption is taken as it is; nothing is archived again.
    const committed = branch.promotedRecord(widening.recordId) || worktrees.trailer(worktrees.head(worktree), "Repair-Record") === widening.recordId;
    if (usesFixChanges(input.options) && !committed) this.archiveFixChange(widening);
    const commit = promote({
      branch, worktrees, accepted: accepted.commit, start: acceptedCommit(accepted), worktree,
      trailers: { thread: input.threadId, cluster: widening.clusterId, record: widening.recordId }, summary: attempt.answer.summary,
    });
    // The rollback step removes the folders, so a promotion interrupted before its checkpoint can be repeated.
    if (commit === null) return this.failed(widening, "promote", "the widened source stages the same tree as the accepted source, so there is nothing to commit", false);
    const next: AcceptedState = {
      ...accepted, commit, source: join(widening.folder, "source"), build: join(widening.folder, "build"),
      baselineRuns: widening.levels.flatMap((level) => (level.run === null ? [] : [level.run.runFolder])), promoted: [...accepted.promoted, widening.clusterId],
    };
    return this.end({ ...widening, status: "promoted", commit }, store, next);
  }

  /**
   * Completes the fix change the attempt's repair drafted with the widening's levels, archives it through the OpenSpec
   * CLI and copies the archived change into the widened source; returns its path there, which the fix commit holds.
   */
  private archiveFixChange(widening: ClusterWidening): string {
    const draftPath = join(widening.archive, "fix", "fix.json");
    if (!existsSync(draftPath)) throw new SetupError(`The passed attempt ${widening.archive} has no fix change draft (fix/fix.json), which a thread with fix changes needs to promote it.`);
    const record = FixRecordSchema.parse({ ...readDocument(draftPath, FixRecordSchema), widening: widening.levels.map(fixLevel) });
    const archived = this.dependencies.fixes.archive({ fixesRoot: this.dependencies.fixes.root, staging: join(widening.folder, "fix-change"), name: record.name, files: fixChangeFiles(record) });
    const path = `${fixArchiveFolder}/${basename(archived)}`;
    const target = join(widening.folder, "source", path);
    rmSync(target, { recursive: true, force: true });
    cpSync(archived, target, { recursive: true });
    this.dependencies.log(`widen ${widening.clusterId}: fix change ${basename(archived)} archived for the fix commit.`);
    return path;
  }

  /** Discards a failed widening's candidate; the accepted branch is not touched. */
  async rollBack(input: WideningInput, store: BaseStore): Promise<WideningStep> {
    const { widening } = input;
    if (widening.status !== "failed") throw new Error(`Widening ${widening.clusterId} is ${widening.status}, not failed.`);
    this.discard(widening);
    return this.end({ ...widening, status: "rejected" }, store, null);
  }

  /** Removes a failed widening's worktree and build; its branch stays. */
  private discard(widening: ClusterWidening): void {
    this.dependencies.worktrees.remove(join(widening.folder, "source"));
    rmSync(join(widening.folder, "build"), { recursive: true, force: true });
  }

  /** Writes the cluster's `widening.json`, labels the repair record and returns the final update. */
  private async end(prepared: ClusterWidening, store: BaseStore, accepted: AcceptedState | null): Promise<WideningStep> {
    // A widening prepared before widenings named their try names it from its archive.
    const widening = prepared.tries === undefined ? { ...prepared, ...selectionOf(readAttempt(prepared.archive)) } : prepared;
    writeJson(join(widening.folder, "widening.json"), widening);
    await setLabels(store, { jobKind: "repair", recordId: widening.recordId }, {
      widening: {
        outcome: widening.status === "promoted" ? "promoted" : "rejected", stage: widening.rejection?.stage ?? null, reason: widening.rejection?.reason ?? null,
        commit: widening.commit, labelledUtc: this.dependencies.now().toISOString(),
      },
    });
    for (const line of describeWidening([widening], accepted, null).slice(0, 1)) this.dependencies.log(line);
    return { update: widening, accepted };
  }

  private failed(widening: ClusterWidening, stage: WideningStage, reason: string, executionFailure: boolean): WideningStep {
    return { update: { clusterId: widening.clusterId, status: "failed", rejection: { stage, reason, executionFailure } }, accepted: null };
  }

  /** Writes the thread's `widening.json` and returns its path. */
  finish(threadId: string, widenings: Readonly<Record<string, ClusterWidening>>, accepted: AcceptedState | null, earlier: readonly ClusterWidening[]): string {
    const path = join(this.dependencies.threadFolder(threadId), "widening.json");
    writeJson(path, wideningDocument(threadId, widenings, accepted, earlier));
    return path;
  }
}
