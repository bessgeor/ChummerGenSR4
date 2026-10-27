import type { CheckResult } from "../diagnosis/check.js";
import { clusterFailure, clusterStatus, variantsOf, type ClusterDiagnosis } from "../diagnosis/cluster-diagnosis.js";
import { finishedAttempts, type ClusterRepair } from "../repair/cluster-repair.js";
import type { ClusterWidening } from "../widening/cluster-widening.js";
import { latestRejection } from "./retry.js";

export const dispositions = [
  "fixed", "merge_failed", "budget_exhausted", "not_diagnosed", "diagnosis_failed", "abstained", "refuted", "undecided",
  "not_repaired", "repair_failed", "repair_rejected", "not_widened", "widening_rejected",
] as const;
export type Disposition = (typeof dispositions)[number];

/** Where a cluster's route ended. */
export type ClusterEnd = {
  readonly clusterId: string;
  readonly disposition: Disposition;
  /** Finished repair attempts. */
  readonly attempts: number;
  /** The stage of the latest rejection or failure, or null. */
  readonly stage: string | null;
  readonly reason: string | null;
  /** The accepted branch's commit of a fix. */
  readonly commit: string | null;
  /** The merge commit of a fix on the branch the thread started on; null when it was not merged by one. */
  readonly mergeCommit: string | null;
};

/** How a promoted fix fared when it was merged into the branch the thread started on. */
export type ClusterMerge = { readonly merged: boolean; readonly mergeCommit: string | null; readonly reason: string | null };

/** What the dispositions are decided from: the thread's stage results. */
export type DispositionInput = {
  readonly clusters: Readonly<Record<string, ClusterDiagnosis>>;
  readonly check: CheckResult | null;
  readonly repairs: Readonly<Record<string, ClusterRepair>>;
  readonly widenings: Readonly<Record<string, ClusterWidening>>;
  /** Clusters that would have had a next attempt but for the spent run budget. */
  readonly budgetBlocked: readonly string[];
  /** The merge of each promoted fix, by cluster; null for a thread stored before its start branch was recorded, which does not merge. */
  readonly merges: Readonly<Record<string, ClusterMerge>> | null;
};

/** A cluster's disposition from its diagnosis, check, repair and widening, in the order of the stages. */
export function clusterEnd(clusterId: string, input: DispositionInput): ClusterEnd {
  const diagnosis = input.clusters[clusterId];
  const repair = input.repairs[clusterId];
  const widening = input.widenings[clusterId];
  const attempts = repair === undefined ? 0 : finishedAttempts(repair);
  const end = (disposition: Disposition, stage: string | null = null, reason: string | null = null, commit: string | null = null, mergeCommit: string | null = null): ClusterEnd =>
    ({ clusterId, disposition, attempts, stage, reason, commit, mergeCommit });
  const rejection = repair === undefined ? null : latestRejection(repair, widening);
  if (widening?.status === "promoted") {
    if (input.merges === null) return end("fixed", null, null, widening.commit);
    const merge = input.merges[clusterId];
    if (merge === undefined) throw new Error(`Cluster ${clusterId}'s fix was promoted but not merged when the thread concludes.`);
    return merge.merged ? end("fixed", null, null, widening.commit, merge.mergeCommit) : end("merge_failed", "merge", merge.reason, widening.commit);
  }
  // A next attempt that could not start leaves no latest attempt: the rejection it followed is the last of the earlier ones.
  const followed = rejection ?? (repair?.earlier ?? []).at(-1) ?? null;
  // An attempt the budget stopped after some of its jobs finished is archived with its own reason.
  const stopped = repair?.status === "budget_exhausted" ? repair.attempt : null;
  const previous = (repair?.earlier ?? []).at(-1) ?? null;
  const budgetEnd = (): ClusterEnd => stopped !== null
    ? end("budget_exhausted", stopped.stage, previous === null ? stopped.reason : `${stopped.reason}; the attempt it followed was rejected by ${previous.rejectedBy} at ${previous.stage}: ${previous.reason}`)
    : followed === null
    ? end("budget_exhausted", null, "the run budget was spent before a model job could start")
    : end("budget_exhausted", followed.stage, `the run budget was spent before a next attempt; ${followed.reason}`);
  const diagnosed = diagnosis === undefined ? null : clusterStatus(diagnosis);
  if (diagnosed === "budget_exhausted" || repair?.status === "budget_exhausted" || input.budgetBlocked.includes(clusterId)) return budgetEnd();
  if (diagnosis === undefined) return end("not_diagnosed");
  const failure = clusterFailure(diagnosis);
  if (diagnosed === "failed") return end("diagnosis_failed", failure?.job ?? null, failure === null ? null : `${failure.kind}: ${failure.message}`);
  if (diagnosed === "abstained") return end("abstained", "hypothesis", diagnosis.hypothesis?.output.reason ?? null);
  if (diagnosed !== "challenged") throw new Error(`Cluster ${clusterId}'s diagnosis is ${diagnosed} when the thread concludes.`);
  const checked = input.check?.clusters[clusterId]?.outcome ?? "undecided";
  // A hypothesis the budget stopped might have been confirmed: without a confirmed one, the budget ended the cluster.
  if (checked !== "confirmed" && variantsOf(diagnosis).some((variant) => variant.status === "budget_exhausted")) return budgetEnd();
  if (checked !== "confirmed") return end(checked, "check");
  if (repair === undefined) return end("not_repaired");
  const attempt = repair.attempt;
  if (repair.status === "failed") return end("repair_failed", attempt?.stage ?? "model", attempt?.reason ?? null);
  if (repair.status === "rejected") return end("repair_rejected", rejection?.stage ?? null, rejection?.reason ?? null);
  if (repair.status !== "passed") throw new Error(`Cluster ${clusterId}'s repair is ${repair.status} when the thread concludes.`);
  if (widening === undefined) return end("not_widened");
  if (widening.status === "rejected") return end("widening_rejected", widening.rejection?.stage ?? null, widening.rejection?.reason ?? null);
  throw new Error(`Cluster ${clusterId}'s widening is ${widening.status} when the thread concludes.`);
}
