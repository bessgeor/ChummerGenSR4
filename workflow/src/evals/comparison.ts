import { SetupError } from "../host/setup-error.js";
import { itemShares, missingSamples, readRun, type RunSettings, type Sample } from "./eval-run.js";
import { requireMetric, type Metric } from "./metrics.js";
import { mean, pairedStatistics, type Interval } from "./statistics.js";

export { metrics, type Metric } from "./metrics.js";

export type Verdict = "improved" | "worse" | "no-difference" | "too-few-pairs";

/**
 * The verdict of a paired difference's interval: `improved` when the whole interval lies on the better side of zero,
 * `worse` when it lies on the other, `no-difference` when it holds zero, `too-few-pairs` without an interval.
 * A positive difference is better unless `better` is `lower`.
 */
export function verdictOf(interval: Interval | null, better: "higher" | "lower" = "higher"): Verdict {
  if (interval === null) return "too-few-pairs";
  const [low, high] = better === "higher" ? [interval.low, interval.high] : [-interval.high, -interval.low];
  return low > 0 ? "improved" : high < 0 ? "worse" : "no-difference";
}

export type Comparison = {
  readonly schemaVersion: 1;
  readonly baseline: string;
  readonly candidate: string;
  readonly dataset: { readonly name: string; readonly version: number; readonly hash: string };
  readonly jobKind: RunSettings["jobKind"];
  readonly partition: RunSettings["partition"];
  readonly metric: Metric;
  /** Items where both runs have a value of the metric; repetitions of an item are one pair. */
  readonly pairs: number;
  /** Items the baseline has a value of the metric on and the candidate has none (an abstention or a failure): they are in no pair. */
  readonly unpaired: number;
  readonly baselineRate: number | null;
  readonly candidateRate: number | null;
  readonly meanDifference: number | null;
  readonly standardError: number | null;
  readonly interval: Interval | null;
  readonly verdict: Verdict;
  readonly modelTime: { readonly meanDifferenceMs: number | null };
  readonly cost: { readonly pairs: number; readonly meanDifferenceUsd: number | null };
  readonly configurationDifferences: readonly { readonly field: string; readonly baseline: string; readonly candidate: string }[];
  readonly createdUtc: string;
};

/** A run whose every planned sample finished; anything else cannot be compared. */
function completeRun(folder: string): { settings: RunSettings; samples: Map<string, Sample> } {
  const { settings, samples } = readRun(folder);
  const byKey = new Map(samples.map((sample) => [sample.key, sample]));
  const missing = missingSamples(settings, samples);
  if (missing.length > 0) throw new SetupError(`Eval run ${settings.runId} is not complete: ${missing.length} samples are missing; resume it first.`);
  return { settings, samples: byKey };
}

function configuration(settings: RunSettings): Record<string, string> {
  return {
    provider: settings.choice.provider, model: settings.choice.model ?? "default", effort: settings.choice.effort,
    timeoutMinutes: String(settings.choice.timeoutMinutes), promptVersion: settings.promptVersion, modelPool: String(settings.modelPool), name: settings.name ?? "",
  };
}

/** Pairs two complete runs on the same dataset, job kind, partition and samples, and compares one metric. */
export function compareRuns(baselineFolder: string, candidateFolder: string, metric: Metric, now: Date): Comparison {
  const baseline = completeRun(baselineFolder);
  const candidate = completeRun(candidateFolder);
  const problems: string[] = [];
  if (baseline.settings.dataset.hash !== candidate.settings.dataset.hash) problems.push("they ran on different datasets");
  if (baseline.settings.jobKind !== candidate.settings.jobKind) problems.push("they ran different job kinds");
  if (baseline.settings.partition !== candidate.settings.partition) problems.push("they ran different partitions");
  if ([...baseline.settings.samples].sort().join() !== [...candidate.settings.samples].sort().join()) problems.push("their samples differ");
  if (problems.length > 0) throw new SetupError(`Eval runs ${baseline.settings.runId} and ${candidate.settings.runId} cannot be paired: ${problems.join("; ")}.`);

  requireMetric(baseline.settings.jobKind, metric);
  const pairs = baseline.settings.samples.map((key) => ({ baseline: baseline.samples.get(key)!, candidate: candidate.samples.get(key)! }));
  // The unit of a pair is an item: its repetitions are not independent samples, so each side gives the share of them that pass.
  const shares = {
    baseline: itemShares([...baseline.samples.values()], (sample) => sample[metric]),
    candidate: itemShares([...candidate.samples.values()], (sample) => sample[metric]),
  };
  const valued = [...shares.baseline].filter(([itemId]) => shares.candidate.has(itemId)).map(([itemId, share]) => ({ baseline: share, candidate: shares.candidate.get(itemId)! }));
  const unpaired = [...shares.baseline.keys()].filter((itemId) => !shares.candidate.has(itemId)).length;
  const rate = (side: "baseline" | "candidate") => mean(valued.map((pair) => pair[side]));
  const statistics = pairedStatistics(valued.map((pair) => pair.candidate - pair.baseline));
  const verdict = verdictOf(statistics.interval);
  const costed = pairs.filter((pair) => pair.baseline.costUsd !== null && pair.candidate.costUsd !== null);
  const left = configuration(baseline.settings);
  const right = configuration(candidate.settings);
  return {
    schemaVersion: 1, baseline: baseline.settings.runId, candidate: candidate.settings.runId,
    dataset: { name: baseline.settings.dataset.name, version: baseline.settings.dataset.version, hash: baseline.settings.dataset.hash },
    jobKind: baseline.settings.jobKind, partition: baseline.settings.partition, metric, pairs: statistics.count, unpaired,
    baselineRate: rate("baseline"), candidateRate: rate("candidate"), meanDifference: statistics.mean, standardError: statistics.standardError,
    interval: statistics.interval, verdict,
    modelTime: { meanDifferenceMs: mean(pairs.map((pair) => pair.candidate.durationMs - pair.baseline.durationMs)) },
    cost: { pairs: costed.length, meanDifferenceUsd: mean(costed.map((pair) => pair.candidate.costUsd! - pair.baseline.costUsd!)) },
    configurationDifferences: Object.keys(left).filter((field) => left[field] !== right[field]).map((field) => ({ field, baseline: left[field]!, candidate: right[field]! })),
    createdUtc: now.toISOString(),
  };
}

const number = (value: number | null, digits = 3) => (value === null ? "n/a" : value.toFixed(digits));

export function comparisonLines(comparison: Comparison): string[] {
  return [
    `Comparison of ${comparison.candidate} against ${comparison.baseline} on ${comparison.dataset.name} v${comparison.dataset.version} (${comparison.jobKind}, ${comparison.partition}), metric ${comparison.metric}:`,
    `  ${comparison.pairs} item pairs; pass rate ${number(comparison.baselineRate)} -> ${number(comparison.candidateRate)}; mean paired difference ${number(comparison.meanDifference)}, `
      + `standard error ${number(comparison.standardError)}, 95% t interval ${comparison.interval === null ? "n/a" : `[${number(comparison.interval.low)}, ${number(comparison.interval.high)}]`}: ${comparison.verdict}`,
    `  model time: mean paired difference ${number(comparison.modelTime.meanDifferenceMs === null ? null : comparison.modelTime.meanDifferenceMs / 1000, 1)} s; `
      + `cost: mean paired difference ${number(comparison.cost.meanDifferenceUsd, 4)} USD over ${comparison.cost.pairs} pairs with both costs known`,
    `  configuration differences: ${comparison.configurationDifferences.length === 0 ? "none" : comparison.configurationDifferences.map((item) => `${item.field} ${item.baseline} -> ${item.candidate}`).join("; ")}`,
  ];
}
