import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareRuns, type Comparison } from "../evals/comparison.js";
import { missingSamples, readRun, runFolders, RunSettingsSchema, type RunSettings } from "../evals/eval-run.js";
import type { Metric } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import type { ComparisonSummary } from "./active-configuration.js";
import { tuningId } from "./tuning.js";

/** What tuning keeps of a paired comparison. */
export function comparisonSummary(comparison: Comparison): ComparisonSummary {
  return {
    baseline: comparison.baseline, candidate: comparison.candidate, metric: comparison.metric, pairs: comparison.pairs, unpaired: comparison.unpaired, meanDifference: comparison.meanDifference,
    interval: comparison.interval, verdict: comparison.verdict, modelTimeMeanDifferenceMs: comparison.modelTime.meanDifferenceMs,
  };
}

/** Means of shares of repetitions (thirds, for three) differ by rounding noise of this size when they are equal: a smaller difference is none. */
export const differenceTolerance = 1e-9;

/** The development gate: a higher mean of the metric, or the same mean in less model time, with a value on every item the baseline has one on. */
export function passesDevelopmentGate(summary: ComparisonSummary): boolean {
  if (summary.meanDifference === null || summary.unpaired > 0) return false;
  if (summary.meanDifference > differenceTolerance) return true;
  return Math.abs(summary.meanDifference) <= differenceTolerance && summary.modelTimeMeanDifferenceMs !== null && summary.modelTimeMeanDifferenceMs < 0;
}

/** Orders candidates that passed the gate: the higher mean difference first, then the lower model time difference. */
export function compareCandidates(left: ComparisonSummary, right: ComparisonSummary): number {
  const byMean = right.meanDifference! - left.meanDifference!;
  if (Math.abs(byMean) > differenceTolerance) return byMean;
  return (left.modelTimeMeanDifferenceMs ?? 0) - (right.modelTimeMeanDifferenceMs ?? 0);
}

/** A run's settings and whether every planned sample finished. */
export function runState(folder: string): { settings: RunSettings; complete: boolean } {
  if (!existsSync(runFolders(folder).settings)) throw new SetupError(`There is no eval run in ${folder}.`);
  const { settings, samples } = readRun(folder);
  return { settings, complete: missingSamples(settings, samples).length === 0 };
}

/** Why two runs cannot be a paired baseline and candidate of tuning, besides what `compareRuns` checks: another agent choice. */
export function choiceDifference(left: RunSettings, right: RunSettings): string | null {
  const fields = (settings: RunSettings) => [settings.choice.provider, settings.choice.model ?? "default", settings.choice.effort].join(", ");
  return fields(left) === fields(right) ? null : `their agent choices differ (${fields(left)} and ${fields(right)})`;
}

/**
 * By candidate: the comparison of its newest complete development run that pairs with a baseline run (same dataset,
 * samples and agent choice). Each run's settings are read once; samples only of the runs that pair.
 */
export function developmentDifferences(runsFolder: string, baselineRun: string, metric: Metric, now: Date): Map<string, ComparisonSummary> {
  const baseline = runState(join(runsFolder, baselineRun)).settings;
  const samples = [...baseline.samples].sort().join();
  const newest = new Map<string, { name: string; startedUtc: string }>();
  for (const name of readdirSync(runsFolder)) {
    if (name === baselineRun || !existsSync(runFolders(join(runsFolder, name)).settings)) continue;
    const settings = readDocument(runFolders(join(runsFolder, name)).settings, RunSettingsSchema);
    if (settings.tuning === null || settings.partition !== "development" || settings.dataset.hash !== baseline.dataset.hash) continue;
    if ([...settings.samples].sort().join() !== samples || choiceDifference(settings, baseline) !== null) continue;
    const id = tuningId(settings.tuning);
    const known = newest.get(id);
    if ((known === undefined || settings.startedUtc > known.startedUtc) && runState(join(runsFolder, name)).complete) newest.set(id, { name, startedUtc: settings.startedUtc });
  }
  return new Map([...newest].map(([id, run]) => [id, comparisonSummary(compareRuns(join(runsFolder, baselineRun), join(runsFolder, run.name), metric, now))]));
}
