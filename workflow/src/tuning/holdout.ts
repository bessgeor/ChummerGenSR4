import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { compareRuns } from "../evals/comparison.js";
import { agentSettingsOf, loadRunnable, runFolders, startEvalRun, type EvalRunDependencies, type RunSettings, type RunSummary } from "../evals/eval-run.js";
import { evaluatedJobKinds } from "../evals/evaluated-job-kinds.js";
import { metricsOfJobKind, requireMetric, type Metric } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { writeDocument } from "../steps/write-document.js";
import { activeTuning, ComparisonSummarySchema, tuningFiles } from "./active-configuration.js";
import { candidatesFolder, readCandidate } from "./candidates.js";
import { choiceDifference, comparisonSummary, passesDevelopmentGate, runState } from "./development.js";
import { requireCurrent, tuningId, TuningSchema } from "./tuning.js";

export const defaultMaximumExposures = 3;

/** One candidate's run on a dataset's test partition, recorded before the run starts. */
const ExposureSchema = z.strictObject({
  /** The test items it saw, by what decides an item's partition (a discrepancy cluster, a discovery target), sorted: any dataset whose test partition holds one of them has been seen. */
  testItems: z.array(z.string().min(1)).min(1),
  datasetHash: z.string().min(1),
  dataset: z.strictObject({ name: z.string(), version: z.number().int() }),
  jobKind: z.enum(evaluatedJobKinds),
  candidate: z.string().min(1),
  tuning: TuningSchema,
  development: ComparisonSummarySchema,
  testRun: z.string().min(1),
  exposedUtc: z.string(),
});
export type Exposure = z.infer<typeof ExposureSchema>;

/** `holdout.json`: every exposure of a test partition to a candidate. */
const LedgerSchema = z.strictObject({ schemaVersion: z.literal(1), exposures: z.array(ExposureSchema) });
export type Ledger = z.infer<typeof LedgerSchema>;

export function readLedger(tuningFolder: string): Ledger {
  const path = tuningFiles(tuningFolder).holdout;
  return existsSync(path) ? readDocument(path, LedgerSchema) : { schemaVersion: 1, exposures: [] };
}

function writeLedger(tuningFolder: string, ledger: Ledger): void {
  const path = tuningFiles(tuningFolder).holdout;
  writeDocument(path, LedgerSchema.parse(ledger));
}

/** The configuration a run measured as an ID, the code's prompt as `none`. */
export function measuredOf(settings: RunSettings): string {
  return settings.tuning === null ? "none" : tuningId(settings.tuning);
}

/** The configuration that is active for a job kind as an ID, the code's prompt as `none`. */
export function activeOf(tuningFolder: string, jobKind: RunSettings["jobKind"]): string {
  const active = activeTuning(tuningFolder, jobKind);
  return active === null ? "none" : tuningId(active);
}

/** Why a baseline and a candidate run of the same partition cannot be paired by tuning: setup errors, not refusals. */
export function pairingProblems(baseline: RunSettings, candidate: RunSettings, partition: "development" | "test"): string[] {
  const problems: string[] = [];
  for (const [name, settings] of [["baseline", baseline], ["candidate", candidate]] as const) {
    if (settings.partition !== partition) problems.push(`the ${name} run ${settings.runId} ran on the ${settings.partition} partition, not ${partition}`);
  }
  if (baseline.dataset.hash !== candidate.dataset.hash) problems.push("the runs are on different datasets");
  else if ([...baseline.samples].sort().join() !== [...candidate.samples].sort().join()) problems.push("the runs have different samples");
  const choices = choiceDifference(baseline, candidate);
  if (choices !== null) problems.push(choices);
  return problems;
}

export type HoldoutRequest = {
  readonly candidate: string;
  readonly baselineRun: string;
  readonly candidateRun: string;
  readonly metric: Metric | null;
  readonly maxExposures: number;
  /** Called with the exposure, recorded or found unstarted, before its test run is created: a caller keeps the run's ID where it resumes from. */
  readonly onExposure?: (exposure: Exposure) => void;
};

export type HoldoutDependencies = EvalRunDependencies & {
  readonly evalsFolder: string;
  readonly tuningFolder: string;
  /** How long a command waits for another one that holds the ledger; default 10 s. */
  readonly ledgerLockWaitMs?: number;
  /** Run holding the ledger's lock before the ledger is read: it throws when these tuning files must not change now. */
  readonly ledgerGuard?: () => void;
};

/**
 * Runs a synchronous step holding the ledger's lock, a folder only one command can create, so commands in two processes
 * do not both pass the exposure limit. The step awaits nothing, so the lock is held for milliseconds; a command that
 * cannot get it in time fails and names the folder.
 */
export function withLedgerLock<T>(dependencies: Pick<HoldoutDependencies, "tuningFolder" | "ledgerLockWaitMs">, step: () => T): T {
  const lock = `${tuningFiles(dependencies.tuningFolder).holdout}.lock`;
  mkdirSync(dependencies.tuningFolder, { recursive: true });
  const deadline = Date.now() + (dependencies.ledgerLockWaitMs ?? 10_000);
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new SetupError(`The holdout ledger is locked by ${lock}: another tune command holds it, or one was killed while it updated the ledger; remove the folder when none runs.`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return step();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Opens the test partition to a candidate that beat the active configuration on development: records the exposure,
 * then starts the candidate's test run with the development run's settings. A refusal names every reason and writes nothing.
 */
export async function openHoldout(dependencies: HoldoutDependencies, request: HoldoutRequest): Promise<{ refused: string[] } | { exposure: Exposure; folder: string; summary: RunSummary }> {
  const runs = join(dependencies.evalsFolder, "runs");
  const candidate = readCandidate(candidatesFolder(dependencies.evalsFolder), request.candidate);
  const tuning = requireCurrent(candidate.tuning, `The candidate ${candidate.id}`);
  const baseline = runState(join(runs, request.baselineRun));
  const measured = runState(join(runs, request.candidateRun));
  const jobKind = tuning.jobKind;
  const problems = pairingProblems(baseline.settings, measured.settings, "development");
  if (!baseline.complete) problems.push(`the baseline run ${request.baselineRun} is not complete`);
  if (!measured.complete) problems.push(`the candidate run ${request.candidateRun} is not complete`);
  if (baseline.settings.jobKind !== jobKind) problems.push(`the runs are of ${baseline.settings.jobKind}, the candidate of ${jobKind}`);
  const active = activeOf(dependencies.tuningFolder, jobKind);
  if (active === candidate.id) problems.push(`the candidate ${candidate.id} is already active`);
  if (measuredOf(baseline.settings) !== active) problems.push(`the baseline run measured ${measuredOf(baseline.settings)}, but ${active} is active`);
  if (measuredOf(measured.settings) !== candidate.id) problems.push(`the candidate run measured ${measuredOf(measured.settings)}, not ${candidate.id}`);
  if (problems.length > 0) throw new SetupError(`tune holdout cannot pair the runs: ${problems.join("; ")}.`);

  const metric = request.metric ?? metricsOfJobKind[jobKind][0];
  requireMetric(jobKind, metric);
  const development = comparisonSummary(compareRuns(join(runs, request.baselineRun), join(runs, request.candidateRun), metric, dependencies.now()));
  const hash = measured.settings.dataset.hash;
  const dataset = await loadRunnable(measured.settings.dataset.folder);
  if (dataset.hash !== hash) throw new SetupError(`The dataset ${measured.settings.dataset.folder} is not the one the development runs ran on.`);
  const testItems = [...new Set(dataset.items.filter((item) => item.partition === "test").map((item) => item.partitionKey))].sort();
  if (testItems.length === 0) throw new SetupError(`The dataset ${measured.settings.dataset.folder} has no item in the test partition.`);
  const where = `${dataset.name} v${dataset.version}`;
  // The ledger is read, checked and written under its lock with nothing awaited in between: two commands cannot both pass the limit.
  const opening = withLedgerLock(dependencies, (): { refused: string[] } | { unstarted: Exposure } | { recorded: Exposure; count: number } => {
    dependencies.ledgerGuard?.();
    const ledger = readLedger(dependencies.tuningFolder);
    // Another name, version or seed does not make an item new: an exposure counts against every dataset whose test partition holds one of its items.
    const exposed = ledger.exposures.filter((exposure) => exposure.jobKind === jobKind && exposure.testItems.some((item) => testItems.includes(item)));
    // An exposure whose run was never created (stopped between the ledger and the run) starts its run now, under its recorded ID.
    const unstarted = exposed.find((exposure) => exposure.candidate === candidate.id && !existsSync(runFolders(join(runs, exposure.testRun)).settings));
    if (unstarted !== undefined) return { unstarted };
    const refused: string[] = [];
    if (development.unpaired > 0) {
      refused.push(`on ${development.unpaired} items the candidate has a value of ${metric} on fewer repetitions than the active configuration; an abstention or a failure is not an improvement`);
    } else if (!passesDevelopmentGate(development)) {
      refused.push(`the candidate did not beat the active configuration on development: mean difference of ${metric} ${development.meanDifference ?? "n/a"} `
        + `over ${development.pairs} pairs, model time ${development.modelTimeMeanDifferenceMs ?? "n/a"} ms`);
    }
    if (exposed.some((exposure) => exposure.candidate === candidate.id)) refused.push(`the candidate ${candidate.id} has already seen test items of ${where}`);
    if (exposed.length >= request.maxExposures) {
      refused.push(`the test items of ${where} have been shown to ${exposed.length} candidates (at most ${request.maxExposures}); `
        + "a dataset with test items that no candidate has seen is needed: another seed moves the items between partitions and does not make them new");
    }
    if (refused.length > 0) return { refused };
    const exposure: Exposure = {
      testItems, datasetHash: hash, dataset: { name: measured.settings.dataset.name, version: measured.settings.dataset.version }, jobKind, candidate: candidate.id, tuning,
      development, testRun: dependencies.newRunId(), exposedUtc: dependencies.now().toISOString(),
    };
    // The exposure is recorded first: a run stopped later still counts, and resumes with eval run --resume (or, not yet created, starts with tune holdout).
    writeLedger(dependencies.tuningFolder, { ...ledger, exposures: [...ledger.exposures, exposure] });
    return { recorded: exposure, count: exposed.length + 1 };
  });
  if ("refused" in opening) return opening;
  if ("unstarted" in opening) {
    const { unstarted } = opening;
    dependencies.log(`Holdout: ${candidate.id} was shown the test items of ${unstarted.dataset.name} v${unstarted.dataset.version} as run ${unstarted.testRun}, which was not started; `
      + "starting that run with its own development runs.");
    request.onExposure?.(unstarted);
    return { exposure: unstarted, ...await startHoldoutRun(dependencies, unstarted, runState(join(runs, unstarted.development.candidate)).settings) };
  }
  request.onExposure?.(opening.recorded);
  dependencies.log(`Holdout: ${candidate.id} is shown the test items of ${where} as run ${opening.recorded.testRun} (${opening.count} of at most ${request.maxExposures} candidates).`);
  return { exposure: opening.recorded, ...await startHoldoutRun(dependencies, opening.recorded, measured.settings) };
}

/** Starts an exposure's test run under its recorded ID with the candidate development run's repetitions, agent choice, pool and executables. */
function startHoldoutRun(dependencies: HoldoutDependencies, exposure: Exposure, development: RunSettings): Promise<{ folder: string; summary: RunSummary }> {
  return startEvalRun({ ...dependencies, newRunId: () => exposure.testRun }, {
    datasetFolder: development.dataset.folder, partition: "test", repeat: development.repeat, name: `holdout ${exposure.candidate}`,
    settings: agentSettingsOf(development), tuning: exposure.tuning,
  });
}

/** The exposure that started a test run, or undefined. */
export function exposureOf(ledger: Ledger, testRun: string): Exposure | undefined {
  return ledger.exposures.find((exposure) => exposure.testRun === testRun);
}
