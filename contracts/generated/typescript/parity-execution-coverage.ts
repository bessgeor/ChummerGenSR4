import * as z from "zod";


export const ModeSchema = z.enum([
    "build",
    "career",
]);
export type Mode = z.infer<typeof ModeSchema>;

// The capture action's outcome, as in the summary; missing when no record has the action.

export const OutcomeSchema = z.enum([
    "failed",
    "filtered",
    "missing",
    "not-run",
    "optional-absent",
    "performed",
    "skipped-optional",
]);
export type Outcome = z.infer<typeof OutcomeSchema>;


export const SideSchema = z.enum([
    "candidate",
    "canonical",
]);
export type Side = z.infer<typeof SideSchema>;

// live: the side ran in this run; cache: its record came from the canonical capture cache.

export const SourceSchema = z.enum([
    "cache",
    "live",
]);
export type Source = z.infer<typeof SourceSchema>;

export const CaptureCoverageSchema = z.object({
    "capture": z.string(),
    "file": z.boolean(),
    "outcome": OutcomeSchema,
});
export type CaptureCoverage = z.infer<typeof CaptureCoverageSchema>;

export const ActionReferenceSchema = z.object({
    "action": z.string(),
    "index": z.number(),
    "reason": z.string().optional(),
});
export type ActionReference = z.infer<typeof ActionReferenceSchema>;

export const CoverageTotalsSchema = z.object({
    "actions": z.number(),
    "cachedSides": z.number(),
    "capturedPairs": z.number(),
    "cases": z.number(),
    "failures": z.number(),
    "filtered": z.number(),
    "notRun": z.number(),
    "optionalAbsent": z.number(),
    "plannedCaptures": z.number(),
    "sides": z.number(),
    "skippedOptional": z.number(),
    "startupFailures": z.number(),
});
export type CoverageTotals = z.infer<typeof CoverageTotalsSchema>;

export const SideCoverageSchema = z.object({
    "captures": z.array(CaptureCoverageSchema),
    "contiguous": z.boolean(),
    "failures": z.array(ActionReferenceSchema),
    "filtered": z.number(),
    "notRun": z.number(),
    "optionalAbsent": z.array(ActionReferenceSchema),
    "recordedActions": z.number(),
    "side": SideSchema,
    "skippedOptional": z.array(ActionReferenceSchema),
    "source": SourceSchema,
    "startupFailure": z.string().optional(),
});
export type SideCoverage = z.infer<typeof SideCoverageSchema>;

export const CaseCoverageSchema = z.object({
    "case": z.string(),
    "characterFile": z.string(),
    "mode": ModeSchema,
    "plannedActions": z.number(),
    "plannedCaptures": z.array(z.string()),
    "sides": z.array(SideCoverageSchema),
});
export type CaseCoverage = z.infer<typeof CaseCoverageSchema>;

export const ExecutionCoverageSchema = z.object({
    "cases": z.array(CaseCoverageSchema),
    "invalidReasons": z.array(z.string()),
    "runId": z.string(),
    "totals": CoverageTotalsSchema,
    "valid": z.boolean(),
});
export type ExecutionCoverage = z.infer<typeof ExecutionCoverageSchema>;
