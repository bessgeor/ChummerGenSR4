import { rmSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import type { PlannedCase } from "../cases/case-plan.js";
import type { ClusterDiagnosis } from "../diagnosis/cluster-diagnosis.js";
import { readSealedManifest } from "../diagnosis/diagnosis-service.js";
import { setLabels } from "../evals/eval-record.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import { judgeNarrowCheck, type AttemptBuild } from "../repair/attempt-host.js";
import type { CheckExecution, ClusterRepair } from "../repair/cluster-repair.js";
import { requireCoveredCases } from "../steps/capture-step.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import { readDocument } from "../steps/read-document.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";
import { AcceptedBranch, promote, type BranchGit } from "./accepted-branch.js";
import { attribute, BaselineIndex, blocks, key, readResults, type Finding } from "./attribution.js";
import type { AcceptedState, ClusterWidening, LevelResult, WideningStage, WideningUpdate } from "./cluster-widening.js";
import { levelSelection, nextLevel, type LevelName } from "./ladder.js";
import type { LevelCapture } from "./level-capture.js";
import { describeWidening, wideningDocument, writeJson } from "./widening-report.js";
import { prepareWidenedSource } from "./widened-source.js";

export type WideningDependencies = {
  readonly threadFolder: (threadId: string) => string;
  readonly build: AttemptBuild;
  readonly capture: LevelCapture;
  /** Every case of a case file. */
  readonly allCases: (caseFile: string) => readonly PlannedCase[];
  readonly git: BranchGit;
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

/** What widening reads from a repair archive's `attempt.json`. */
const ArchivedAttemptSchema = z.object({
  recordId: z.string(),
  outcome: z.enum(["passed", "rejected"]),
  answer: z.object({ summary: z.string() }).nullable(),
  patch: z.object({
    files: z.array(z.object({
      path: z.string(), change: z.enum(["added", "modified", "deleted"]), before: z.string().nullable(), after: z.string().nullable(),
      added: z.number(), removed: z.number(), binary: z.boolean(),
    })),
  }).nullable(),
});

function readAttempt(archive: string) {
  const attempt = readDocument(join(archive, "attempt.json"), ArchivedAttemptSchema);
  if (attempt.outcome !== "passed" || attempt.patch === null || attempt.answer === null) throw new SetupError(`The repair archive ${archive} is not of a passed attempt with a patch.`);
  return { ...attempt, patch: attempt.patch, answer: attempt.answer };
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
      widenings[repair.clusterId] = {
        clusterId: repair.clusterId, attempt: repair.attempt!.attempt, recordId: repair.attempt!.recordId, archive: repair.attempt!.folder,
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
    const accepted: AcceptedState = {
      branch: `accepted/${input.threadId}`, base: base!, commit: null, source: join(threadFolder, "diagnosis", "source"), build: null,
      baselineRuns, promoted: [],
    };
    return { widenings, accepted };
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
    const source = join(widening.folder, "source");
    rmSync(widening.folder, { recursive: true, force: true });
    const conflicts = prepareWidenedSource(accepted.source, widening.archive, attempt.patch.files, source);
    if (conflicts.length > 0) {
      return this.failed(widening, "apply", `the patch does not apply to the accepted source: ${conflicts.join(", ")} changed since the patch was made`, false);
    }
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
    const branch = new AcceptedBranch(this.dependencies.git, input.threadId, join(widening.folder, "promote.index"));
    const commit = promote({
      branch, base: accepted.base, accepted: accepted.commit, snapshotFolder: join(this.dependencies.threadFolder(input.threadId), "diagnosis", "source"),
      widenedSource: join(widening.folder, "source"), trailers: { thread: input.threadId, cluster: widening.clusterId, record: widening.recordId }, summary: attempt.answer.summary,
    });
    // The rollback step removes the folders, so a promotion interrupted before its checkpoint can be repeated.
    if (commit === null) return this.failed(widening, "promote", "the widened source stages the same tree as the accepted source, so there is nothing to commit", false);
    const next: AcceptedState = {
      ...accepted, commit, source: join(widening.folder, "source"), build: join(widening.folder, "build"),
      baselineRuns: widening.levels.flatMap((level) => (level.run === null ? [] : [level.run.runFolder])), promoted: [...accepted.promoted, widening.clusterId],
    };
    return this.end({ ...widening, status: "promoted", commit }, store, next);
  }

  /** Discards a failed widening's candidate; the accepted branch is not touched. */
  async rollBack(input: WideningInput, store: BaseStore): Promise<WideningStep> {
    const { widening } = input;
    if (widening.status !== "failed") throw new Error(`Widening ${widening.clusterId} is ${widening.status}, not failed.`);
    this.discard(widening);
    return this.end({ ...widening, status: "rejected" }, store, null);
  }

  private discard(widening: ClusterWidening): void {
    for (const part of ["source", "build"]) rmSync(join(widening.folder, part), { recursive: true, force: true });
  }

  /** Writes the cluster's `widening.json`, labels the repair record and returns the final update. */
  private async end(widening: ClusterWidening, store: BaseStore, accepted: AcceptedState | null): Promise<WideningStep> {
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
