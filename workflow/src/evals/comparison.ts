import { SetupError } from "../host/setup-error.js";
import { readRun, type RunSettings, type Sample } from "./eval-run.js";
import { mean, pairedStatistics, type Interval } from "./statistics.js";

export const metrics = ["prediction", "rootCause"] as const;
export type Metric = (typeof metrics)[number];

export type Verdict = "improved" | "worse" | "no-difference" | "too-few-pairs";

export type Comparison = {
  readonly schemaVersion: 1;
  readonly baseline: string;
  readonly candidate: string;
  readonly dataset: { readonly name: string; readonly version: number; readonly hash: string };
  readonly jobKind: RunSettings["jobKind"];
  readonly partition: RunSettings["partition"];
  readonly metric: Metric;
  /** Pairs where both runs have a value of the metric. */
  readonly pairs: number;
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
  const missing = settings.samples.filter((key) => !byKey.has(key));
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

  const pairs = baseline.settings.samples.map((key) => ({ baseline: baseline.samples.get(key)!, candidate: candidate.samples.get(key)! }));
  const valued = pairs.filter((pair) => pair.baseline[metric] !== null && pair.candidate[metric] !== null);
  const rate = (side: "baseline" | "candidate") => mean(valued.map((pair) => Number(pair[side][metric])));
  const statistics = pairedStatistics(valued.map((pair) => Number(pair.candidate[metric]) - Number(pair.baseline[metric])));
  const verdict: Verdict = statistics.interval === null ? "too-few-pairs"
    : statistics.interval.low > 0 ? "improved" : statistics.interval.high < 0 ? "worse" : "no-difference";
  const costed = pairs.filter((pair) => pair.baseline.costUsd !== null && pair.candidate.costUsd !== null);
  const left = configuration(baseline.settings);
  const right = configuration(candidate.settings);
  return {
    schemaVersion: 1, baseline: baseline.settings.runId, candidate: candidate.settings.runId,
    dataset: { name: baseline.settings.dataset.name, version: baseline.settings.dataset.version, hash: baseline.settings.dataset.hash },
    jobKind: baseline.settings.jobKind, partition: baseline.settings.partition, metric, pairs: statistics.count,
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
    `  ${comparison.pairs} pairs; pass rate ${number(comparison.baselineRate)} -> ${number(comparison.candidateRate)}; mean paired difference ${number(comparison.meanDifference)}, `
      + `standard error ${number(comparison.standardError)}, 95% t interval ${comparison.interval === null ? "n/a" : `[${number(comparison.interval.low)}, ${number(comparison.interval.high)}]`}: ${comparison.verdict}`,
    `  model time: mean paired difference ${number(comparison.modelTime.meanDifferenceMs === null ? null : comparison.modelTime.meanDifferenceMs / 1000, 1)} s; `
      + `cost: mean paired difference ${number(comparison.cost.meanDifferenceUsd, 4)} USD over ${comparison.cost.pairs} pairs with both costs known`,
    `  configuration differences: ${comparison.configurationDifferences.length === 0 ? "none" : comparison.configurationDifferences.map((item) => `${item.field} ${item.baseline} -> ${item.candidate}`).join("; ")}`,
  ];
}
