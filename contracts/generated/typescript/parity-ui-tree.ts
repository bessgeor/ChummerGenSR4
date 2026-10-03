import * as z from "zod";

// Trees are recorded on the candidate side only.

export const SideSchema = z.enum([
    "candidate",
]);
export type Side = z.infer<typeof SideSchema>;

export const UiBoundsSchema = z.object({
    "height": z.number(),
    "width": z.number(),
    "x": z.number(),
    "y": z.number(),
});
export type UiBounds = z.infer<typeof UiBoundsSchema>;

export const UiNodeSchema = z.object({
    "automationId": z.string(),
    "bounds": UiBoundsSchema,
    "className": z.string(),
    "controlType": z.string(),
    "enabled": z.boolean(),
    "name": z.string(),
    "parent": z.union([z.number(), z.null()]),
});
export type UiNode = z.infer<typeof UiNodeSchema>;

export const UiTreeSchema = z.object({
    "capture": z.string(),
    "case": z.string(),
    "nodes": z.array(UiNodeSchema).min(1),
    "runId": z.string(),
    "side": SideSchema,
});
export type UiTree = z.infer<typeof UiTreeSchema>;
