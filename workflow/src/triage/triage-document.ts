import { z } from "zod";

const rect = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const step = z.strictObject({ status: z.union([z.literal(0), z.literal(1), z.literal(2)]), reusedFrom: z.string().nullable() });

/** Execution outcomes of a case: did every action run, and where the canonical side came from (`mixed`: some sides from the cache, some live). */
const ExecutionSchema = z.strictObject({
  coverageValid: z.boolean(),
  invalidReasons: z.array(z.string()),
  canonicalSource: z.enum(["live", "cache", "mixed"]),
});

/** Visual outcomes of a case: the capture runner's results and the comparer's report. */
const VisualSchema = z.strictObject({
  passed: z.number().int(),
  failed: z.number().int(),
  reportStatus: z.enum(["clear", "differences", "analysis-failures"]),
  discrepancies: z.number().int(),
  groups: z.number().int(),
  completeness: z.strictObject({
    planned: z.number(), reported: z.number(), analysisFailed: z.number(), filtered: z.number(),
    optionalAbsent: z.number(), executionLost: z.number(), unaccounted: z.number(),
  }),
});

const MemberSchema = z.strictObject({
  case: z.string(),
  capture: z.string(),
  discrepancy: z.string(),
  core: rect,
  crop: rect,
  differingPixels: z.number(),
  canonicalCrop: z.string(),
  candidateCrop: z.string(),
});

const OtherFindingSchema = z.strictObject({
  case: z.string(),
  capture: z.string(),
  kind: z.enum(["failed", "size-mismatch", "missing-canonical", "missing-candidate", "execution-lost", "unaccounted"]),
  detail: z.string().optional(),
});

/** `triage.json`: one thread's cases, its discrepancy clusters with stable identities, and everything else found. */
export const TriageDocumentSchema = z.strictObject({
  threadId: z.string(),
  cases: z.array(z.strictObject({
    case: z.string(),
    runFolder: z.string(),
    capture: step,
    compare: step,
    execution: ExecutionSchema,
    visual: VisualSchema,
  })),
  clusters: z.array(z.strictObject({
    id: z.string(),
    known: z.boolean(),
    imageHash: z.string(),
    cases: z.array(z.string()),
    captures: z.array(z.string()),
    members: z.array(MemberSchema).min(1),
  })),
  otherFindings: z.array(OtherFindingSchema),
  totals: z.strictObject({
    cases: z.number().int(),
    discrepancies: z.number().int(),
    clusters: z.number().int(),
    newClusters: z.number().int(),
    knownClusters: z.number().int(),
    otherFindings: z.number().int(),
  }),
});
export type TriageDocument = z.infer<typeof TriageDocumentSchema>;
export type OtherFinding = z.infer<typeof OtherFindingSchema>;
