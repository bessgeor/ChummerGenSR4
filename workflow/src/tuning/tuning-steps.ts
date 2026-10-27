import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Git } from "../diagnosis/source-snapshot.js";
import { readBenchmark } from "../evals/benchmark.js";
import type { BranchGit } from "../git/branch-git.js";
import { DatasetSchema, freezeDataset } from "../evals/dataset.js";
import { listRecords } from "../evals/eval-record.js";
import { snapshotBaseCheck } from "../evals/snapshot-base.js";
import { SetupError } from "../host/setup-error.js";
import type { WorkflowPaths } from "../paths.js";
import { readDocument } from "../steps/read-document.js";
import { currentTuning, readAutoTuning, recordAutoTuning, startAutoTuning, type AutoTuningEntry } from "./auto-tuning.js";
import { cycleActivation, cycleBaseline, cycleFolder, cycleHoldout, cycleOptions, cycleProposal, cycleTestBaseline, ensureCycle, readCycle, recoverCycle, type CycleDependencies } from "./cycle.js";
import { defaultMaximumExposures } from "./holdout.js";
import type { TuningRequest, TuningStateValue, TuningSteps } from "./tuning-graph.js";
import { datasetLabel, tuningCommitTrailer, TuningRepository, type TuningWorkspace } from "./tuning-workspace.js";

/** The automatic dataset's seed and test share: fixed, so every version keeps each cluster in its partition. */
export const autoDatasetSeed = "auto";
export const autoDatasetTestPercent = 50;

export type TuningStepsDependencies = {
  readonly cycle: CycleDependencies;
  readonly store: BaseStore;
  readonly paths: WorkflowPaths;
  readonly git: Git;
  /** The repository's git, for the worktree and merge of a tuning whose folders lie inside the repository. */
  readonly branchGit: BranchGit;
};

/** The cycle of an automatic tuning: its ID with the cycle prefix, so a resumed node finds the same cycle. */
export function autoCycleId(tuningId: string): string {
  return `tc-${tuningId.replace(/^tune-/, "")}`;
}

/** The reason an automatic tuning gives its dataset version: it names the tuning, so the version shows who froze it. */
function autoDatasetReason(tuningId: string, records: number): string {
  return `automatic tuning ${tuningId} after ${records} new hypothesis records`;
}

/** Whether the dataset version in `folder` is the one the automatic tuning froze, by what the freeze gives it. */
function frozenBy(folder: string, name: string, reason: string): boolean {
  const dataset = readDocument(join(folder, "dataset.json"), DatasetSchema);
  return dataset.name === name && dataset.jobKind === "hypothesis" && dataset.seed === autoDatasetSeed && dataset.testPercent === autoDatasetTestPercent
    && dataset.reason === reason && basename(folder) === `v${dataset.version}`;
}

function cycleIdOf(state: TuningStateValue): string {
  return state.request.kind === "auto" ? autoCycleId(state.tuningId) : state.tuningId;
}

function autoRequest(state: TuningStateValue): Extract<TuningRequest, { kind: "auto" }> {
  if (state.request.kind !== "auto") throw new Error(`Tuning thread ${state.tuningId} is a tune cycle, not an automatic tuning.`);
  return state.request;
}

function inProgress(evalsFolder: string, tuningId: string): AutoTuningEntry {
  return currentTuning(evalsFolder, readAutoTuning(evalsFolder), tuningId);
}

function workspaceOf(state: TuningStateValue): TuningWorkspace {
  if (state.workspace === null || state.workspace === undefined) throw new Error(`Tuning thread ${state.tuningId} has no worktree.`);
  return state.workspace;
}

/** The tuning graph's steps, and what a thread does with its cycle before it continues. */
export type TuningRun = TuningSteps & {
  /** Finishes the thread's cycle when it was stopped after its activation was written, before it was recorded. */
  recover(state: TuningStateValue): void;
};

/** The tuning graph's steps over the cycle, the record store and the thread folders; making them does nothing. */
export function tuningSteps(dependencies: TuningStepsDependencies): TuningRun {
  const { cycle: inPlace, store, paths, git } = dependencies;
  const { evalsFolder } = inPlace;
  const { now, log } = inPlace.run;
  const repository = new TuningRepository(dependencies.branchGit, paths.repositoryRoot);
  // The cycle's steps read and write the tuning and certificates folders in the tuning's worktree when it has one.
  const cyclesOf = (state: TuningStateValue): CycleDependencies => {
    if (state.workspace === null || state.workspace === undefined) return inPlace;
    repository.requireWorktree(state.workspace);
    return { ...inPlace, ...state.workspace.folders };
  };
  return {
    recover(state) {
      const cycleId = cycleIdOf(state);
      // A cycle that ended needs no recovery, and its worktree may be removed already.
      if (existsSync(join(cycleFolder(evalsFolder, cycleId), "cycle.json")) && readCycle(evalsFolder, cycleId).outcome === "running") recoverCycle(cyclesOf(state), cycleId);
    },
    count(state) {
      const request = autoRequest(state);
      startAutoTuning({ store, evalsFolder, now, newTuningId: () => state.tuningId },
        { kind: "due", records: request.records, every: request.settings.every, forced: request.forced, settings: request.settings });
    },
    async freeze(state) {
      const request = autoRequest(state);
      // The version's folder is recorded before the freeze puts it in place, so a freeze interrupted after that finds it instead
      // of freezing the next one. A version at the recorded folder is this tuning's only when it says so: a freeze by another
      // command that took the version meanwhile is not run on, the tuning records the next version instead.
      const datasetsFolder = join(evalsFolder, "datasets");
      const reason = autoDatasetReason(state.tuningId, request.records.length);
      const target = inProgress(evalsFolder, state.tuningId).dataset;
      if (target !== null && existsSync(join(target, "dataset.json"))) {
        if (frozenBy(target, request.settings.dataset, reason)) return target;
        log(`Automatic tuning ${state.tuningId}: ${target} was frozen by another command; freezing the next version of ${request.settings.dataset}.`);
      }
      // The freeze chooses the version under its lock and announces it, so no other freeze can take it in between.
      const { folder, dataset } = await freezeDataset({
        name: request.settings.dataset, jobKind: "hypothesis", seed: autoDatasetSeed, testPercent: autoDatasetTestPercent,
        reason, datasetsFolder,
        threadFolder: paths.threadFolder, records: await listRecords(store), benchmark: readBenchmark(paths.benchmark),
        snapshotBase: snapshotBaseCheck(git, paths.threadFolder), now, log,
        onVersion: (version) => recordAutoTuning(evalsFolder, state.tuningId, { dataset: version }),
      });
      const count = (partition: string) => dataset.items.filter((item) => item.partition === partition).length;
      log(`Automatic tuning ${state.tuningId}: dataset ${dataset.name} v${dataset.version}, ${dataset.items.length} items, ${count("test")} test and ${count("development")} development; ${folder}`);
      return folder;
    },
    worktree(state) {
      const folders = { tuningFolder: inPlace.tuningFolder, certificatesFolder: inPlace.certificatesFolder };
      const inside = repository.paths(folders);
      if (inside === null) {
        log(`Automatic tuning ${state.tuningId}: the tuning and certificates folders lie outside the repository; the cycle works on them in place.`);
        return null;
      }
      const cycleId = cycleIdOf(state);
      const workspace = repository.open(cycleId, join(cycleFolder(evalsFolder, cycleId), "worktree"), folders);
      recordAutoTuning(evalsFolder, state.tuningId, { branch: workspace.branch });
      log(`Automatic tuning ${state.tuningId}: the cycle works on ${inside.join(" and ")} in the worktree ${workspace.folder} on ${workspace.branch}, started at ${workspace.target} ${workspace.start}.`);
      return workspace;
    },
    async baseline(state) {
      const cycles = cyclesOf(state);
      const cycleId = cycleIdOf(state);
      if (state.request.kind === "auto") {
        const { settings } = state.request;
        ensureCycle(cycles, cycleId, cycleOptions({
          dataset: state.dataset!, metric: null, minPass: settings.minPass, candidates: settings.candidates, repeat: 1, maxExposures: defaultMaximumExposures, maxMeanCostUsd: null,
        }));
        if (inProgress(evalsFolder, state.tuningId).cycle === null) recordAutoTuning(evalsFolder, state.tuningId, { cycle: cycleId });
      } else {
        ensureCycle(cycles, cycleId, state.request.options);
      }
      return cycleBaseline(cycles, cycleId);
    },
    propose: (state) => cycleProposal(cyclesOf(state), cycleIdOf(state)),
    holdout: (state) => cycleHoldout(cyclesOf(state), cycleIdOf(state)),
    testBaseline: (state) => cycleTestBaseline(cyclesOf(state), cycleIdOf(state)),
    activate: (state) => cycleActivation(cyclesOf(state), cycleIdOf(state)),
    conclude(state) {
      const cycle = readCycle(evalsFolder, cycleIdOf(state));
      if (cycle.outcome === "running") throw new SetupError(`Tuning cycle ${cycle.cycleId} reached its conclusion while it is still running.`);
      return cycle;
    },
    commit(state) {
      const workspace = workspaceOf(state);
      const cycle = state.concluded!;
      const message = `Tune ${cycle.jobKind}: ${cycle.outcome}

Cycle ${cycle.cycleId} of the automatic tuning ${state.tuningId} on the dataset ${datasetLabel(cycle.options.dataset)}.

${tuningCommitTrailer}: ${cycle.cycleId}
`;
      const commit = repository.commit(workspace, cycle.cycleId, message);
      recordAutoTuning(evalsFolder, state.tuningId, { commit });
      log(commit === null
        ? `Automatic tuning ${state.tuningId}: the cycle changed nothing in ${workspace.paths.join(" and ")}; nothing to merge.`
        : `Automatic tuning ${state.tuningId}: committed ${commit} on ${workspace.branch}.`);
      return commit;
    },
    merge(state) {
      const workspace = workspaceOf(state);
      const cycle = state.concluded!;
      // The worktree has done its work, and the merge checks out the tuning branch to rebase it.
      repository.remove(workspace);
      if (state.tuningCommit === null || state.tuningCommit === undefined) return null;
      const { merge, commit } = repository.merge(workspace, cycle.cycleId, join(cycleFolder(evalsFolder, cycle.cycleId), "merge"),
        `Merge ${workspace.branch}: ${cycle.jobKind} ${cycle.outcome}`, [{ key: "Tuning", value: state.tuningId }]);
      recordAutoTuning(evalsFolder, state.tuningId, { commit, merge });
      log(`Automatic tuning ${state.tuningId}: merged ${workspace.branch} into ${workspace.target} as ${merge}.`);
      return merge;
    },
  };
}
