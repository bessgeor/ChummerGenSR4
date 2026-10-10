import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { CertificateSchema } from "../evals/certificate.js";
import { evaluatedJobKinds, type EvaluatedJobKind } from "../evals/evaluated-job-kinds.js";
import { metrics } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { requireCurrent, TuningSchema, type DispatchedTuning } from "./tuning.js";

/** A paired comparison as tuning keeps it: the metric's difference with its interval and verdict, and the model time's. */
export const ComparisonSummarySchema = z.strictObject({
  baseline: z.string().min(1),
  candidate: z.string().min(1),
  metric: z.enum(metrics),
  pairs: z.number().int().nonnegative(),
  meanDifference: z.number().nullable(),
  interval: z.strictObject({ low: z.number(), high: z.number() }).nullable(),
  verdict: z.enum(["improved", "worse", "no-difference", "too-few-pairs"]),
  modelTimeMeanDifferenceMs: z.number().nullable(),
});
export type ComparisonSummary = z.infer<typeof ComparisonSummarySchema>;

/** What an activation was decided on: both paired comparisons and the certificate's thresholds. */
const EvidenceSchema = z.strictObject({
  datasetHash: z.string().min(1),
  development: ComparisonSummarySchema,
  test: ComparisonSummarySchema,
  minPass: z.number().min(0).max(1),
  maxMeanCostUsd: z.number().positive().nullable(),
});

/**
 * One state of a job kind: a configuration, or none for the code's prompt, when and on what evidence it became
 * active, and the job kind's certificate that goes with it (for the code's prompt, the certificate file as it was).
 */
export const EntrySchema = z.strictObject({
  tuning: TuningSchema.nullable(),
  activatedUtc: z.string().nullable(),
  evidence: EvidenceSchema.nullable(),
  certificate: CertificateSchema.nullable(),
});
export type Entry = z.infer<typeof EntrySchema>;

/** `active/<jobKind>.json`: the active entry, the entries it replaced (most recent last) and the ones rolled back. */
export const ActiveFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobKind: z.enum(evaluatedJobKinds),
  active: EntrySchema,
  history: z.array(EntrySchema),
  rolledBack: z.array(EntrySchema.extend({ rolledBackUtc: z.string(), reason: z.string().nullable() })),
});
export type ActiveFile = z.infer<typeof ActiveFileSchema>;

/** The files of the tuning folder: the profile's `tuning`, else `workflow/evals/tuning/`. */
export function tuningFiles(folder: string) {
  return { active: (jobKind: EvaluatedJobKind) => join(folder, "active", `${jobKind}.json`), holdout: join(folder, "holdout.json") };
}

/** The active file of a job kind, or null when none was ever activated; an unreadable or invalid file is a setup error. */
export function readActiveFile(folder: string, jobKind: EvaluatedJobKind): ActiveFile | null {
  const path = tuningFiles(folder).active(jobKind);
  if (!existsSync(path)) return null;
  const file = readDocument(path, ActiveFileSchema);
  if (file.jobKind !== jobKind) throw new SetupError(`The active tuning file ${path} is for ${file.jobKind}.`);
  if (file.active.tuning !== null && file.active.tuning.jobKind !== jobKind) {
    throw new SetupError(`The active tuning file ${path} activates a configuration of ${file.active.tuning.jobKind}.`);
  }
  return file;
}

export function writeActiveFile(folder: string, file: ActiveFile): void {
  const path = tuningFiles(folder).active(file.jobKind);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ActiveFileSchema.parse(file), null, 2)}\n`);
}

/** The active configuration of a job kind, or null for the code's prompt; a stale one is a setup error. */
export function activeTuning(folder: string, jobKind: EvaluatedJobKind): z.infer<typeof TuningSchema> | null {
  const active = readActiveFile(folder, jobKind)?.active.tuning ?? null;
  return active === null ? null : requireCurrent(active, tuningFiles(folder).active(jobKind));
}

/** The active configurations of the job kinds a thread starting now dispatches; the others are not read. */
export function readDispatchedTuning(folder: string, jobKinds: readonly EvaluatedJobKind[]): DispatchedTuning {
  return Object.fromEntries(jobKinds.flatMap((jobKind) => {
    const active = activeTuning(folder, jobKind);
    return active === null ? [] : [[jobKind, active]];
  }));
}
