import type { AgentFailureKind, Effort, JobKind, Provider } from "../agents/agent-job.js";
import type { ChallengeOutput, HypothesisOutput } from "./job-schemas.js";

/** A finished job's answer, with the record that holds everything about it. */
export type JobAnswer<T> = {
  readonly recordId: string;
  readonly provider: Provider;
  readonly model: string | null;
  readonly effort: Effort;
  readonly output: T;
};

/** A job that hit a usage limit and waits for `wait_for_quota`. */
export type QuotaWaitMark = {
  readonly job: JobKind;
  readonly provider: Provider;
  readonly since: string;
  /** The process that recorded the wait; another process retries at once. */
  readonly processId: string;
  readonly message: string;
};

export type ClusterStatus =
  /** No hypothesis yet. */
  | "pending"
  /** A hypothesis, not yet challenged. */
  | "hypothesized"
  | "abstained"
  /** Hypothesis and challenge done; ready for the check. */
  | "challenged"
  /** A job failed with invalid_output or refused. */
  | "failed"
  /** The run budget was spent before a job could start. */
  | "budget_exhausted";

export type DiagnosisFailure = { readonly job: JobKind; readonly kind: Exclude<AgentFailureKind, "quota_exhausted" | "infra" | "timeout">; readonly message: string };

/** One hypothesis of a cluster with its challenge: how far its jobs got. */
export type HypothesisVariant = {
  /** 1 for the first hypothesis, then 2 and 3. */
  readonly variant: number;
  readonly status: ClusterStatus;
  readonly hypothesis: JobAnswer<HypothesisOutput> | null;
  readonly challenge: JobAnswer<ChallengeOutput> | null;
  readonly failure: DiagnosisFailure | null;
  /** The records of this hypothesis's own jobs, its failed and quota attempts included. */
  readonly records: readonly string[];
};

/**
 * Where one cluster's diagnosis stands; checkpointed with the thread. `status`, `hypothesis`, `challenge` and
 * `failure` are the first hypothesis's; `clusterStatus` gives the cluster's.
 */
export type ClusterDiagnosis = {
  readonly clusterId: string;
  readonly contextFolder: string;
  readonly contextHash: string;
  readonly status: ClusterStatus;
  readonly hypothesis: JobAnswer<HypothesisOutput> | null;
  readonly challenge: JobAnswer<ChallengeOutput> | null;
  /** The hypotheses after the first, in order; absent in a thread stored with one hypothesis per cluster. */
  readonly variants?: readonly HypothesisVariant[];
  /** The records of the first hypothesis's own jobs; absent in a thread stored with one hypothesis per cluster, where every record is its. */
  readonly firstRecords?: readonly string[];
  readonly waiting: QuotaWaitMark | null;
  readonly failure: DiagnosisFailure | null;
  /**
   * The eval records of every job of the cluster, in order, failed and quota attempts included, and the records of
   * interrupted jobs that only the store knew.
   */
  readonly records: readonly string[];
};

/** Every hypothesis of a cluster, the first included, in order. */
export function variantsOf(cluster: ClusterDiagnosis): HypothesisVariant[] {
  return [
    {
      variant: 1, status: cluster.status, hypothesis: cluster.hypothesis, challenge: cluster.challenge, failure: cluster.failure,
      records: cluster.firstRecords ?? cluster.records,
    },
    ...(cluster.variants ?? []),
  ];
}

/** One hypothesis of a cluster; a number the cluster does not have is a bug. */
export function variantOf(cluster: ClusterDiagnosis, variant: number): HypothesisVariant {
  const found = variantsOf(cluster).find((item) => item.variant === variant);
  if (found === undefined) throw new Error(`Cluster ${cluster.clusterId} has no hypothesis ${variant}.`);
  return found;
}

/** The hypotheses a new cluster starts with: the first in the cluster's own fields, the others as pending variants. */
export function pendingVariants(hypotheses: number): HypothesisVariant[] {
  return Array.from({ length: hypotheses - 1 }, (_, index) => ({
    variant: index + 2, status: "pending", hypothesis: null, challenge: null, failure: null, records: [],
  }));
}

/** The cluster update that sets fields of one hypothesis: the cluster's own fields for the first, its variant for the others. */
export function variantUpdate(
  cluster: ClusterDiagnosis, variant: number, change: Partial<Pick<HypothesisVariant, "status" | "hypothesis" | "challenge" | "failure" | "records">>,
): ClusterUpdate {
  if (variant === 1) {
    const { records, ...fields } = change;
    // A cluster with one hypothesis lists no first-hypothesis records of its own: all its records are the first's.
    return { clusterId: cluster.clusterId, ...fields, ...(records === undefined || cluster.firstRecords === undefined ? {} : { firstRecords: records }) };
  }
  return { clusterId: cluster.clusterId, variants: [{ ...variantOf(cluster, variant), ...change }] };
}

/**
 * The cluster's status from its hypotheses': `failed` when any failed, else the earliest unfinished step, else
 * `challenged` when any was challenged, `abstained` when every one abstained, and `budget_exhausted` otherwise.
 */
export function clusterStatus(cluster: ClusterDiagnosis): ClusterStatus {
  const statuses = variantsOf(cluster).map((variant) => variant.status);
  for (const status of ["failed", "pending", "hypothesized", "challenged"] as const) {
    if (statuses.includes(status)) return status;
  }
  return statuses.every((status) => status === "abstained") ? "abstained" : "budget_exhausted";
}

/** The first failure among the cluster's hypotheses, or null. */
export function clusterFailure(cluster: ClusterDiagnosis): DiagnosisFailure | null {
  return variantsOf(cluster).find((variant) => variant.status === "failed")?.failure ?? null;
}

/** A node's change to one cluster: the fields it sets; its `variants` are the hypotheses after the first that it changed. */
export type ClusterUpdate = { readonly clusterId: string } & Partial<Omit<ClusterDiagnosis, "clusterId">>;

/**
 * Merges cluster updates by cluster. A whole cluster replaces the one it names; a partial update replaces the fields
 * it names, except that its `variants` replace only the hypotheses of the same number and its `records` add those the
 * cluster does not list yet, so the jobs of two hypotheses of one cluster can finish in the same step.
 */
export function mergeClusters(current: Readonly<Record<string, ClusterDiagnosis>>, update: Readonly<Record<string, ClusterUpdate>>): Record<string, ClusterDiagnosis> {
  const merged: Record<string, ClusterDiagnosis> = { ...current };
  for (const [id, change] of Object.entries(update)) {
    const existing = merged[id];
    if (isComplete(change)) {
      merged[id] = change;
      continue;
    }
    if (existing === undefined) throw new Error(`A partial update for cluster ${id}, which the diagnosis does not have.`);
    merged[id] = {
      ...existing, ...change,
      ...(change.records === undefined ? {} : { records: [...existing.records, ...change.records.filter((record) => !existing.records.includes(record))] }),
      ...(change.variants === undefined ? {} : { variants: mergeVariants(existing.variants ?? [], change.variants) }),
    };
  }
  return merged;
}

function mergeVariants(current: readonly HypothesisVariant[], changed: readonly HypothesisVariant[]): HypothesisVariant[] {
  const merged = current.map((variant) => changed.find((item) => item.variant === variant.variant) ?? variant);
  for (const variant of changed) {
    if (!merged.some((item) => item.variant === variant.variant)) merged.push(variant);
  }
  return merged.sort((a, b) => a.variant - b.variant);
}

function isComplete(change: ClusterUpdate): change is ClusterDiagnosis {
  return change.contextFolder !== undefined && change.contextHash !== undefined && change.status !== undefined && change.records !== undefined;
}

/** One job the router sends: for one hypothesis of a cluster. */
export type VariantJob = { readonly clusterId: string; readonly variant: number };

/** What the router does next with the clusters. */
export type DiagnosisRoute =
  | { readonly kind: "wait_for_quota" }
  | { readonly kind: "hypothesize"; readonly jobs: readonly VariantJob[] }
  | { readonly kind: "challenge"; readonly jobs: readonly VariantJob[] }
  | { readonly kind: "check" }
  | { readonly kind: "end" };

/**
 * Waits first, then the hypotheses of every cluster, then their challenges, then the check once, then the end. A
 * cluster with a failed hypothesis gets no further job.
 */
export function nextDiagnosisRoute(clusters: Readonly<Record<string, ClusterDiagnosis>>, checked: boolean): DiagnosisRoute {
  const all = Object.values(clusters);
  if (all.some((cluster) => cluster.waiting !== null)) return { kind: "wait_for_quota" };
  const jobs = (status: ClusterStatus): VariantJob[] => all.filter((cluster) => clusterStatus(cluster) !== "failed")
    .flatMap((cluster) => variantsOf(cluster).filter((variant) => variant.status === status).map((variant) => ({ clusterId: cluster.clusterId, variant: variant.variant })));
  const pending = jobs("pending");
  if (pending.length > 0) return { kind: "hypothesize", jobs: pending };
  const hypothesized = jobs("hypothesized");
  if (hypothesized.length > 0) return { kind: "challenge", jobs: hypothesized };
  if (!checked && all.some((cluster) => clusterStatus(cluster) === "challenged")) return { kind: "check" };
  return { kind: "end" };
}
