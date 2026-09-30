import * as z from "zod";


export const ModeSchema = z.enum([
    "build",
    "career",
]);
export type Mode = z.infer<typeof ModeSchema>;


export const ResultReasonSchema = z.enum([
    "missing-candidate",
    "missing-canonical",
    "visual-difference",
    "within-threshold",
]);
export type ResultReason = z.infer<typeof ResultReasonSchema>;

export const ImageSizeSchema = z.object({
    "height": z.number(),
    "width": z.number(),
});
export type ImageSize = z.infer<typeof ImageSizeSchema>;

export const CaptureResultSchema = z.object({
    "candidateCapture": z.string().optional(),
    "candidateSize": ImageSizeSchema.optional(),
    "canonicalCapture": z.string().optional(),
    "canonicalSize": ImageSizeSchema.optional(),
    "capture": z.string(),
    "case": z.string(),
    "characterFile": z.string(),
    "difference": z.number(),
    "mode": ModeSchema,
    "passed": z.boolean(),
    "reason": ResultReasonSchema,
});
export type CaptureResult = z.infer<typeof CaptureResultSchema>;

export const CaptureResultsSchema = z.object({
    "results": z.array(CaptureResultSchema),
    "runId": z.string(),
    "threshold": z.number(),
});
export type CaptureResults = z.infer<typeof CaptureResultsSchema>;
