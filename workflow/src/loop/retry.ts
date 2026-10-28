import type { RunOptions } from "../options/run-options.js";
import { attemptLostExecution, finishedAttempts, type ClusterRepair, type EarlierAttempt, type RepairUpdate } from "../repair/cluster-repair.js";
import type { ClusterWidening, WideningStage } from "../widening/cluster-widening.js";

/** The latest rejection of a cluster's attempt, as an earlier attempt would record it, and whether it was an execution failure. */
export type Rejection = EarlierAttempt & { readonly executionFailure: boolean };

/** Widening stages after which a next attempt would meet the same accepted source and snapshot, so it cannot end differently. */
const final: readonly WideningStage[] = ["apply", "promote"];

/** How a thread's attempts may repeat: the attempts a cluster may get and whether the run budget is spent. */
export type RetryLimits = { readonly maxAttempts: number; readonly budgetSpent: boolean };

export function retryLimits(options: RunOptions, agentMilliseconds: number): RetryLimits {
  return {
    maxAttempts: options.repair?.maxAttempts ?? 1,
    budgetSpent: agentMilliseconds >= options.agents.runBudgetMinutes * 60_000,
  };
}

/** The rejection of a cluster's latest attempt by repair or by its widening; null when it was not rejected or is still running. */
export function latestRejection(repair: ClusterRepair, widening: ClusterWidening | undefined): Rejection | null {
  const attempt = repair.attempt;
  if (attempt === null) return null;
  const common = { attempt: attempt.attempt, recordId: attempt.recordId, archive: attempt.folder, ...(attempt.tries === undefined ? {} : { tries: attempt.tries }) };
  if (repair.status === "rejected") {
    if (attempt.stage === null || attempt.reason === null) throw new Error(`Cluster ${repair.clusterId}'s attempt ${attempt.attempt} is rejected without a stage and a reason.`);
    return {
      ...common, rejectedBy: "repair", stage: attempt.stage, reason: attempt.reason,
      executionFailure: attemptLostExecution(attempt),
    };
  }
  if (repair.status !== "passed" || widening === undefined || widening.attempt !== attempt.attempt || widening.status !== "rejected" || widening.rejection === null) return null;
  return { ...common, rejectedBy: "widening", stage: widening.rejection.stage, reason: widening.rejection.reason, executionFailure: widening.rejection.executionFailure || attemptLostExecution(attempt) };
}

/** Whether a rejection allows a next attempt at all: not an execution failure, and not a widening stage a next attempt would meet again. */
function repeatable(rejection: Rejection): boolean {
  return !rejection.executionFailure && !(rejection.rejectedBy === "widening" && final.includes(rejection.stage as WideningStage));
}

/** The clusters that get a next attempt now, and those that would but for the spent run budget; both in cluster ID order. */
export type RetryPlan = { readonly retry: readonly string[]; readonly budget: readonly string[] };

/** The state updates that start the next attempts: each cluster pending again with its latest attempt among the earlier ones, its rejected widening set aside. */
export type NextAttempts = {
  readonly repairs: Record<string, RepairUpdate>;
  readonly widenings: Record<string, null>;
  readonly earlierWidenings: ClusterWidening[];
};

export function nextAttempts(clusterIds: readonly string[], repairs: Readonly<Record<string, ClusterRepair>>, widenings: Readonly<Record<string, ClusterWidening>>): NextAttempts {
  const result: NextAttempts = { repairs: {}, widenings: {}, earlierWidenings: [] };
  for (const id of clusterIds) {
    const repair = repairs[id];
    const rejection = repair === undefined ? null : latestRejection(repair, widenings[id]);
    if (repair === undefined || rejection === null) throw new Error(`Cluster ${id} has no rejected attempt to follow.`);
    const { executionFailure: _executionFailure, ...earlier } = rejection;
    result.repairs[id] = { clusterId: id, status: "pending", attempt: null, earlier: [...(repair.earlier ?? []), earlier] };
    const widening = widenings[id];
    if (widening !== undefined) {
      result.widenings[id] = null;
      result.earlierWidenings.push(widening);
    }
  }
  return result;
}

export function retryPlan(repairs: Readonly<Record<string, ClusterRepair>>, widenings: Readonly<Record<string, ClusterWidening>>, limits: RetryLimits): RetryPlan {
  const retry: string[] = [];
  const budget: string[] = [];
  for (const repair of Object.values(repairs).sort((left, right) => (left.clusterId < right.clusterId ? -1 : left.clusterId > right.clusterId ? 1 : 0))) {
    const rejection = latestRejection(repair, widenings[repair.clusterId]);
    if (rejection === null || !repeatable(rejection) || finishedAttempts(repair) >= limits.maxAttempts) continue;
    (limits.budgetSpent ? budget : retry).push(repair.clusterId);
  }
  return { retry, budget };
}
