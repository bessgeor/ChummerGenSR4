import * as z from "zod";


export const ModeSchema = z.enum([
    "build",
    "career",
]);
export type Mode = z.infer<typeof ModeSchema>;


export const ActionOutcomeSchema = z.enum([
    "failed",
    "filtered",
    "not-run",
    "optional-absent",
    "performed",
    "skipped-optional",
]);
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;


export const SideSchema = z.enum([
    "candidate",
    "canonical",
]);
export type Side = z.infer<typeof SideSchema>;


export const StatusSchema = z.enum([
    "completed",
    "failed",
]);
export type Status = z.infer<typeof StatusSchema>;

// passed = exit 0, visual-differences = exit 1, execution-failures = exit 2, setup-error =
// exit 3.

export const RunStatusSchema = z.enum([
    "execution-failures",
    "passed",
    "setup-error",
    "visual-differences",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const CandidateExecutableSchema = z.object({
    "sha256": z.string().optional(),
    "sourcePath": z.string(),
    "stagedPath": z.string().optional(),
});
export type CandidateExecutable = z.infer<typeof CandidateExecutableSchema>;

export const CanonicalExecutableSchema = z.object({
    "pinnedSha256": z.string(),
    "sourcePath": z.string(),
    "sourceSha256After": z.string().optional(),
    "sourceSha256Before": z.string(),
    "stagedPath": z.string().optional(),
    "stagedSha256After": z.string().optional(),
    "stagedSha256Before": z.string().optional(),
});
export type CanonicalExecutable = z.infer<typeof CanonicalExecutableSchema>;

export const ActionExecutionSchema = z.object({
    "action": z.string(),
    "index": z.number(),
    "optional": z.boolean(),
    "outcome": ActionOutcomeSchema,
    "reason": z.string().optional(),
});
export type ActionExecution = z.infer<typeof ActionExecutionSchema>;

export const OutcomeCountsSchema = z.object({
    "failed": z.number(),
    "filtered": z.number(),
    "notRun": z.number(),
    "optionalAbsent": z.number(),
    "performed": z.number(),
    "skippedOptional": z.number(),
});
export type OutcomeCounts = z.infer<typeof OutcomeCountsSchema>;

export const ScreenRectSchema = z.object({
    "height": z.number(),
    "width": z.number(),
    "x": z.number(),
    "y": z.number(),
});
export type ScreenRect = z.infer<typeof ScreenRectSchema>;

export const OverlayFileSchema = z.object({
    "path": z.string(),
    "replaced": z.boolean(),
    "sha256": z.string(),
});
export type OverlayFile = z.infer<typeof OverlayFileSchema>;

export const RunTotalsSchema = z.object({
    "captures": z.number(),
    "cases": z.number(),
    "failedActions": z.number(),
    "failedSides": z.number(),
    "visualFailed": z.number(),
    "visualPassed": z.number(),
});
export type RunTotals = z.infer<typeof RunTotalsSchema>;

export const SideExecutionSchema = z.object({
    "actions": z.array(ActionExecutionSchema),
    "counts": OutcomeCountsSchema,
    "durationMilliseconds": z.number(),
    "failure": z.string().optional(),
    "side": SideSchema,
    "status": StatusSchema,
});
export type SideExecution = z.infer<typeof SideExecutionSchema>;

export const ScreenInfoSchema = z.object({
    "bounds": ScreenRectSchema,
    "deviceName": z.string(),
    "primary": z.boolean(),
    "workingArea": ScreenRectSchema,
});
export type ScreenInfo = z.infer<typeof ScreenInfoSchema>;

export const SettingsOverlaySchema = z.object({
    "files": z.array(OverlayFileSchema),
    "path": z.string(),
});
export type SettingsOverlay = z.infer<typeof SettingsOverlaySchema>;

export const CaseExecutionSchema = z.object({
    "case": z.string(),
    "characterFile": z.string(),
    "mode": ModeSchema,
    "sides": z.array(SideExecutionSchema),
});
export type CaseExecution = z.infer<typeof CaseExecutionSchema>;

export const CaptureSummarySchema = z.object({
    "candidate": CandidateExecutableSchema,
    "canonical": CanonicalExecutableSchema,
    "caseFile": z.string(),
    "cases": z.array(CaseExecutionSchema),
    "finishedUtc": z.string().optional(),
    "results": z.string().optional(),
    "runId": z.string(),
    "screens": z.array(ScreenInfoSchema),
    "settingsOverlay": SettingsOverlaySchema.optional(),
    "setupError": z.string().optional(),
    "startedUtc": z.string(),
    "status": RunStatusSchema,
    "threshold": z.number(),
    "totals": RunTotalsSchema,
});
export type CaptureSummary = z.infer<typeof CaptureSummarySchema>;
