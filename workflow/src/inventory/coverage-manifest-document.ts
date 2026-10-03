import { z } from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();
const reason = z.string().min(1);

/** A capture the candidate side performed, with its tree. */
const SeenSchema = z.strictObject({ case: z.string().min(1), capture: z.string().min(1) });

export const TupleStatusSchema = z.enum(["observed", "failed", "filtered", "missing", "not-run", "optional-absent", "skipped-optional", "not-captured"]);
export type TupleStatus = z.infer<typeof TupleStatusSchema>;

const TupleSchema = z.strictObject({
  case: z.string().min(1),
  mode: z.enum(["build", "career"]),
  capture: z.string().min(1),
  /** `observed` for a performed capture with its tree, the candidate side's outcome otherwise, or `not-captured` when no run read holds the case. */
  status: TupleStatusSchema,
  /** The run holding the case, or null for `not-captured`. */
  runId: z.string().min(1).nullable(),
});

const ClassSummarySchema = z.strictObject({
  name: z.string().min(1),
  scope: z.enum(["active", "deferred"]),
  reason,
  /** The class's controls but the windowless ones; every one of a deferred class's is deferred. */
  controls: count,
  observedControls: count,
  windowlessControls: count,
  interactions: count,
  exercisedInteractions: count,
  deferredInteractions: count,
});

/** The fields every control variant has. */
const controlFields = { id: z.string().min(1), class: z.string().min(1), name: z.string().min(1), type: z.string().min(1) };

const ControlSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...controlFields, status: z.literal("observed"), seenIn: z.array(SeenSchema).min(1) }),
  z.strictObject({ ...controlFields, status: z.literal("unobserved") }),
  z.strictObject({ ...controlFields, status: z.literal("windowless") }),
  z.strictObject({ ...controlFields, status: z.literal("deferred"), reason }),
]);
export type ManifestControl = z.infer<typeof ControlSchema>;

/** Two consecutive performed captures of a case between which a `selectTab` changed the tab control's visible page. */
const ProofSchema = z.strictObject({ case: z.string().min(1), from: z.string().min(1), to: z.string().min(1), fromPage: z.string().min(1), toPage: z.string().min(1) });
export type ExerciseProof = z.infer<typeof ProofSchema>;

const interactionFields = {
  id: z.string().min(1), class: z.string().min(1), target: z.string().min(1).nullable(), event: z.string().min(1),
  handler: z.string().min(1), handlerFile: z.string().min(1), handlerLine: z.number().int().positive(),
};
const InteractionSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...interactionFields, status: z.literal("exercised"), proofs: z.array(ProofSchema).min(1) }),
  z.strictObject({ ...interactionFields, status: z.literal("unexercised") }),
  z.strictObject({ ...interactionFields, status: z.literal("deferred"), reason }),
]);
export type ManifestInteraction = z.infer<typeof InteractionSchema>;

const UnresolvedSchema = z.strictObject({ case: z.string().min(1), capture: z.string().min(1), automationIds: z.array(z.string().min(1)).min(1) });

/** `coverage-manifest.json`: the inventory and scope joined with what the capture runs proved. */
export const CoverageManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** The source inventory's `sourceSha256`. */
  sourceSha256: sha256,
  scope: z.strictObject({ path: z.string().min(1), sha256 }),
  runs: z.array(z.strictObject({ runId: z.string().min(1), runFolder: z.string().min(1), candidateSha256: sha256 })),
  tuples: z.array(TupleSchema),
  classes: z.array(ClassSummarySchema),
  controls: z.array(ControlSchema),
  interactions: z.array(InteractionSchema),
  unresolved: z.array(UnresolvedSchema),
  totals: z.strictObject({
    classes: count,
    activeClasses: count,
    controls: z.strictObject({ active: count, observed: count, windowless: count, deferred: count }),
    interactions: z.strictObject({ active: count, exercised: count, deferred: count }),
    tuples: z.strictObject({
      planned: count, observed: count, failed: count, filtered: count, missing: count,
      "not-run": count, "optional-absent": count, "skipped-optional": count, "not-captured": count,
    }),
    /** Automation IDs that matched nothing, counted once per capture. */
    unresolved: count,
  }),
});
export type CoverageManifest = z.infer<typeof CoverageManifestSchema>;
