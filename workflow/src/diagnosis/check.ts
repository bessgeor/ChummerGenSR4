import type { CaptureResults } from "../../../contracts/generated/typescript/parity-capture-results.js";
import type { CheckLabel } from "../evals/eval-record.js";
import { clusterStatus, variantOf, variantsOf, type ClusterDiagnosis, type HypothesisVariant } from "./cluster-diagnosis.js";
import type { Prediction } from "./job-schemas.js";

export type Observation = "differs" | "matches" | "not-observed";

export type ObservedCapture = { readonly case: string; readonly capture: string; readonly observation: Observation; readonly detail: string };

/** One prediction against what the check run observed; `held` is null when nothing was observed. */
export type PredictionCheck = Prediction & { readonly observed: Observation; readonly held: boolean | null };

/** One hypothesis judged with its own alternative. */
export type Judgement = {
  readonly outcome: CheckLabel;
  readonly hypothesis: readonly PredictionCheck[];
  readonly alternative: readonly PredictionCheck[] | null;
};

/** A judged hypothesis of a cluster: 1 for the first. */
export type VariantCheck = Judgement & { readonly variant: number };

/**
 * A cluster's check: its outcome from its hypotheses', the first judged hypothesis's predictions at the top level, and
 * every judged hypothesis in `variants`, which a check stored with one hypothesis per cluster lacks.
 */
export type ClusterCheck = Judgement & { readonly variants?: readonly VariantCheck[] };

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

/** What a hypothesis and its challenge predict. */
type Predicting = Pick<HypothesisVariant, "hypothesis" | "challenge">;

function predictionsOf(variant: Predicting): { hypothesis: readonly Prediction[]; alternative: readonly Prediction[] | null } {
  return {
    hypothesis: variant.hypothesis?.output.explanation?.predictions ?? [],
    alternative: variant.challenge?.output.alternative?.predictions ?? null,
  };
}

/** The hypotheses of a cluster that the check judges: those that were challenged. */
function challengedVariants(cluster: ClusterDiagnosis): HypothesisVariant[] {
  return variantsOf(cluster).filter((variant) => variant.status === "challenged");
}

/**
 * The union of the cases and captures that every challenged hypothesis of every challenged cluster and their
 * alternatives predict, in first-named order; null when there are none.
 */
export function planCheck(clusters: Readonly<Record<string, ClusterDiagnosis>>): CheckPlan | null {
  const checked = Object.values(clusters).filter((cluster) => clusterStatus(cluster) === "challenged");
  const cases: string[] = [];
  const captures: string[] = [];
  const predicted: { case: string; capture: string }[] = [];
  for (const variant of checked.flatMap(challengedVariants)) {
    const { hypothesis, alternative } = predictionsOf(variant);
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
export function judge(variant: Predicting, observations: readonly ObservedCapture[]): Judgement {
  const { hypothesis, alternative } = predictionsOf(variant);
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

/**
 * Judges every challenged hypothesis of a cluster: the cluster is `confirmed` when any hypothesis is, `refuted` when
 * every hypothesis that predicted is refuted, and `undecided` otherwise.
 */
export function checkCluster(cluster: ClusterDiagnosis, observations: readonly ObservedCapture[]): ClusterCheck & { readonly variants: readonly VariantCheck[] } {
  const variants = challengedVariants(cluster).map((variant) => ({ variant: variant.variant, ...judge(variant, observations) }));
  const first = variants[0];
  if (first === undefined) throw new Error(`Cluster ${cluster.clusterId} has no challenged hypothesis to check.`);
  const predicting = variants.filter((variant) => variant.hypothesis.length > 0);
  const outcome: CheckLabel = variants.some((variant) => variant.outcome === "confirmed") ? "confirmed"
    : predicting.length > 0 && predicting.every((variant) => variant.outcome === "refuted") ? "refuted" : "undecided";
  return { outcome, hypothesis: first.hypothesis, alternative: first.alternative, variants };
}

/** A cluster's judged hypotheses; a check stored with one hypothesis per cluster judged the first. */
export function variantChecks(check: ClusterCheck): readonly VariantCheck[] {
  return check.variants ?? [{ variant: 1, outcome: check.outcome, hypothesis: check.hypothesis, alternative: check.alternative }];
}

/**
 * The cluster as its first confirmed hypothesis shows it: that hypothesis's status, answers and failure in the
 * cluster's first-hypothesis fields. A cluster without a confirmed hypothesis is a bug of the caller.
 */
export function confirmedHypothesis(cluster: ClusterDiagnosis, check: CheckResult): ClusterDiagnosis {
  const judged = check.clusters[cluster.clusterId];
  const confirmed = judged === undefined ? undefined : variantChecks(judged).find((item) => item.outcome === "confirmed");
  if (confirmed === undefined) throw new Error(`Cluster ${cluster.clusterId} has no confirmed hypothesis.`);
  const variant = variantOf(cluster, confirmed.variant);
  return { ...cluster, status: variant.status, hypothesis: variant.hypothesis, challenge: variant.challenge, failure: variant.failure };
}
