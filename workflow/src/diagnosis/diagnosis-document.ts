import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckResult, ClusterCheck } from "./check.js";
import { clusterFailure, clusterStatus, variantsOf, type ClusterDiagnosis, type ClusterStatus, type HypothesisVariant } from "./cluster-diagnosis.js";

/**
 * A cluster in `diagnosis.json`: its status and failure from its hypotheses', the first hypothesis's answers at the
 * top level as before, every hypothesis with its own status, answers and records, and the check.
 */
export type DiagnosedCluster = Omit<ClusterDiagnosis, "variants" | "firstRecords"> & {
  readonly hypotheses: readonly HypothesisVariant[];
  readonly check: ClusterCheck | null;
};

/** `diagnosis.json`: each cluster's context, jobs, check outcome and records, and the check run apart from them. */
export type DiagnosisDocument = {
  readonly threadId: string;
  readonly clusters: readonly DiagnosedCluster[];
  readonly check: Omit<CheckResult, "clusters"> | null;
  readonly totals: Readonly<Record<ClusterStatus | "confirmed" | "refuted" | "undecided" | "clusters", number>>;
};

export function diagnosisDocument(threadId: string, clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): DiagnosisDocument {
  const all = Object.values(clusters);
  const outcome = (id: string) => check?.clusters[id] ?? null;
  const count = (predicate: (cluster: ClusterDiagnosis) => boolean) => all.filter(predicate).length;
  const counted = (status: ClusterStatus) => count((cluster) => clusterStatus(cluster) === status);
  const { clusters: _byCluster, ...run } = check ?? { clusters: null };
  return {
    threadId,
    clusters: all.map((cluster) => {
      const { variants: _variants, firstRecords: _firstRecords, ...fields } = cluster;
      return { ...fields, status: clusterStatus(cluster), failure: clusterFailure(cluster), hypotheses: variantsOf(cluster), check: outcome(cluster.clusterId) };
    }),
    check: check === null ? null : (run as Omit<CheckResult, "clusters">),
    totals: {
      clusters: all.length,
      pending: counted("pending"),
      hypothesized: counted("hypothesized"),
      abstained: counted("abstained"),
      challenged: counted("challenged"),
      failed: counted("failed"),
      budget_exhausted: counted("budget_exhausted"),
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
