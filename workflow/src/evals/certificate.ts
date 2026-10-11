import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { efforts, providers, type JobKind } from "../agents/agent-job.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import { writeDocument } from "../steps/write-document.js";
import { dispatchedJobKinds, tunedPromptVersion, tuningOf, type DispatchedTuning } from "../tuning/tuning.js";
import { metrics, requireMetric, type Metric } from "./metrics.js";
import { evaluatedJobKinds, promptVersions, readRun, summarize, type EvaluatedJobKind } from "./eval-run.js";

/** A job kind's configuration, certified by an eval run on a test partition for unattended runs. */
export const CertificateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobKind: z.enum(evaluatedJobKinds),
  agent: z.strictObject({ provider: z.enum(providers), model: z.string().nullable(), effort: z.enum(efforts) }),
  promptVersion: z.string().min(1),
  run: z.string().min(1),
  dataset: z.strictObject({ name: z.string(), version: z.number().int(), hash: z.string(), partition: z.literal("test") }),
  metric: z.enum(metrics),
  /** The items with a value of the metric: repetitions of one item count once. */
  items: z.number().int().positive(),
  /** The sum over the items of the share of their repetitions that pass. */
  passes: z.number().nonnegative(),
  rate: z.number().min(0).max(1),
  interval: z.strictObject({ low: z.number(), high: z.number() }),
  thresholds: z.strictObject({ minPass: z.number().min(0).max(1), maxMeanCostUsd: z.number().positive().nullable() }),
  meanCostUsd: z.number().nonnegative().nullable(),
  issuedUtc: z.string(),
});
export type Certificate = z.infer<typeof CertificateSchema>;

export type Thresholds = { readonly metric: Metric; readonly minPass: number; readonly maxMeanCostUsd: number | null };

export function certificatePath(folder: string, jobKind: JobKind): string {
  return join(folder, `${jobKind}.json`);
}

/** Issues a certificate from a complete test-partition run that meets the thresholds, or returns every reason it does not. */
export function certify(runFolder: string, thresholds: Thresholds, certificatesFolder: string, now: Date): { certificate: Certificate } | { refused: string[] } {
  const outcome = certificateFor(runFolder, thresholds, now);
  if ("refused" in outcome) return outcome;
  writeCertificate(certificatesFolder, outcome.certificate);
  return outcome;
}

/** The job kind's certificate in the folder, or null without one; an unreadable or invalid file is a setup error. */
export function readCertificate(certificatesFolder: string, jobKind: EvaluatedJobKind): Certificate | null {
  const path = certificatePath(certificatesFolder, jobKind);
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = CertificateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new SetupError(`The certificate ${path} cannot be read: ${(error as Error).message}`);
  }
  if (!parsed.success || parsed.data.jobKind !== jobKind) throw new SetupError(`The certificate ${path} is not a valid ${jobKind} certificate.`);
  return parsed.data;
}

/** Writes a certificate over its job kind's earlier one. */
export function writeCertificate(certificatesFolder: string, certificate: Certificate): void {
  writeDocument(certificatePath(certificatesFolder, certificate.jobKind), CertificateSchema.parse(certificate));
}

/** The certificate a complete test-partition run that meets the thresholds earns, or every reason it does not; nothing is written. */
export function certificateFor(runFolder: string, thresholds: Thresholds, now: Date): { certificate: Certificate } | { refused: string[] } {
  const { settings, samples } = readRun(runFolder);
  requireMetric(settings.jobKind, thresholds.metric);
  const summary = summarize(settings.runId, settings.jobKind, samples, now);
  const reasons: string[] = [];
  const missing = settings.samples.filter((key) => !samples.some((sample) => sample.key === key)).length;
  if (missing > 0) reasons.push(`the run is not complete: ${missing} samples are missing`);
  if (settings.partition !== "test") reasons.push(`the run used the ${settings.partition} partition, not test`);
  const metric = summary.metrics[thresholds.metric];
  if (metric.interval === null) reasons.push(`no sample has a value of ${thresholds.metric}`);
  else if (metric.interval.low < thresholds.minPass) {
    reasons.push(`the lower bound ${metric.interval.low.toFixed(3)} of the 95% interval of ${thresholds.metric} (${metric.passes.toFixed(2)}/${metric.count} items) is below ${thresholds.minPass}`);
  }
  const meanCostUsd: number | null = samples.length > 0 && summary.unknownCosts === 0 ? summary.costUsd / samples.length : null;
  if (thresholds.maxMeanCostUsd !== null) {
    if (meanCostUsd === null) reasons.push(`${summary.unknownCosts} samples have no reported cost, so the mean cost cannot be checked`);
    else if (meanCostUsd > thresholds.maxMeanCostUsd) reasons.push(`the mean cost ${meanCostUsd.toFixed(4)} USD is above ${thresholds.maxMeanCostUsd}`);
  }
  if (reasons.length > 0 || metric.interval === null) return { refused: reasons };
  const certificate = CertificateSchema.parse({
    schemaVersion: 1, jobKind: settings.jobKind,
    agent: { provider: settings.choice.provider, model: settings.choice.model, effort: settings.choice.effort },
    promptVersion: settings.promptVersion, run: settings.runId,
    dataset: { name: settings.dataset.name, version: settings.dataset.version, hash: settings.dataset.hash, partition: settings.partition },
    metric: thresholds.metric, items: metric.count, passes: metric.passes, rate: metric.rate, interval: metric.interval,
    thresholds: { minPass: thresholds.minPass, maxMeanCostUsd: thresholds.maxMeanCostUsd }, meanCostUsd, issuedUtc: now.toISOString(),
  });
  return { certificate };
}

/**
 * Why each job kind may not be dispatched unattended: no certificate, an invalid one, or one for another agent
 * choice or prompt version than the run's (the tuned version when the run dispatches a configuration). An empty list lets the run start.
 */
export function certificateProblems(folder: string, jobKinds: readonly EvaluatedJobKind[], agents: AgentSettings, tuning?: DispatchedTuning): string[] {
  const problems: string[] = [];
  for (const jobKind of jobKinds) {
    const path = certificatePath(folder, jobKind);
    if (!existsSync(path)) {
      problems.push(`${jobKind}: no certificate (${path})`);
      continue;
    }
    let parsed;
    try {
      parsed = CertificateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      problems.push(`${jobKind}: the certificate ${path} cannot be read: ${(error as Error).message}`);
      continue;
    }
    if (!parsed.success || parsed.data.jobKind !== jobKind) {
      problems.push(`${jobKind}: the certificate ${path} is invalid${parsed.success ? ` (it is for ${parsed.data.jobKind})` : `: ${z.prettifyError(parsed.error)}`}`);
      continue;
    }
    const certified = parsed.data;
    const choice = agents.jobs[jobKind];
    const differences = [
      ["provider", certified.agent.provider, choice.provider],
      ["model", certified.agent.model ?? "default", choice.model ?? "default"],
      ["effort", certified.agent.effort, choice.effort],
      ["prompt version", certified.promptVersion, tunedPromptVersion(promptVersions[jobKind], tuningOf(tuning, jobKind))],
    ].filter(([, left, right]) => left !== right);
    if (differences.length > 0) {
      problems.push(`${jobKind}: the certificate is for ${differences.map(([field, left, right]) => `${field} ${left}, the run uses ${right}`).join("; ")}`);
    }
  }
  return problems;
}

/** The one field of a run's stored options the gate reads; options that do not state `unattended` are not unattended. */
const UnattendedFlagSchema = z.looseObject({ unattended: z.boolean().default(false) });

/** Whether a run dispatches repair jobs: after diagnosis, with repair on and no single node asked for. */
export function dispatchesRepair(options: Pick<RunOptions, "diagnosis" | "only" | "repair">): boolean {
  return options.diagnosis && options.repair !== null && options.only === null;
}

/** Why an unattended run may not start; empty for a run that is not unattended. No certificate covers repair jobs. */
export function unattendedProblems(options: RunOptions): string[] {
  if (!UnattendedFlagSchema.parse(options).unattended) return [];
  const problems = certificateProblems(options.certificates, dispatchedJobKinds(options), options.agents, options.tuning);
  if (dispatchesRepair(options)) problems.push("repair: no certificate covers repair jobs, so an unattended run cannot repair; add --no-repair");
  return problems;
}