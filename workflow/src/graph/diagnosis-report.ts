import type { CheckResult } from "../diagnosis/check.js";
import type { ClusterDiagnosis, JobAnswer } from "../diagnosis/cluster-diagnosis.js";

/** 2 when a cluster's job failed (`invalid_output`, `refused`) or the check run had execution failures, else 0. */
export function diagnosisStatus(clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): 0 | 2 {
  const failed = Object.values(clusters).some((cluster) => cluster.status === "failed");
  const lost = check !== null && (check.execution.status === 2 || !check.execution.coverageValid);
  return failed || lost ? 2 : 0;
}

function agent(answer: JobAnswer<unknown>): string {
  return `${answer.provider} ${answer.model ?? "default"}/${answer.effort}`;
}

function describeCluster(cluster: ClusterDiagnosis, check: CheckResult | null): string {
  const head = `Diagnosis ${cluster.clusterId}:`;
  const hypothesis = cluster.hypothesis;
  const parts: string[] = [];
  if (hypothesis !== null) {
    parts.push(hypothesis.output.explanation === null
      ? `hypothesis (${agent(hypothesis)}) abstained: ${hypothesis.output.reason}`
      : `hypothesis (${agent(hypothesis)}): ${hypothesis.output.explanation.claim}`);
  }
  const challenge = cluster.challenge;
  if (challenge !== null) {
    parts.push(challenge.output.alternative === null
      ? `challenge (${agent(challenge)}): no alternative: ${challenge.output.reason}`
      : `challenge (${agent(challenge)}): alternative: ${challenge.output.alternative.claim}`);
  }
  if (cluster.status === "failed" && cluster.failure !== null) parts.push(`FAILED: ${cluster.failure.job} ${cluster.failure.kind}: ${cluster.failure.message}`);
  if (cluster.status === "budget_exhausted") parts.push("budget_exhausted: the run budget was spent before its next job");
  const outcome = check?.clusters[cluster.clusterId];
  if (outcome !== undefined) parts.push(`check ${outcome.outcome}`);
  return `${head} ${parts.length === 0 ? cluster.status : parts.join("; ")}; ${cluster.records.length} records`;
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
