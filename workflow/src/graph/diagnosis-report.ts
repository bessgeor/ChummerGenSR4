import { variantChecks, type CheckResult } from "../diagnosis/check.js";
import { clusterStatus, variantsOf, type ClusterDiagnosis, type HypothesisVariant, type JobAnswer } from "../diagnosis/cluster-diagnosis.js";

/** 2 when a cluster's job failed (`invalid_output`, `refused`) or the check run had execution failures, else 0. */
export function diagnosisStatus(clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): 0 | 2 {
  const failed = Object.values(clusters).some((cluster) => clusterStatus(cluster) === "failed");
  const lost = check !== null && (check.execution.status === 2 || !check.execution.coverageValid);
  return failed || lost ? 2 : 0;
}

function agent(answer: JobAnswer<unknown>): string {
  return `${answer.provider} ${answer.model ?? "default"}/${answer.effort}`;
}

/** A hypothesis's answers, failure and check outcome; `name` tells the hypotheses of a cluster with several apart. */
function describeVariant(variant: HypothesisVariant, name: string, checked: string | null): string[] {
  const parts: string[] = [];
  const hypothesis = variant.hypothesis;
  if (hypothesis !== null) {
    parts.push(hypothesis.output.explanation === null
      ? `${name} (${agent(hypothesis)}) abstained: ${hypothesis.output.reason}`
      : `${name} (${agent(hypothesis)}): ${hypothesis.output.explanation.claim}`);
  }
  const challenge = variant.challenge;
  if (challenge !== null) {
    parts.push(challenge.output.alternative === null
      ? `challenge (${agent(challenge)}): no alternative: ${challenge.output.reason}`
      : `challenge (${agent(challenge)}): alternative: ${challenge.output.alternative.claim}`);
  }
  if (variant.status === "failed" && variant.failure !== null) parts.push(`FAILED: ${variant.failure.job} ${variant.failure.kind}: ${variant.failure.message}`);
  if (variant.status === "budget_exhausted") parts.push("budget_exhausted: the run budget was spent before its next job");
  if (checked !== null) parts.push(`check ${checked}`);
  return parts;
}

function describeCluster(cluster: ClusterDiagnosis, check: CheckResult | null): string {
  const head = `Diagnosis ${cluster.clusterId}:`;
  const variants = variantsOf(cluster);
  const outcome = check?.clusters[cluster.clusterId];
  const judged = outcome === undefined ? [] : variantChecks(outcome);
  const parts = variants.length === 1
    ? describeVariant(variants[0]!, "hypothesis", null)
    : variants.flatMap((variant) => {
      const name = `hypothesis ${variant.variant}`;
      const described = describeVariant(variant, name, judged.find((item) => item.variant === variant.variant)?.outcome ?? null);
      return described.length === 0 ? [`${name} ${variant.status}`] : described;
    });
  if (outcome !== undefined) parts.push(`${variants.length === 1 ? "" : "cluster "}check ${outcome.outcome}`);
  return `${head} ${parts.length === 0 ? clusterStatus(cluster) : parts.join("; ")}; ${cluster.records.length} records`;
}

/** The diagnosis lines of the end-of-run report: one per cluster, then the check run's execution apart from its observations. */
export function describeDiagnosis(clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null, path: string | null): string[] {
  const lines = Object.values(clusters).map((cluster) => describeCluster(cluster, check));
  if (check !== null) {
    const execution = check.execution;
    lines.push(`Diagnosis check: execution: capture status ${execution.status}, coverage ${execution.coverageValid ? "valid" : `INVALID: ${execution.invalidReasons.join("; ")}`}, `
      + `${execution.failures} failures; run folder ${check.runFolder}`);
    lines.push(`Diagnosis check: observations: ${check.observations.map((item) => `${item.case}/${item.capture} ${item.observation}`).join(", ")}`);
  }
  if (path !== null) lines.push(`Diagnosis: ${Object.keys(clusters).length} clusters; ${path}`);
  return lines;
}
