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

/** Starts a cycle: records its options and the active configuration, then runs it. */
export async function startCycle(dependencies: CycleDependencies, cycleId: string, options: Omit<CycleOptions, "metric"> & { metric: Metric | null }): Promise<Cycle> {
  const jobKind = datasetJobKind(options.dataset);
  const metric = options.metric ?? metricsOfJobKind[jobKind][0];
  requireMetric(jobKind, metric);
  const cycle = save(dependencies.evalsFolder, {
    schemaVersion: 1, cycleId, options: { ...options, metric }, jobKind, active: activeOf(dependencies.tuningFolder, jobKind),
    startedUtc: dependencies.run.now().toISOString(), baseline: null, proposals: [], selected: null, holdout: null, testBaseline: null, activation: null,
    outcome: "running", reasons: [], finishedUtc: null,
  });
  dependencies.run.log(`Tuning cycle ${cycleId}: ${jobKind} on ${options.dataset}, metric ${metric}, up to ${options.candidates} candidates; active: ${cycle.active}.`);
  return continueCycle(dependencies, cycle);
}

/** Continues a stopped cycle with its stored options; finished steps are not repeated. */
export async function resumeCycle(dependencies: CycleDependencies, cycleId: string): Promise<Cycle> {
  const cycle = readCycle(dependencies.evalsFolder, cycleId);
  if (cycle.outcome !== "running") return cycle;
  dependencies.run.log(`Tuning cycle ${cycleId}: resumed.`);
  return continueCycle(dependencies, cycle);
}

/**
 * Finishes a run whose ID the cycle recorded: resumes it when its folder exists, starts it under that ID otherwise.
 * The ID is recorded before the run starts, so a cycle killed at any point finds its runs again.
 */
async function ensureRun(dependencies: CycleDependencies, runId: string, start: () => Parameters<typeof startEvalRun>[1]): Promise<void> {
  const folder = join(dependencies.run.runsFolder, runId);
  if (existsSync(runFolders(folder).settings)) {
    if (!runState(folder).complete) await resumeEvalRun(dependencies.run, runId);
    return;
  }
  await startEvalRun({ ...dependencies.run, newRunId: () => runId }, start());
}

function finish(dependencies: CycleDependencies, cycle: Cycle, outcome: Cycle["outcome"], reasons: string[]): Cycle {
  dependencies.run.log(`Tuning cycle ${cycle.cycleId}: ${outcome}${reasons.length === 0 ? "" : `: ${reasons.join("; ")}`}.`);
  return save(dependencies.evalsFolder, { ...cycle, outcome, reasons, finishedUtc: dependencies.run.now().toISOString() });
}

async function continueCycle(dependencies: CycleDependencies, start: Cycle): Promise<Cycle> {
  let cycle = start;
  const { options, jobKind } = cycle;
  const active = activeTuning(dependencies.tuningFolder, jobKind);
  // A cycle stopped after its activation was written, before it was recorded, finds the activation by its holdout run, also
  // when it has been rolled back since: it is never activated a second time.
  const file = readActiveFile(dependencies.tuningFolder, jobKind);
  const entries = file === null ? [] : [file.active, ...file.history, ...file.rolledBack];
  if (cycle.holdout !== null && entries.some((entry) => entry.evidence?.test.candidate === cycle.holdout!.run)) {
    if (file!.active.evidence?.test.candidate === cycle.holdout.run) activate(folders(dependencies), { run: cycle.holdout.run, baseline: cycle.testBaseline!, thresholds: thresholds(options) }, dependencies.run.now());
    return finish(dependencies, cycle, "activated", file!.active.evidence?.test.candidate === cycle.holdout.run ? [] : ["it has been rolled back since"]);
  }
  const activeNow = activeOf(dependencies.tuningFolder, jobKind);
  if (activeNow !== cycle.active) throw new SetupError(`The active ${jobKind} configuration changed from ${cycle.active} to ${activeNow} during tuning cycle ${cycle.cycleId}.`);
  const runs = dependencies.run.runsFolder;
  // Every run after the baseline uses the agent choice, pool and executables the baseline ran with.
  const settings = () => (cycle.baseline !== null && existsSync(runFolders(join(runs, cycle.baseline)).settings)
    ? agentSettingsOf(runState(join(runs, cycle.baseline)).settings) : dependencies.tune.settings);
  const runStart = (partition: "development" | "test", tuning: Tuning | null, name: string, on = { datasetFolder: options.dataset, repeat: options.repeat }) => () => ({
    datasetFolder: on.datasetFolder, partition, repeat: on.repeat, name, settings: settings(), tuning,
  });
  // The dataset and repetitions of an exposure's test run: those of its own development runs.
  const onExposureOf = (held: Exposure) => {
    const development = runState(join(runs, held.development.candidate)).settings;
    return { datasetFolder: development.dataset.folder, repeat: development.repeat };
  };

  // 1. The development baseline of the active configuration.
  if (cycle.baseline === null) cycle = save(dependencies.evalsFolder, { ...cycle, baseline: dependencies.newRunId() });
  await ensureRun(dependencies, cycle.baseline!, runStart("development", active, `${cycle.cycleId} development baseline`));

  // 2. Proposals, each with its development run and comparison; an abstention ends them, a failed tune job the cycle.
  for (;;) {
    const index = cycle.proposals.findIndex((item) => item.outcome === "candidate" && item.development === null);
    if (index < 0) {
      if (cycle.proposals.length >= options.candidates || cycle.proposals.some((item) => item.outcome !== "candidate")) break;
      const answer = await proposeCandidate(dependencies.tune, cycle.baseline!, options.metric);
      const proposal: z.infer<typeof ProposalSchema> = answer.outcome === "candidate"
        ? { outcome: "candidate", record: answer.record, reason: answer.candidate.rationale ?? "", candidate: answer.candidate.id, run: null, development: null }
        : { outcome: answer.outcome, record: answer.record, reason: answer.outcome === "abstain" ? answer.reason : `${answer.kind}: ${answer.message}`, candidate: null, run: null, development: null };
      cycle = save(dependencies.evalsFolder, { ...cycle, proposals: [...cycle.proposals, proposal] });
      dependencies.run.log(`Tuning cycle ${cycle.cycleId}: proposal ${cycle.proposals.length}: ${proposal.outcome}${proposal.candidate === null ? "" : ` ${proposal.candidate}`}: ${proposal.reason}`);
      if (proposal.outcome === "failed") return finish(dependencies, cycle, "failed", [`the tune job failed: ${proposal.reason} (record ${proposal.record})`]);
      continue;
    }
    const proposal = cycle.proposals[index]!;
    const measuredBefore = cycle.proposals.find((item) => item !== proposal && item.candidate === proposal.candidate && item.development !== null);
    const update = (fields: Partial<z.infer<typeof ProposalSchema>>) => {
      cycle = save(dependencies.evalsFolder, { ...cycle, proposals: cycle.proposals.map((item, position) => (position === index ? { ...item, ...fields } : item)) });
    };
    if (measuredBefore !== undefined) {
      update({ run: measuredBefore.run, development: measuredBefore.development });
      continue;
    }
    if (proposal.run === null) update({ run: dependencies.newRunId() });
    const candidate = readCandidate(candidatesFolder(dependencies.evalsFolder), proposal.candidate!);
    const run = cycle.proposals[index]!.run!;
    await ensureRun(dependencies, run, runStart("development", candidate.tuning, `${cycle.cycleId} development ${candidate.id}`));
    const development = comparisonSummary(compareRuns(join(runs, cycle.baseline!), join(runs, run), options.metric, dependencies.run.now()));
    dependencies.run.log(`Tuning cycle ${cycle.cycleId}: ${candidate.id} on development: mean difference ${development.meanDifference ?? "n/a"} over ${development.pairs} pairs, ${development.verdict}.`);
    update({ development });
  }

  // 3. The best candidate that passed the development gate sees the holdout.
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
    await ensureRun(dependencies, holdoutRun, runStart("test", candidate.tuning, `holdout ${candidate.id}`, onExposureOf(exposure)));
  }

  // 4. The active configuration on the same test items, then the certified activation. An exposure the ledger already held
  // (a dataset version with the same test items, other repetitions) decides the dataset and repetitions of both test runs.
  if (cycle.testBaseline === null) cycle = save(dependencies.evalsFolder, { ...cycle, testBaseline: dependencies.newRunId() });
  const held = exposureOf(readLedger(dependencies.tuningFolder), holdoutRun)!;
  await ensureRun(dependencies, cycle.testBaseline!, runStart("test", active, `${cycle.cycleId} test baseline`, onExposureOf(held)));
  const outcome = activate(folders(dependencies), { run: holdoutRun, baseline: cycle.testBaseline!, thresholds: thresholds(options) }, dependencies.run.now());
  if ("refused" in outcome) {
    cycle = save(dependencies.evalsFolder, { ...cycle, activation: { refused: [...outcome.refused], comparison: outcome.comparison } });
    return finish(dependencies, cycle, "rejected", [...outcome.refused]);
  }
  cycle = save(dependencies.evalsFolder, { ...cycle, activation: { refused: null, comparison: outcome.comparison } });
  return finish(dependencies, cycle, "activated", []);
}
