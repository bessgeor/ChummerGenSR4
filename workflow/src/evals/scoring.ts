import type { ChallengeOutput, Explanation, HypothesisOutput } from "../diagnosis/job-schemas.js";
import type { DatasetItem } from "./dataset.js";
import { gradeExplanation, isRight, type RootCause } from "./root-cause.js";

export type Scores = { readonly prediction: boolean; readonly rootCause: boolean | null };

type Observations = DatasetItem["observations"];

/** Each prediction's outcome against the observations: true or false when observed, null when not. */
function held(explanation: Explanation, observations: Observations): (boolean | null)[] {
  return explanation.predictions.map((prediction) => {
    const observed = observations.find((row) => row.case === prediction.case && row.capture === prediction.capture)?.observation ?? "not-observed";
    return observed === "not-observed" ? null : observed === prediction.expect;
  });
}

/** At least one prediction observed, and every observed one held. */
export function predictionsHold(explanation: Explanation, observations: Observations): boolean {
  const outcomes = held(explanation, observations).filter((value) => value !== null);
  return outcomes.length > 0 && outcomes.every((value) => value);
}

/** Some observed prediction did not hold. */
function predictionsFail(explanation: Explanation, observations: Observations): boolean {
  return held(explanation, observations).some((value) => value === false);
}

function right(explanation: Explanation | null, gold: RootCause): boolean {
  return explanation !== null && isRight(gradeExplanation(explanation, gold));
}

/** The prediction and root-cause scores of a hypothesis answer. */
export function scoreHypothesis(output: HypothesisOutput, item: DatasetItem): Scores {
  const explanation = output.explanation;
  return {
    prediction: explanation !== null && predictionsHold(explanation, item.observations),
    rootCause: item.gold === null ? null : right(explanation, item.gold),
  };
}

/**
 * The scores of a challenge answer: no alternative is right when the hypothesis is; an alternative is right when it
 * is and the hypothesis is not.
 */
export function scoreChallenge(output: ChallengeOutput, item: DatasetItem): Scores {
  const hypothesis = item.hypothesis;
  if (hypothesis === null) throw new Error(`Challenge item ${item.itemId} has no hypothesis.`);
  const alternative = output.alternative;
  const prediction = alternative === null
    ? predictionsHold(hypothesis, item.observations)
    : predictionsHold(alternative, item.observations) && predictionsFail(hypothesis, item.observations);
  if (item.gold === null) return { prediction, rootCause: null };
  return { prediction, rootCause: alternative === null ? right(hypothesis, item.gold) : right(alternative, item.gold) && !right(hypothesis, item.gold) };
}

/** A failed job fails both metrics; the root-cause metric stays null without gold. */
export function failedScores(item: DatasetItem): Scores {
  return { prediction: false, rootCause: item.gold === null ? null : false };
}
