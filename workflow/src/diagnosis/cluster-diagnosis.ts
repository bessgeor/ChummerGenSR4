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

/** Where one cluster's diagnosis stands; checkpointed with the thread. */
export type ClusterDiagnosis = {
  readonly clusterId: string;
  readonly contextFolder: string;
  readonly contextHash: string;
  readonly status: ClusterStatus;
  readonly hypothesis: JobAnswer<HypothesisOutput> | null;
  readonly challenge: JobAnswer<ChallengeOutput> | null;
  readonly waiting: QuotaWaitMark | null;
  readonly failure: { readonly job: JobKind; readonly kind: Exclude<AgentFailureKind, "quota_exhausted" | "infra" | "timeout">; readonly message: string } | null;
  /** The eval records of every job of the cluster, in order, failed and quota attempts included. */
  readonly records: readonly string[];
};

/** A node's change to one cluster: the fields it sets. */
export type ClusterUpdate = { readonly clusterId: string } & Partial<Omit<ClusterDiagnosis, "clusterId">>;

/** Merges cluster updates by cluster; each update replaces the fields it names. */
export function mergeClusters(current: Readonly<Record<string, ClusterDiagnosis>>, update: Readonly<Record<string, ClusterUpdate>>): Record<string, ClusterDiagnosis> {
  const merged: Record<string, ClusterDiagnosis> = { ...current };
  for (const [id, change] of Object.entries(update)) {
    const existing = merged[id];
    if (existing === undefined && !isComplete(change)) throw new Error(`A partial update for cluster ${id}, which the diagnosis does not have.`);
    merged[id] = { ...(existing ?? (change as ClusterDiagnosis)), ...change } as ClusterDiagnosis;
  }
  return merged;
}

function isComplete(change: ClusterUpdate): change is ClusterDiagnosis {
  return change.contextFolder !== undefined && change.contextHash !== undefined && change.status !== undefined && change.records !== undefined;
}

/** What the router does next with the clusters. */
export type DiagnosisRoute =
  | { readonly kind: "wait_for_quota" }
  | { readonly kind: "hypothesize"; readonly clusters: readonly string[] }
  | { readonly kind: "challenge"; readonly clusters: readonly string[] }
  | { readonly kind: "check" }
  | { readonly kind: "end" };

/** Waits first, then hypotheses, then challenges, then the check once, then the end. */
export function nextDiagnosisRoute(clusters: Readonly<Record<string, ClusterDiagnosis>>, checked: boolean): DiagnosisRoute {
  const all = Object.values(clusters);
  if (all.some((cluster) => cluster.waiting !== null)) return { kind: "wait_for_quota" };
  const pending = all.filter((cluster) => cluster.status === "pending").map((cluster) => cluster.clusterId);
  if (pending.length > 0) return { kind: "hypothesize", clusters: pending };
  const hypothesized = all.filter((cluster) => cluster.status === "hypothesized").map((cluster) => cluster.clusterId);
  if (hypothesized.length > 0) return { kind: "challenge", clusters: hypothesized };
  if (!checked && all.some((cluster) => cluster.status === "challenged")) return { kind: "check" };
  return { kind: "end" };
}
