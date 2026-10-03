import { z } from "zod";

export const rankPromptVersion = "rank-v1";
export const scenarioPromptVersion = "scenario-v1";

export const feasibilities = ["feasible", "uncertain", "infeasible"] as const;
export const planActionTypes = ["selectTab", "waitFor", "wait", "capture", "include"] as const;

/*
 * As with the diagnosis jobs, the schemas carry types, enums and nullability only: both structured-output
 * implementations accept them. Counts, ranges, references and the action vocabulary are checked afterwards.
 */

const RankingSchema = z.strictObject({
  targetId: z.string(),
  /** How likely a scenario in the case-file actions shows the target, from 0 to 1. */
  score: z.number(),
  feasibility: z.enum(feasibilities),
  /** The fixture case a scenario would use, or null. */
  case: z.string().nullable(),
  reason: z.string(),
});

export const RankOutputSchema = z.strictObject({ rankings: z.array(RankingSchema) });

/** A case-file action as a plan states it; the plan validator decides which fields each type takes. */
export const PlanActionSchema = z.strictObject({
  type: z.enum(planActionTypes),
  name: z.string().nullable(),
  label: z.string().nullable(),
  milliseconds: z.number().nullable(),
  optional: z.boolean().nullable(),
});

export const PlanSchema = z.strictObject({
  /** A fixture case of the case file. */
  case: z.string(),
  actions: z.array(PlanActionSchema),
  /** The target's controls the plan expects its captures to show. */
  expect: z.array(z.string()),
});

export const ScenarioOutputSchema = z.strictObject({
  outcome: z.enum(["plan", "abstain"]),
  reason: z.string(),
  plan: PlanSchema.nullable(),
});

export type Ranking = z.infer<typeof RankingSchema>;
export type RankOutput = z.infer<typeof RankOutputSchema>;
export type PlanAction = z.infer<typeof PlanActionSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type ScenarioOutput = z.infer<typeof ScenarioOutputSchema>;
