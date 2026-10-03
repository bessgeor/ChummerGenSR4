import { SetupError } from "../host/setup-error.js";

export const metrics = ["prediction", "rootCause", "valid", "reached"] as const;
export type Metric = (typeof metrics)[number];

/** The metrics each evaluated job kind scores: diagnosis answers by prediction and root cause, discovery answers by validity and reach. */
export const metricsOfJobKind = {
  hypothesis: ["prediction", "rootCause"], challenge: ["prediction", "rootCause"], rank: ["valid", "reached"], scenario: ["valid", "reached"],
} as const satisfies Record<string, readonly Metric[]>;

/** Fails unless the job kind scores the metric. */
export function requireMetric(jobKind: keyof typeof metricsOfJobKind, metric: Metric): void {
  const scored: readonly Metric[] = metricsOfJobKind[jobKind];
  if (!scored.includes(metric)) throw new SetupError(`A ${jobKind} run scores ${scored.join(" and ")}, not ${metric}.`);
}
