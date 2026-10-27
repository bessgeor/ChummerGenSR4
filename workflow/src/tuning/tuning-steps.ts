import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Git } from "../diagnosis/source-snapshot.js";
import { readBenchmark } from "../evals/benchmark.js";
import { freezeDataset } from "../evals/dataset.js";
import { listRecords } from "../evals/eval-record.js";
import { snapshotBaseCheck } from "../evals/snapshot-base.js";
import { SetupError } from "../host/setup-error.js";
import type { WorkflowPaths } from "../paths.js";
import { finishAutoTuning, readAutoTuning, recordAutoTuning, startAutoTuning, type AutoTuningEntry } from "./auto-tuning.js";
import { cycleActivation, cycleBaseline, cycleFolder, cycleHoldout, cycleOptions, cycleProposal, cycleTestBaseline, ensureCycle, readCycle, recoverCycle, type CycleDependencies } from "./cycle.js";
import { defaultMaximumExposures } from "./holdout.js";
import type { TuningRequest, TuningStateValue, TuningSteps } from "./tuning-graph.js";

/** The automatic dataset's seed and test share: fixed, so every version keeps each cluster in its partition. */
export const autoDatasetSeed = "auto";
export const autoDatasetTestPercent = 50;

export type TuningStepsDependencies = {
  readonly cycle: CycleDependencies;
  readonly store: BaseStore;
  readonly paths: WorkflowPaths;
  readonly git: Git;
};

/** The cycle of an automatic tuning: its ID with the cycle prefix, so a resumed node finds the same cycle. */
export function autoCycleId(tuningId: string): string {
  return `tc-${tuningId.replace(/^tune-/, "")}`;
}

function cycleIdOf(state: TuningStateValue): string {
  return state.request.kind === "auto" ? autoCycleId(state.tuningId) : state.tuningId;
}

function autoRequest(state: TuningStateValue): Extract<TuningRequest, { kind: "auto" }> {
  if (state.request.kind !== "auto") throw new Error(`Tuning thread ${state.tuningId} is a tune cycle, not an automatic tuning.`);
  return state.request;
}

function inProgress(evalsFolder: string, tuningId: string): AutoTuningEntry {
  const current = readAutoTuning(evalsFolder).current;
  if (current?.tuningId !== tuningId) throw new SetupError(`The automatic tuning ${tuningId} is not in progress (in progress: ${current?.tuningId ?? "none"}).`);
  return current;
}

/** The tuning graph's steps, and what a thread does with its cycle before it continues. */
export type TuningRun = TuningSteps & {
  /** Finishes the thread's cycle when it was stopped after its activation was written, before it was recorded. */
  recover(state: TuningStateValue): void;
};

/** The tuning graph's steps over the cycle, the record store and the thread folders; making them does nothing. */
export function tuningSteps(dependencies: TuningStepsDependencies): TuningRun {
  const { cycle: cycles, store, paths, git } = dependencies;
  const { evalsFolder } = cycles;
  const { now, log } = cycles.run;
  return {
    recover(state) {
      const cycleId = cycleIdOf(state);
      if (existsSync(join(cycleFolder(evalsFolder, cycleId), "cycle.json"))) recoverCycle(cycles, cycleId);
    },
    count(state) {
      const request = autoRequest(state);
      startAutoTuning({ store, evalsFolder, now, newTuningId: () => state.tuningId },
        { kind: "due", records: request.records, every: request.settings.every, forced: request.forced });
    },
    async freeze(state) {
      const request = autoRequest(state);
      const recorded = inProgress(evalsFolder, state.tuningId).dataset;
      if (recorded !== null) return recorded;
      const { folder, dataset } = await freezeDataset({
        name: request.settings.dataset, jobKind: "hypothesis", seed: autoDatasetSeed, testPercent: autoDatasetTestPercent,
        reason: `automatic tuning after ${request.records.length} new hypothesis records`, datasetsFolder: join(evalsFolder, "datasets"),
        threadFolder: paths.threadFolder, records: await listRecords(store), benchmark: readBenchmark(paths.benchmark),
        snapshotBase: snapshotBaseCheck(git, paths.threadFolder), now, log,
      });
      const count = (partition: string) => dataset.items.filter((item) => item.partition === partition).length;
      log(`Automatic tuning ${state.tuningId}: dataset ${dataset.name} v${dataset.version}, ${dataset.items.length} items, ${count("test")} test and ${count("development")} development; ${folder}`);
      recordAutoTuning(evalsFolder, state.tuningId, { dataset: folder });
      return folder;
    },
    async baseline(state) {
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
    propose: (state) => cycleProposal(cycles, cycleIdOf(state)),
    holdout: (state) => cycleHoldout(cycles, cycleIdOf(state)),
    testBaseline: (state) => cycleTestBaseline(cycles, cycleIdOf(state)),
    activate: (state) => cycleActivation(cycles, cycleIdOf(state)),
    conclude(state) {
      const cycle = readCycle(evalsFolder, cycleIdOf(state));
      if (cycle.outcome === "running") throw new SetupError(`Tuning cycle ${cycle.cycleId} reached its conclusion while it is still running.`);
      if (state.request.kind === "auto") finishAutoTuning(evalsFolder, state.tuningId, cycle.outcome, now());
      return cycle;
    },
  };
}
