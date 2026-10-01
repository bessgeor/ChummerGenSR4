import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckResult, ClusterCheck } from "./check.js";
import type { ClusterDiagnosis, ClusterStatus } from "./cluster-diagnosis.js";

/** `diagnosis.json`: each cluster's context, jobs, check outcome and records, and the check run apart from them. */
export type DiagnosisDocument = {
  readonly threadId: string;
  readonly clusters: readonly (ClusterDiagnosis & { readonly check: ClusterCheck | null })[];
  readonly check: Omit<CheckResult, "clusters"> | null;
  readonly totals: Readonly<Record<ClusterStatus | "confirmed" | "refuted" | "undecided" | "clusters", number>>;
};

export function diagnosisDocument(threadId: string, clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): DiagnosisDocument {
  const all = Object.values(clusters);
  const outcome = (id: string) => check?.clusters[id] ?? null;
  const count = (predicate: (cluster: ClusterDiagnosis) => boolean) => all.filter(predicate).length;
  const { clusters: _byCluster, ...run } = check ?? { clusters: null };
  return {
    threadId,
    clusters: all.map((cluster) => ({ ...cluster, check: outcome(cluster.clusterId) })),
    check: check === null ? null : (run as Omit<CheckResult, "clusters">),
    totals: {
      clusters: all.length,
      pending: count((cluster) => cluster.status === "pending"),
      hypothesized: count((cluster) => cluster.status === "hypothesized"),
      abstained: count((cluster) => cluster.status === "abstained"),
      challenged: count((cluster) => cluster.status === "challenged"),
      failed: count((cluster) => cluster.status === "failed"),
      budget_exhausted: count((cluster) => cluster.status === "budget_exhausted"),
      confirmed: count((cluster) => outcome(cluster.clusterId)?.outcome === "confirmed"),
      refuted: count((cluster) => outcome(cluster.clusterId)?.outcome === "refuted"),
      undecided: count((cluster) => outcome(cluster.clusterId)?.outcome === "undecided"),
    },
  };
}

export function writeDiagnosisDocument(path: string, document: DiagnosisDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
