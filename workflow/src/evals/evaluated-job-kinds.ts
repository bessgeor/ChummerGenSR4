import { challengePromptVersion, hypothesisPromptVersion } from "../diagnosis/job-schemas.js";
import { rankPromptVersion, scenarioPromptVersion } from "../discovery/job-schemas.js";

/** The job kinds evaluation runs, scores and certifies, with the prompt version the code has for each. */
export const promptVersions = { hypothesis: hypothesisPromptVersion, challenge: challengePromptVersion, rank: rankPromptVersion, scenario: scenarioPromptVersion } as const;
export const evaluatedJobKinds = ["hypothesis", "challenge", "rank", "scenario"] as const;
export type EvaluatedJobKind = (typeof evaluatedJobKinds)[number];
