import type { Tuning } from "../src/tuning/tuning.js";

/** A valid configuration of a job kind for the code's current prompt: two guidance lines and the file layout. */
export function tuning(fields: Partial<Tuning> = {}): Tuning {
  const jobKind = fields.jobKind ?? "scenario";
  const base = { hypothesis: "hypothesis-v2", challenge: "challenge-v2", rank: "rank-v2", scenario: "scenario-v1" }[jobKind];
  return { schemaVersion: 1, jobKind, basePromptVersion: base, guidance: ["Prefer the fixture whose tabs already show the target's page.", "Name every expected control."], context: "file", ...fields };
}
