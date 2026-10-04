import * as z from "zod";


export const OperationSchema = z.enum([
    "activate",
    "capture",
    "click",
    "close",
    "contextMenu",
    "launch",
    "saveReload",
    "selectItem",
    "selectTab",
    "setValue",
    "uiTree",
    "wait",
    "waitForLabel",
]);
export type Operation = z.infer<typeof OperationSchema>;


export const SideSchema = z.enum([
    "candidate",
    "canonical",
]);
export type Side = z.infer<typeof SideSchema>;

export const OperationTimingSchema = z.object({
    "count": z.number(),
    "failures": z.number(),
    "maxMilliseconds": z.number(),
    "medianMilliseconds": z.number(),
    "operation": OperationSchema,
    "p80Milliseconds": z.number(),
    "totalMilliseconds": z.number(),
});
export type OperationTiming = z.infer<typeof OperationTimingSchema>;

export const TimingSampleSchema = z.object({
    "error": z.string().optional(),
    "milliseconds": z.number(),
    "operation": OperationSchema,
    "succeeded": z.boolean(),
    "target": z.string().optional(),
});
export type TimingSample = z.infer<typeof TimingSampleSchema>;

export const SideTimingSchema = z.object({
    "case": z.string(),
    "samples": z.array(TimingSampleSchema),
    "side": SideSchema,
    "totalMilliseconds": z.number(),
});
export type SideTiming = z.infer<typeof SideTimingSchema>;

export const CaptureTimingSchema = z.object({
    "operations": z.array(OperationTimingSchema),
    "runId": z.string(),
    "sides": z.array(SideTimingSchema),
});
export type CaptureTiming = z.infer<typeof CaptureTimingSchema>;
