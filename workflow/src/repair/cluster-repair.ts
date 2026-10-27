import type { QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { RepairStage } from "../evals/eval-record.js";

/** The narrow check's execution outcome, apart from its visual result. */
export type CheckExecution = {
  readonly runFolder: string;
  readonly status: 0 | 1 | 2;
  readonly coverageValid: boolean;
  readonly invalidReasons: readonly string[];
  readonly failures: number;
  /** Selected captures that passed and that still differ (or lack a side). */
  readonly passed: number;
  readonly failed: number;
};

/** An archived attempt, as the graph state and the report see it; `attempt.json` in `folder` has everything. */
export type AttemptSummary = {
  readonly attempt: number;
  readonly recordId: string;
  readonly folder: string;
  readonly outcome: "passed" | "rejected";
  readonly stage: RepairStage | null;
  readonly reason: string | null;
  readonly check: CheckExecution | null;
  /** The attempt's branch and commit; absent in a thread stored before attempts had them. */
  readonly branch?: string;
  readonly commit?: string | null;
};

export type RepairStatus =
  /** No attempt has finished. */
  | "pending"
  | "passed"
  | "rejected"
  /** The model job failed with invalid_output or refused; the attempt is archived as rejected at stage model. */
  | "failed"
  /** The run budget was spent before the model job could start, or after some of an attempt's jobs finished (the attempt is then archived as rejected at stage model). */
  | "budget_exhausted";

/** A finished attempt of a cluster that was rejected and followed by a next attempt. */
export type EarlierAttempt = {
  readonly attempt: number;
  readonly recordId: string;
  /** The attempt's repair archive. */
  readonly archive: string;
  /** Whether repair (its guard, build or narrow check) or the widening of its passed patch rejected it. */
  readonly rejectedBy: "repair" | "widening";
  /** A repair stage, or a widening stage when widening rejected it. */
  readonly stage: string;
  readonly reason: string;
};

/** Where one confirmed cluster's repair stands; checkpointed with the thread. */
export type ClusterRepair = {
  readonly clusterId: string;
  readonly status: RepairStatus;
  /** The latest attempt, or null while the next one is pending. */
  readonly attempt: AttemptSummary | null;
  /** The cluster's earlier attempts, oldest first; empty in a thread stored before they were kept. */
  readonly earlier: readonly EarlierAttempt[];
  readonly waiting: QuotaWaitMark | null;
  /** The eval records of every repair job of the cluster, in order, usage-limit and interrupted attempts included. */
  readonly records: readonly string[];
};

export type RepairUpdate = { readonly clusterId: string } & Partial<Omit<ClusterRepair, "clusterId">>;

/** Merges repair updates by cluster; each update replaces the fields it names. */
export function mergeRepairs(current: Readonly<Record<string, ClusterRepair>>, update: Readonly<Record<string, RepairUpdate>>): Record<string, ClusterRepair> {
  const merged: Record<string, ClusterRepair> = { ...current };
  for (const [id, change] of Object.entries(update)) {
    const existing = merged[id];
    if (existing === undefined && (change.status === undefined || change.records === undefined)) {
      throw new Error(`A partial update for repair ${id}, which the thread does not have.`);
    }
    merged[id] = { attempt: null, earlier: [], waiting: null, ...(existing ?? {}), ...change } as ClusterRepair;
  }
  return merged;
}

/** The number of finished attempts of a cluster: the earlier ones and the latest. */
export function finishedAttempts(repair: ClusterRepair): number {
  return (repair.earlier ?? []).length + (repair.attempt === null ? 0 : 1);
}

export type RepairRoute =
  | { readonly kind: "wait_for_repair_quota" }
  | { readonly kind: "repair"; readonly clusters: readonly string[] }
  | { readonly kind: "end" };

/** Waits first, then the pending attempts, then the end. */
export function nextRepairRoute(repairs: Readonly<Record<string, ClusterRepair>>): RepairRoute {
  const all = Object.values(repairs);
  if (all.some((repair) => repair.waiting !== null)) return { kind: "wait_for_repair_quota" };
  const pending = all.filter((repair) => repair.status === "pending").map((repair) => repair.clusterId);
  return pending.length > 0 ? { kind: "repair", clusters: pending } : { kind: "end" };
}
