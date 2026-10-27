import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { compareRuns } from "../evals/comparison.js";
import { agentSettingsOf, datasetJobKind, resumeEvalRun, runFolders, startEvalRun, type EvalRunDependencies } from "../evals/eval-run.js";
import { metrics, metricsOfJobKind, requireMetric, type Metric } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { writeDocument } from "../steps/write-document.js";
import { activeTuning, ComparisonSummarySchema, readActiveFile } from "./active-configuration.js";
import { activate } from "./activation.js";
import { candidatesFolder, readCandidate } from "./candidates.js";
import { compareCandidates, comparisonSummary, passesDevelopmentGate, runState } from "./development.js";
import { activeOf, exposureOf, openHoldout, readLedger, type Exposure } from "./holdout.js";
import { proposeCandidate, type TuneDependencies } from "./propose.js";
import type { Tuning } from "./tuning.js";

const ProposalSchema = z.strictObject({
  outcome: z.enum(["candidate", "abstain", "failed"]),
  record: z.string(),
  reason: z.string(),
  candidate: z.string().nullable(),
  /** The candidate's development run, recorded before it starts. */
  run: z.string().nullable(),
  development: ComparisonSummarySchema.nullable(),
});

/** `cycle.json`: the cycle's options, each step's runs (recorded before the step starts), its results and outcome. */
export const CycleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cycleId: z.string().min(1),
  options: z.strictObject({
    dataset: z.string().min(1), metric: z.enum(metrics), minPass: z.number().min(0).max(1), candidates: z.number().int().min(1).max(3),
    repeat: z.number().int().positive(), maxExposures: z.number().int().min(1).max(3), maxMeanCostUsd: z.number().positive().nullable(),
  }),
  jobKind: z.enum(["hypothesis", "challenge", "rank", "scenario"]),
  /** The configuration that was active when the cycle started, `none` for the code's prompt. */
  active: z.string().min(1),
  startedUtc: z.string(),
  baseline: z.string().nullable(),
  proposals: z.array(ProposalSchema),
  selected: z.string().nullable(),
  holdout: z.strictObject({ run: z.string(), refused: z.array(z.string()).nullable() }).nullable(),
  testBaseline: z.string().nullable(),
  activation: z.strictObject({ refused: z.array(z.string()).nullable(), comparison: ComparisonSummarySchema.nullable() }).nullable(),
  outcome: z.enum(["running", "activated", "no_improvement", "rejected", "failed"]),
  reasons: z.array(z.string()),
  finishedUtc: z.string().nullable(),
});
export type Cycle = z.infer<typeof CycleSchema>;

export type CycleOptions = Cycle["options"];

export type CycleDependencies = {
  readonly run: EvalRunDependencies;
  readonly tune: TuneDependencies;
  readonly evalsFolder: string;
  readonly tuningFolder: string;
  readonly certificatesFolder: string;
  readonly newRunId: () => string;
};

export function cycleFolder(evalsFolder: string, cycleId: string): string {
  return join(evalsFolder, "tuning", "cycles", cycleId);
}

function cyclePath(evalsFolder: string, cycleId: string): string {
  return join(cycleFolder(evalsFolder, cycleId), "cycle.json");
}

export function readCycle(evalsFolder: string, cycleId: string): Cycle {
  const path = cyclePath(evalsFolder, cycleId);
  if (!existsSync(path)) throw new SetupError(`There is no tuning cycle ${cycleId} in ${join(evalsFolder, "tuning", "cycles")}.`);
  return readDocument(path, CycleSchema);
}

function save(evalsFolder: string, cycle: Cycle): Cycle {
  writeDocument(cyclePath(evalsFolder, cycle.cycleId), CycleSchema.parse(cycle));
  return cycle;
}

function folders(dependencies: CycleDependencies) {
  return { evalsFolder: dependencies.evalsFolder, tuningFolder: dependencies.tuningFolder, certificatesFolder: dependencies.certificatesFolder };
}

function thresholds(options: CycleOptions) {
  return { metric: options.metric, minPass: options.minPass, maxMeanCostUsd: options.maxMeanCostUsd };
}

/** A cycle's options as a command gives them: without a metric, the job kind's first. */
export type CycleRequest = Omit<CycleOptions, "metric"> & { metric: Metric | null };

/** The options of a new cycle, with the metric resolved and checked against the dataset's job kind. */
export function cycleOptions(request: CycleRequest): CycleOptions {
  const jobKind = datasetJobKind(request.dataset);
  const metric = request.metric ?? metricsOfJobKind[jobKind][0];
  requireMetric(jobKind, metric);
  return { ...request, metric };
}

/** Records a new cycle with its options and the active configuration; a cycle already recorded under the ID is kept as it is. */
export function ensureCycle(dependencies: CycleDependencies, cycleId: string, options: CycleOptions): Cycle {
  if (existsSync(cyclePath(dependencies.evalsFolder, cycleId))) return readCycle(dependencies.evalsFolder, cycleId);
  const jobKind = datasetJobKind(options.dataset);
  const cycle = save(dependencies.evalsFolder, {
    schemaVersion: 1, cycleId, options, jobKind, active: activeOf(dependencies.tuningFolder, jobKind),
    startedUtc: dependencies.run.now().toISOString(), baseline: null, proposals: [], selected: null, holdout: null, testBaseline: null, activation: null,
    outcome: "running", reasons: [], finishedUtc: null,
  });
  dependencies.run.log(`Tuning cycle ${cycleId}: ${jobKind} on ${options.dataset}, metric ${options.metric}, up to ${options.candidates} candidates; active: ${cycle.active}.`);
  return cycle;
}

/**
 * Finishes a run whose ID the cycle recorded: resumes it when its folder exists, starts it under that ID otherwise.
 * The ID is recorded before the run starts, so a cycle killed at any point finds its runs again.
 */
async function ensureRun(dependencies: CycleDependencies, runId: string, start: () => Parameters<typeof startEvalRun>[1]): Promise<void> {
  const folder = join(dependencies.run.runsFolder, runId);
  if (existsSync(runFolders(folder).settings)) {
    // A run whose samples are all written but whose summary is not was stopped before it ended; resuming writes the summary.
    if (!runState(folder).complete || !existsSync(runFolders(folder).summary)) await resumeEvalRun(dependencies.run, runId);
    return;
  }
  await startEvalRun({ ...dependencies.run, newRunId: () => runId }, start());
}

function finish(dependencies: CycleDependencies, cycle: Cycle, outcome: Cycle["outcome"], reasons: string[]): Cycle {
  dependencies.run.log(`Tuning cycle ${cycle.cycleId}: ${outcome}${reasons.length === 0 ? "" : `: ${reasons.join("; ")}`}.`);
  return save(dependencies.evalsFolder, { ...cycle, outcome, reasons, finishedUtc: dependencies.run.now().toISOString() });
}

/**
 * Before a stopped cycle continues: a cycle stopped after its activation was written, before it was recorded, finds the
 * activation by its holdout run, also when it has been rolled back or replaced since, and is finished `activated`: it is
 * never activated a second time. A cycle that is not running, or not stopped so, is returned as it is.
 */
export function recoverCycle(dependencies: CycleDependencies, cycleId: string): Cycle {
  const cycle = readCycle(dependencies.evalsFolder, cycleId);
  if (cycle.outcome !== "running") return cycle;
  const file = readActiveFile(dependencies.tuningFolder, cycle.jobKind);
  const activatedRun = cycle.holdout?.run;
  const activatedBy = (entry: { readonly evidence: { readonly test: { readonly candidate: string } } | null }) => entry.evidence?.test.candidate === activatedRun;
  if (file === null || activatedRun === undefined || ![file.active, ...file.history, ...file.rolledBack].some(activatedBy)) return cycle;
  if (activatedBy(file.active)) {
    activate(folders(dependencies), { run: activatedRun, baseline: cycle.testBaseline!, thresholds: thresholds(cycle.options) }, dependencies.run.now());
    return finish(dependencies, cycle, "activated", []);
  }
  return finish(dependencies, cycle, "activated", [file.rolledBack.some(activatedBy) ? "it has been rolled back since" : "it has been replaced since"]);
}

/**
 * Reads a cycle before one of its steps. A finished cycle is returned as it is; a running one needs the active
 * configuration it started with.
 */
function openCycle(dependencies: CycleDependencies, cycleId: string): Cycle {
  const cycle = readCycle(dependencies.evalsFolder, cycleId);
  if (cycle.outcome !== "running") return cycle;
  const { jobKind } = cycle;
  const activeNow = activeOf(dependencies.tuningFolder, jobKind);
  if (activeNow !== cycle.active) throw new SetupError(`The active ${jobKind} configuration changed from ${cycle.active} to ${activeNow} during tuning cycle ${cycle.cycleId}.`);
  return cycle;
}

/** Every run after the baseline uses the agent choice, pool and executables the baseline ran with. */
function runSettings(dependencies: CycleDependencies, cycle: Cycle) {
  const baseline = cycle.baseline === null ? null : join(dependencies.run.runsFolder, cycle.baseline);
  return baseline !== null && existsSync(runFolders(baseline).settings) ? agentSettingsOf(runState(baseline).settings) : dependencies.tune.settings;
}

/** The dataset, repetitions and agent choice of an exposure's test run: those of its own development runs. */
function onExposureOf(dependencies: CycleDependencies, held: Exposure) {
  const development = runState(join(dependencies.run.runsFolder, held.development.candidate)).settings;
  return { datasetFolder: development.dataset.folder, repeat: development.repeat, settings: agentSettingsOf(development) };
}

function runStart(dependencies: CycleDependencies, cycle: Cycle, partition: "development" | "test", tuning: Tuning | null, name: string, on?: ReturnType<typeof onExposureOf>) {
  return () => ({
    datasetFolder: on?.datasetFolder ?? cycle.options.dataset, partition, repeat: on?.repeat ?? cycle.options.repeat, name,
    settings: on?.settings ?? runSettings(dependencies, cycle), tuning,
  });
}

/** Whether the cycle still has a proposal to make or a candidate to measure on development. */
export function proposalsPending(cycle: Cycle): boolean {
  if (cycle.proposals.some((item) => item.outcome === "candidate" && item.development === null)) return true;
  return cycle.proposals.length < cycle.options.candidates && cycle.proposals.every((item) => item.outcome === "candidate");
}

/** Step 1: the development baseline of the active configuration. */
export async function cycleBaseline(dependencies: CycleDependencies, cycleId: string): Promise<Cycle> {
  let cycle = openCycle(dependencies, cycleId);
  if (cycle.outcome !== "running") return cycle;
  if (cycle.baseline === null) cycle = save(dependencies.evalsFolder, { ...cycle, baseline: dependencies.newRunId() });
  await ensureRun(dependencies, cycle.baseline!, runStart(dependencies, cycle, "development", activeTuning(dependencies.tuningFolder, cycle.jobKind), `${cycle.cycleId} development baseline`));
  return cycle;
}

/**
 * Step 2, one pass: a proposal when none waits for its measurement, then the development run and comparison of the
 * candidate that waits. An abstention ends the proposals, a failed tune job the cycle.
 */
export async function cycleProposal(dependencies: CycleDependencies, cycleId: string): Promise<Cycle> {
  let cycle = openCycle(dependencies, cycleId);
  if (cycle.outcome !== "running" || !proposalsPending(cycle)) return cycle;
  const { options } = cycle;
  let index = cycle.proposals.findIndex((item) => item.outcome === "candidate" && item.development === null);
  if (index < 0) {
    const answer = await proposeCandidate(dependencies.tune, cycle.baseline!, options.metric);
    const proposal: z.infer<typeof ProposalSchema> = answer.outcome === "candidate"
      ? { outcome: "candidate", record: answer.record, reason: answer.candidate.rationale ?? "", candidate: answer.candidate.id, run: null, development: null }
      : { outcome: answer.outcome, record: answer.record, reason: answer.outcome === "abstain" ? answer.reason : `${answer.kind}: ${answer.message}`, candidate: null, run: null, development: null };
    cycle = save(dependencies.evalsFolder, { ...cycle, proposals: [...cycle.proposals, proposal] });
    dependencies.run.log(`Tuning cycle ${cycle.cycleId}: proposal ${cycle.proposals.length}: ${proposal.outcome}${proposal.candidate === null ? "" : ` ${proposal.candidate}`}: ${proposal.reason}`);
    if (proposal.outcome === "failed") return finish(dependencies, cycle, "failed", [`the tune job failed: ${proposal.reason} (record ${proposal.record})`]);
    if (proposal.outcome !== "candidate") return cycle;
    index = cycle.proposals.length - 1;
  }
  const proposal = cycle.proposals[index]!;
  const update = (fields: Partial<z.infer<typeof ProposalSchema>>) => {
    cycle = save(dependencies.evalsFolder, { ...cycle, proposals: cycle.proposals.map((item, position) => (position === index ? { ...item, ...fields } : item)) });
  };
  const measuredBefore = cycle.proposals.find((item) => item !== proposal && item.candidate === proposal.candidate && item.development !== null);
  if (measuredBefore !== undefined) {
    update({ run: measuredBefore.run, development: measuredBefore.development });
    return cycle;
  }
  if (proposal.run === null) update({ run: dependencies.newRunId() });
  const candidate = readCandidate(candidatesFolder(dependencies.evalsFolder), proposal.candidate!);
  const run = cycle.proposals[index]!.run!;
  const runs = dependencies.run.runsFolder;
  await ensureRun(dependencies, run, runStart(dependencies, cycle, "development", candidate.tuning, `${cycle.cycleId} development ${candidate.id}`));
  const development = comparisonSummary(compareRuns(join(runs, cycle.baseline!), join(runs, run), options.metric, dependencies.run.now()));
  dependencies.run.log(`Tuning cycle ${cycle.cycleId}: ${candidate.id} on development: mean difference ${development.meanDifference ?? "n/a"} over ${development.pairs} pairs, ${development.verdict}.`);
  update({ development });
  return cycle;
}

/** Step 3: the best candidate that passed the development gate sees the holdout; without one the cycle ends `no_improvement`. */
export async function cycleHoldout(dependencies: CycleDependencies, cycleId: string): Promise<Cycle> {
  let cycle = openCycle(dependencies, cycleId);
  if (cycle.outcome !== "running") return cycle;
  const { options } = cycle;
  if (cycle.selected === null) {
    const passed = cycle.proposals.filter((item) => item.development !== null && passesDevelopmentGate(item.development))
      .sort((left, right) => compareCandidates(left.development!, right.development!));
    if (passed.length === 0) return finish(dependencies, cycle, "no_improvement", ["no candidate beat the active configuration on development"]);
    cycle = save(dependencies.evalsFolder, { ...cycle, selected: passed[0]!.candidate });
  }
  const selected = cycle.proposals.find((item) => item.candidate === cycle.selected && item.run !== null)!;
  if (cycle.holdout === null) cycle = save(dependencies.evalsFolder, { ...cycle, holdout: { run: dependencies.newRunId(), refused: null } });
  let holdoutRun = cycle.holdout!.run;
  const exposure = exposureOf(readLedger(dependencies.tuningFolder), holdoutRun);
  if (exposure === undefined) {
    const opened = await openHoldout({ ...dependencies.run, newRunId: () => holdoutRun, evalsFolder: dependencies.evalsFolder, tuningFolder: dependencies.tuningFolder }, {
      candidate: cycle.selected!, baselineRun: cycle.baseline!, candidateRun: selected.run!, metric: options.metric, maxExposures: options.maxExposures,
      // The ledger may hold the candidate's exposure under another ID (a holdout stopped before its run was created): the cycle follows it.
      onExposure: (recorded) => {
        holdoutRun = recorded.testRun;
        cycle = save(dependencies.evalsFolder, { ...cycle, holdout: { run: recorded.testRun, refused: null } });
      },
    });
    if ("refused" in opened) {
      cycle = save(dependencies.evalsFolder, { ...cycle, holdout: { run: holdoutRun, refused: opened.refused } });
      return finish(dependencies, cycle, "rejected", opened.refused);
    }
  } else {
    const candidate = readCandidate(candidatesFolder(dependencies.evalsFolder), exposure.candidate);
    await ensureRun(dependencies, holdoutRun, runStart(dependencies, cycle, "test", candidate.tuning, `holdout ${candidate.id}`, onExposureOf(dependencies, exposure)));
  }
  return cycle;
}

/**
 * Step 4: the active configuration on the holdout's test items. An exposure the ledger already held (a dataset version
 * with the same test items, other repetitions or agent choice) decides the dataset, repetitions and agent choice of both test runs.
 */
export async function cycleTestBaseline(dependencies: CycleDependencies, cycleId: string): Promise<Cycle> {
  let cycle = openCycle(dependencies, cycleId);
  if (cycle.outcome !== "running") return cycle;
  if (cycle.testBaseline === null) cycle = save(dependencies.evalsFolder, { ...cycle, testBaseline: dependencies.newRunId() });
  const held = exposureOf(readLedger(dependencies.tuningFolder), cycle.holdout!.run)!;
  await ensureRun(dependencies, cycle.testBaseline!, runStart(dependencies, cycle, "test", activeTuning(dependencies.tuningFolder, cycle.jobKind), `${cycle.cycleId} test baseline`, onExposureOf(dependencies, held)));
  return cycle;
}

/** Step 5: the certified activation of the held-out candidate, or its refusal (`rejected`). */
export function cycleActivation(dependencies: CycleDependencies, cycleId: string): Cycle {
  let cycle = openCycle(dependencies, cycleId);
  if (cycle.outcome !== "running") return cycle;
  const outcome = activate(folders(dependencies), { run: cycle.holdout!.run, baseline: cycle.testBaseline!, thresholds: thresholds(cycle.options) }, dependencies.run.now());
  if ("refused" in outcome) {
    cycle = save(dependencies.evalsFolder, { ...cycle, activation: { refused: [...outcome.refused], comparison: outcome.comparison } });
    return finish(dependencies, cycle, "rejected", [...outcome.refused]);
  }
  cycle = save(dependencies.evalsFolder, { ...cycle, activation: { refused: null, comparison: outcome.comparison } });
  return finish(dependencies, cycle, "activated", []);
}
