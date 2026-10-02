import { z } from "zod";
import { mechanisms } from "../diagnosis/job-schemas.js";
import { checkLabels } from "../evals/eval-record.js";

const rect = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** A capture run's execution outcome apart from its visual result; the run folder by its name, as it is under `out/runs/`. */
const RunSchema = z.strictObject({
  run: z.string().min(1),
  status: z.number().int(),
  coverageValid: z.boolean(),
  failures: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

const LevelSchema = z.strictObject({
  level: z.enum(["narrow", "character", "mode", "suite"]),
  cases: z.array(z.string()),
  /** The level's captures, or null for every capture of its cases. */
  captures: z.array(z.string()).nullable(),
  run: RunSchema.nullable(),
  baseline: RunSchema.nullable(),
  outcome: z.enum(["passed", "failed", "nothing-new"]),
  findings: z.array(z.strictObject({ case: z.string(), capture: z.string(), attribution: z.string(), difference: z.number(), detail: z.string() })),
});

const TaskSchema = z.strictObject({
  id: z.number().int().min(1),
  title: z.string().min(1),
  instructions: z.string().min(1),
  blockedBy: z.array(z.number().int().min(1)),
  /** The files the subtask changed, relative to the source. */
  files: z.array(z.string()).min(1),
  recordId: z.string().min(1),
  summary: z.string().min(1),
});

/**
 * `fix.json`: everything a fix change says, as data. The change's markdown is rendered from it, and retrieval reads
 * it back. `widening` is null in the draft a passed repair attempt writes and is set when the attempt is promoted.
 */
export const FixRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^fix-[a-z0-9]+(-[a-z0-9]+)*$/),
  threadId: z.string().min(1),
  cluster: z.strictObject({ id: z.string().min(1), imageHash: z.string(), cases: z.array(z.string()), captures: z.array(z.string()), members: z.number().int().min(1) }),
  members: z.array(z.strictObject({
    case: z.string(), capture: z.string(), core: rect, differingPixels: z.number(),
    canonicalOcr: z.string().nullable(), candidateOcr: z.string().nullable(),
  })).min(1),
  hypothesis: z.strictObject({
    recordId: z.string().min(1), claim: z.string(), mechanism: z.enum(mechanisms),
    locations: z.array(z.strictObject({ path: z.string(), symbol: z.string().nullable(), line: z.number().int().nullable() })),
    evidence: z.string(), confidence: z.number(),
  }),
  challenge: z.strictObject({
    recordId: z.string().min(1), outcome: z.enum(["alternative", "no_alternative"]), reason: z.string(), alternative: z.string().nullable(),
  }).nullable(),
  check: z.strictObject({
    outcome: z.enum(checkLabels), run: z.string().min(1),
    observations: z.array(z.strictObject({ case: z.string(), capture: z.string(), observation: z.string(), detail: z.string() })),
  }),
  plan: z.strictObject({ recordId: z.string().min(1), reason: z.string(), summary: z.string() }),
  tasks: z.array(TaskSchema).min(1),
  patch: z.strictObject({
    files: z.array(z.strictObject({ path: z.string(), change: z.enum(["added", "modified", "deleted"]), added: z.number().int(), removed: z.number().int() })).min(1),
    added: z.number().int(), removed: z.number().int(),
  }),
  narrowCheck: RunSchema,
  widening: z.array(LevelSchema).nullable(),
});
export type FixRecord = z.infer<typeof FixRecordSchema>;
export type FixRun = z.infer<typeof RunSchema>;
export type FixLevel = z.infer<typeof LevelSchema>;

/** The name of a cluster's fix change in a thread: the thread ID's last eight characters keep two threads' fixes of one cluster apart. */
export function fixChangeName(clusterId: string, threadId: string): string {
  const suffix = threadId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);
  return `fix-${clusterId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${suffix}`;
}
