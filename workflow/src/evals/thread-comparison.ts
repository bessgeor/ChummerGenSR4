import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dispositions } from "../loop/disposition.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { verdictOf, type Verdict } from "./comparison.js";
import type { EvalRecord } from "./eval-record.js";
import { mean, pairedStatistics, type Interval } from "./statistics.js";

/** What the comparison reads of a thread's `outcome.json`. */
const OutcomeSchema = z.object({
  threadId: z.string(),
  clusters: z.array(z.object({ clusterId: z.string(), disposition: z.enum(dispositions) })),
});

/** One cluster of one finished thread: whether it was fixed and the model time and cost of its jobs. */
export type ClusterMeasure = {
  readonly threadId: string;
  readonly clusterId: string;
  readonly fixed: 0 | 1;
  readonly modelSeconds: number;
  /** The cost the providers reported for every job, or null when a job reported none. */
  readonly costUsd: number | null;
};

/** Each cluster of a finished thread with the model time of the workflow records whose thread and subject are its own. */
export function threadMeasures(threadFolder: string, threadId: string, records: readonly EvalRecord[]): ClusterMeasure[] {
  const path = join(threadFolder, "outcome.json");
  if (!existsSync(path)) throw new SetupError(`Thread ${threadId} has no outcome.json (${path}); only a thread that concluded can be compared.`);
  const outcome = readDocument(path, OutcomeSchema);
  return outcome.clusters.map((end) => {
    const jobs = records.filter((record) => record.origin === "workflow" && record.threadId === threadId && record.subject.id === end.clusterId);
    const costs = jobs.map((record) => record.usage?.costUsd ?? null);
    return {
      threadId, clusterId: end.clusterId, fixed: end.disposition === "fixed" ? 1 : 0,
      modelSeconds: jobs.reduce((sum, record) => sum + record.durationMs, 0) / 1000,
      costUsd: costs.some((cost) => cost === null) ? null : costs.reduce<number>((sum, cost) => sum + cost!, 0),
    };
  });
}

export const threadMetrics = ["fixRate", "modelTime"] as const;
export type ThreadMetric = (typeof threadMetrics)[number];

export type MetricComparison = {
  readonly metric: ThreadMetric;
  /** Which way is better: a higher fix rate, a lower model time. */
  readonly better: "higher" | "lower";
  readonly pairs: number;
  readonly baselineMean: number | null;
  readonly candidateMean: number | null;
  /** Candidate minus baseline. */
  readonly meanDifference: number | null;
  readonly standardError: number | null;
  readonly interval: Interval | null;
  readonly verdict: Verdict;
};

export type ThreadComparison = {
  readonly schemaVersion: 1;
  readonly baseline: readonly string[];
  readonly candidate: readonly string[];
  readonly pairs: readonly { readonly clusterId: string; readonly baseline: ClusterMeasure; readonly candidate: ClusterMeasure }[];
  readonly unpaired: { readonly baseline: readonly string[]; readonly candidate: readonly string[] };
  readonly metrics: readonly MetricComparison[];
  /** The mean paired cost difference over the pairs whose jobs all reported a cost, in USD. */
  readonly cost: { readonly pairs: number; readonly meanDifferenceUsd: number | null };
  readonly createdUtc: string;
};

function byCluster(side: string, measures: readonly ClusterMeasure[]): Map<string, ClusterMeasure> {
  const map = new Map<string, ClusterMeasure>();
  for (const measure of measures) {
    const other = map.get(measure.clusterId);
    if (other !== undefined) throw new SetupError(`Cluster ${measure.clusterId} is in two ${side} threads (${other.threadId}, ${measure.threadId}); a side may hold each cluster once.`);
    map.set(measure.clusterId, measure);
  }
  return map;
}

function compareMetric(metric: ThreadMetric, pairs: ThreadComparison["pairs"]): MetricComparison {
  const value = (measure: ClusterMeasure) => (metric === "fixRate" ? measure.fixed : measure.modelSeconds);
  const better = metric === "fixRate" ? "higher" : "lower";
  const statistics = pairedStatistics(pairs.map((pair) => value(pair.candidate) - value(pair.baseline)));
  return {
    metric, better, pairs: statistics.count, baselineMean: mean(pairs.map((pair) => value(pair.baseline))), candidateMean: mean(pairs.map((pair) => value(pair.candidate))),
    meanDifference: statistics.mean, standardError: statistics.standardError, interval: statistics.interval, verdict: verdictOf(statistics.interval, better),
  };
}

/** Pairs the clusters of two sets of finished threads by cluster ID and compares the fix rate and the model time. */
export function compareThreads(baseline: readonly ClusterMeasure[], candidate: readonly ClusterMeasure[], sides: { baseline: readonly string[]; candidate: readonly string[] }, now: Date): ThreadComparison {
  const left = byCluster("baseline", baseline);
  const right = byCluster("candidate", candidate);
  const pairs = [...left.keys()].filter((id) => right.has(id)).sort().map((clusterId) => ({ clusterId, baseline: left.get(clusterId)!, candidate: right.get(clusterId)! }));
  const costed = pairs.filter((pair) => pair.baseline.costUsd !== null && pair.candidate.costUsd !== null);
  return {
    schemaVersion: 1, baseline: sides.baseline, candidate: sides.candidate, pairs,
    unpaired: { baseline: [...left.keys()].filter((id) => !right.has(id)).sort(), candidate: [...right.keys()].filter((id) => !left.has(id)).sort() },
    metrics: threadMetrics.map((metric) => compareMetric(metric, pairs)),
    cost: { pairs: costed.length, meanDifferenceUsd: mean(costed.map((pair) => pair.candidate.costUsd! - pair.baseline.costUsd!)) },
    createdUtc: now.toISOString(),
  };
}

const number = (value: number | null, digits = 3) => (value === null ? "n/a" : value.toFixed(digits));

export function threadComparisonLines(comparison: ThreadComparison): string[] {
  const lines = [`Comparison of threads ${comparison.candidate.join(", ")} against ${comparison.baseline.join(", ")}: ${comparison.pairs.length} cluster pairs.`];
  for (const metric of comparison.metrics) {
    const unit = metric.metric === "modelTime" ? " s" : "";
    lines.push(`  ${metric.metric} (${metric.better} is better): ${metric.pairs} pairs; mean ${number(metric.baselineMean)}${unit} -> ${number(metric.candidateMean)}${unit}; `
      + `mean paired difference ${number(metric.meanDifference)}${unit}, standard error ${number(metric.standardError)}, `
      + `95% t interval ${metric.interval === null ? "n/a" : `[${number(metric.interval.low)}, ${number(metric.interval.high)}]`}: ${metric.verdict}`);
  }
  lines.push(`  cost: mean paired difference ${number(comparison.cost.meanDifferenceUsd, 4)} USD over ${comparison.cost.pairs} pairs with every cost known`);
  for (const side of ["baseline", "candidate"] as const) {
    if (comparison.unpaired[side].length > 0) lines.push(`  unpaired ${side} clusters: ${comparison.unpaired[side].join(", ")}`);
  }
  return lines;
}
