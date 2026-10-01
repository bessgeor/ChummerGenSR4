import type { CaptureResults } from "../../../contracts/generated/typescript/parity-capture-results.js";
import type { CheckLabel } from "../evals/eval-record.js";
import type { ClusterDiagnosis } from "./cluster-diagnosis.js";
import type { Prediction } from "./job-schemas.js";

export type Observation = "differs" | "matches" | "not-observed";

export type ObservedCapture = { readonly case: string; readonly capture: string; readonly observation: Observation; readonly detail: string };

/** One prediction against what the check run observed; `held` is null when nothing was observed. */
export type PredictionCheck = Prediction & { readonly observed: Observation; readonly held: boolean | null };

export type ClusterCheck = {
  readonly outcome: CheckLabel;
  readonly hypothesis: readonly PredictionCheck[];
  readonly alternative: readonly PredictionCheck[] | null;
};

/** The check run: its execution outcome apart from its observations, and each checked cluster's outcome. */
export type CheckResult = {
  readonly runFolder: string;
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly execution: { readonly status: 0 | 1 | 2; readonly coverageValid: boolean; readonly invalidReasons: readonly string[]; readonly failures: number };
  readonly observations: readonly ObservedCapture[];
  readonly clusters: Readonly<Record<string, ClusterCheck>>;
};

export type CheckPlan = {
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly checked: readonly string[];
  /** Each predicted case and capture once, in first-named order: what the check run has to observe. */
  readonly predicted: readonly { readonly case: string; readonly capture: string }[];
};

function predictionsOf(cluster: ClusterDiagnosis): { hypothesis: readonly Prediction[]; alternative: readonly Prediction[] | null } {
  return {
    hypothesis: cluster.hypothesis?.output.explanation?.predictions ?? [],
    alternative: cluster.challenge?.output.alternative?.predictions ?? null,
  };
}

/** The union of the cases and captures every challenged cluster predicts, in first-named order; null when there are none. */
export function planCheck(clusters: Readonly<Record<string, ClusterDiagnosis>>): CheckPlan | null {
  const checked = Object.values(clusters).filter((cluster) => cluster.status === "challenged");
  const cases: string[] = [];
  const captures: string[] = [];
  const predicted: { case: string; capture: string }[] = [];
  for (const cluster of checked) {
    const { hypothesis, alternative } = predictionsOf(cluster);
    for (const prediction of [...hypothesis, ...(alternative ?? [])]) {
      if (!cases.includes(prediction.case)) cases.push(prediction.case);
      if (!captures.includes(prediction.capture)) captures.push(prediction.capture);
      if (!predicted.some((item) => item.case === prediction.case && item.capture === prediction.capture)) {
        predicted.push({ case: prediction.case, capture: prediction.capture });
      }
    }
  }
  return cases.length === 0 ? null : { cases, captures, checked: checked.map((cluster) => cluster.clusterId), predicted };
}

/** What the check run's results say about one case and capture. */
export function observe(results: CaptureResults, caseName: string, capture: string): ObservedCapture {
  const row = results.results.find((item) => item.case === caseName && item.capture === capture);
  if (row === undefined) return { case: caseName, capture, observation: "not-observed", detail: "no result; the coverage document says why" };
  if (row.passed) return { case: caseName, capture, observation: "matches", detail: `within the threshold (${row.difference})` };
  if (row.reason === "visual-difference") return { case: caseName, capture, observation: "differs", detail: `visual difference (${row.difference})` };
  return { case: caseName, capture, observation: "not-observed", detail: row.reason };
}

function checkPredictions(predictions: readonly Prediction[], observations: readonly ObservedCapture[]): PredictionCheck[] {
  return predictions.map((prediction) => {
    const observed = observations.find((item) => item.case === prediction.case && item.capture === prediction.capture)?.observation ?? "not-observed";
    return { ...prediction, observed, held: observed === "not-observed" ? null : observed === prediction.expect };
  });
}

/**
 * `refuted` when an observed hypothesis prediction is wrong; `confirmed` when every hypothesis prediction is
 * observed and right and the alternative, if any, has an observed wrong prediction; else `undecided`.
 */
export function judge(cluster: ClusterDiagnosis, observations: readonly ObservedCapture[]): ClusterCheck {
  const { hypothesis, alternative } = predictionsOf(cluster);
  const hypothesisChecks = checkPredictions(hypothesis, observations);
  const alternativeChecks = alternative === null ? null : checkPredictions(alternative, observations);
  let outcome: CheckLabel = "undecided";
  if (hypothesisChecks.some((item) => item.held === false)) {
    outcome = "refuted";
  } else if (hypothesisChecks.length > 0 && hypothesisChecks.every((item) => item.held === true)
    && (alternativeChecks === null || alternativeChecks.some((item) => item.held === false))) {
    outcome = "confirmed";
  }
  return { outcome, hypothesis: hypothesisChecks, alternative: alternativeChecks };
}
