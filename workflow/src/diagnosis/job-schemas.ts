import { z } from "zod";

export const hypothesisPromptVersion = "hypothesis-v1";
export const challengePromptVersion = "challenge-v1";

export const mechanisms = ["layout", "text", "data", "rendering", "resources", "timing", "other"] as const;

/*
 * The schemas carry types, enums and nullability only: both structured-output implementations accept them.
 * Counts, ranges and non-empty text are checked by the jobs' validation instead.
 */

const LocationSchema = z.strictObject({
  /** A file path relative to the source snapshot. */
  path: z.string(),
  symbol: z.string().nullable(),
  line: z.number().int().nullable(),
});

const PredictionSchema = z.strictObject({
  case: z.string(),
  capture: z.string(),
  /** Whether capturing this case and capture again on both executables shows a difference. */
  expect: z.enum(["differs", "matches"]),
  why: z.string(),
});

export const ExplanationSchema = z.strictObject({
  claim: z.string(),
  mechanism: z.enum(mechanisms),
  locations: z.array(LocationSchema),
  evidence: z.string(),
  confidence: z.number(),
  predictions: z.array(PredictionSchema),
});

export const HypothesisOutputSchema = z.strictObject({
  outcome: z.enum(["hypothesis", "abstain"]),
  /** Why the explanation is offered, or why there is none. */
  reason: z.string(),
  explanation: ExplanationSchema.nullable(),
});

export const ChallengeOutputSchema = z.strictObject({
  outcome: z.enum(["alternative", "no_alternative"]),
  reason: z.string(),
  alternative: ExplanationSchema.nullable(),
});

export type Explanation = z.infer<typeof ExplanationSchema>;
export type Prediction = z.infer<typeof PredictionSchema>;
export type HypothesisOutput = z.infer<typeof HypothesisOutputSchema>;
export type ChallengeOutput = z.infer<typeof ChallengeOutputSchema>;
