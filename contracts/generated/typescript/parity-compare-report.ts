import * as z from "zod";

// reported: its row is in the report and did not fail; analysis-failed: its row failed;
// filtered: both sides filtered it; optional-absent: each side skipped it because an
// optional tab was absent; execution-lost: no row, and a side's capture action failed or
// did not run; unaccounted: none of these.

export const CompletenessStateSchema = z.enum([
    "analysis-failed",
    "execution-lost",
    "filtered",
    "optional-absent",
    "reported",
    "unaccounted",
]);
export type CompletenessState = z.infer<typeof CompletenessStateSchema>;

// text: text was read; empty: no text was read; error: reading failed; disabled: OCR was
// turned off for the run.

export const OcrStatusSchema = z.enum([
    "disabled",
    "empty",
    "error",
    "text",
]);
export type OcrStatus = z.infer<typeof OcrStatusSchema>;


export const ModeSchema = z.enum([
    "build",
    "career",
]);
export type Mode = z.infer<typeof ModeSchema>;


export const RowStatusSchema = z.enum([
    "analyzed",
    "failed",
    "missing-candidate",
    "missing-canonical",
    "passed",
    "size-mismatch",
]);
export type RowStatus = z.infer<typeof RowStatusSchema>;

// clear: every row passed; differences: differences reported and nothing failed;
// analysis-failures: a row failed, an OCR result is an error or a planned capture is
// unaccounted.

export const ReportStatusSchema = z.enum([
    "analysis-failures",
    "clear",
    "differences",
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const CompletenessEntrySchema = z.object({
    "capture": z.string(),
    "case": z.string(),
    "detail": z.string().optional(),
    "state": CompletenessStateSchema,
});
export type CompletenessEntry = z.infer<typeof CompletenessEntrySchema>;

export const CompletenessTotalsSchema = z.object({
    "analysisFailed": z.number(),
    "executionLost": z.number(),
    "filtered": z.number(),
    "optionalAbsent": z.number(),
    "planned": z.number(),
    "reported": z.number(),
    "unaccounted": z.number(),
});
export type CompletenessTotals = z.infer<typeof CompletenessTotalsSchema>;

export const OcrReadingSchema = z.object({
    "error": z.string().optional(),
    "status": OcrStatusSchema,
    "text": z.string().optional(),
});
export type OcrReading = z.infer<typeof OcrReadingSchema>;

export const PixelRectSchema = z.object({
    "height": z.number(),
    "width": z.number(),
    "x": z.number(),
    "y": z.number(),
});
export type PixelRect = z.infer<typeof PixelRectSchema>;

export const DiscrepancyGroupSchema = z.object({
    "members": z.array(z.string()).min(1),
    "representative": z.string(),
});
export type DiscrepancyGroup = z.infer<typeof DiscrepancyGroupSchema>;

export const OcrSettingsSchema = z.object({
    "enabled": z.boolean(),
    "language": z.string().optional(),
});
export type OcrSettings = z.infer<typeof OcrSettingsSchema>;

export const ImageSizeSchema = z.object({
    "height": z.number(),
    "width": z.number(),
});
export type ImageSize = z.infer<typeof ImageSizeSchema>;

export const ReportTotalsSchema = z.object({
    "analyzed": z.number(),
    "discrepancies": z.number(),
    "failed": z.number(),
    "groups": z.number(),
    "missing": z.number(),
    "ocrErrors": z.number(),
    "passed": z.number(),
    "rows": z.number(),
    "sizeMismatches": z.number(),
});
export type ReportTotals = z.infer<typeof ReportTotalsSchema>;

export const CompletenessSchema = z.object({
    "complete": z.boolean(),
    "entries": z.array(CompletenessEntrySchema),
    "totals": CompletenessTotalsSchema,
});
export type Completeness = z.infer<typeof CompletenessSchema>;

export const DiscrepancySchema = z.object({
    "candidateCrop": z.string(),
    "candidateOcr": OcrReadingSchema,
    "canonicalCrop": z.string(),
    "canonicalOcr": OcrReadingSchema,
    "capture": z.string(),
    "case": z.string(),
    "core": PixelRectSchema,
    "crop": PixelRectSchema,
    "differingPixels": z.number(),
    "id": z.string(),
    "imageHash": z.string(),
    "representative": z.string(),
});
export type Discrepancy = z.infer<typeof DiscrepancySchema>;

export const ReportRowSchema = z.object({
    "candidateCapture": z.string().optional(),
    "candidateSize": ImageSizeSchema.optional(),
    "canonicalCapture": z.string().optional(),
    "canonicalSize": ImageSizeSchema.optional(),
    "capture": z.string(),
    "case": z.string(),
    "characterFile": z.string(),
    "difference": z.number(),
    "differingPixels": z.number().optional(),
    "discrepancies": z.array(z.string()),
    "failure": z.string().optional(),
    "mode": ModeSchema,
    "status": RowStatusSchema,
});
export type ReportRow = z.infer<typeof ReportRowSchema>;

export const CompareReportSchema = z.object({
    "completeness": CompletenessSchema,
    "discrepancies": z.array(DiscrepancySchema),
    "groups": z.array(DiscrepancyGroupSchema),
    "ocr": OcrSettingsSchema,
    "rows": z.array(ReportRowSchema),
    "runId": z.string(),
    "status": ReportStatusSchema,
    "threshold": z.number(),
    "totals": ReportTotalsSchema,
});
export type CompareReport = z.infer<typeof CompareReportSchema>;
