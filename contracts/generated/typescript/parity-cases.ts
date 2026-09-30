import * as z from "zod";


export const CaseActionTypeSchema = z.enum([
    "capture",
    "include",
    "selectTab",
    "wait",
    "waitFor",
]);
export type CaseActionType = z.infer<typeof CaseActionTypeSchema>;

// build: the character is still being created; career: <created> is True.

export const CharacterModeSchema = z.enum([
    "build",
    "career",
]);
export type CharacterMode = z.infer<typeof CharacterModeSchema>;

export const CaseActionSchema = z.object({
    "label": z.string().optional(),
    "milliseconds": z.number().optional(),
    "name": z.string().optional(),
    "optional": z.boolean().optional(),
    "type": CaseActionTypeSchema,
});
export type CaseAction = z.infer<typeof CaseActionSchema>;

export const CharacterEntrySchema = z.object({
    "mode": CharacterModeSchema,
    "path": z.string(),
});
export type CharacterEntry = z.infer<typeof CharacterEntrySchema>;

export const ParityCasesSchema = z.object({
    "buildActions": z.array(CaseActionSchema),
    "careerActions": z.array(CaseActionSchema),
    "characters": z.array(CharacterEntrySchema).min(1),
    "sequences": z.record(z.string(), z.array(CaseActionSchema)),
    "settleMilliseconds": z.number(),
    "startupDelaySeconds": z.number(),
});
export type ParityCases = z.infer<typeof ParityCasesSchema>;
