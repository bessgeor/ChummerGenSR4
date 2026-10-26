import type { ThreadDiscovery } from "../discovery/thread-discovery.js";
import type { ClusterEnd } from "./disposition.js";

export const threadOutcomes = ["verified_for_scope", "findings_remaining", "budget_exhausted"] as const;
export type ThreadOutcome = (typeof threadOutcomes)[number];

/** A planned case whose own capture or compare had execution or analysis failures, so the scope is not verified. */
export type ScopeProblem = { readonly case: string; readonly capture: number | null; readonly compare: number | null };

/** What the thread spent on its clusters. */
export type LoopMeasures = {
  readonly clusters: number;
  readonly fixed: number;
  /** Fixed over clusters; null without clusters. */
  readonly fixRate: number | null;
  readonly attempts: number;
  /** The model time charged to the thread's run budget. */
  readonly modelMilliseconds: number;
  /** From the thread's start to its conclusion; null when the thread does not record its start. */
  readonly elapsedMilliseconds: number | null;
};

/** The thread's `outcome.json`. */
export type OutcomeDocument = {
  readonly threadId: string;
  readonly outcome: ThreadOutcome;
  readonly scope: { readonly cases: readonly string[]; readonly captures: readonly string[] | null };
  readonly problems: { readonly cases: readonly ScopeProblem[]; readonly otherFindings: number };
  readonly clusters: readonly ClusterEnd[];
  readonly accepted: { readonly branch: string; readonly commit: string | null } | null;
  readonly measures: LoopMeasures;
  /** The thread's discovery, or null when it did not discover; it does not change the outcome. */
  readonly discovery: ThreadDiscovery | null;
  readonly concludedUtc: string;
};

/** Verified when every cluster is fixed and the scope had no problem; else out of budget when a cluster stopped for the budget; else findings remain. */
export function threadOutcome(ends: readonly ClusterEnd[], problems: OutcomeDocument["problems"]): ThreadOutcome {
  if (ends.every((end) => end.disposition === "fixed") && problems.cases.length === 0 && problems.otherFindings === 0) return "verified_for_scope";
  return ends.some((end) => end.disposition === "budget_exhausted") ? "budget_exhausted" : "findings_remaining";
}

function minutes(milliseconds: number): string {
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

const attemptCount = (count: number): string => `${count} ${count === 1 ? "attempt" : "attempts"}`;

/** The loop lines of the end-of-run report: each cluster's disposition, then the outcome with its counts. */
export function describeOutcome(document: OutcomeDocument, path: string): string[] {
  const lines = document.clusters.map((end) => {
    const head = `Loop ${end.clusterId}: ${end.disposition} after ${attemptCount(end.attempts)}`;
    if (end.commit !== null) return `${head}; ${end.commit}`;
    return end.stage === null && end.reason === null ? head : `${head}; ${end.stage ?? "-"}: ${end.reason ?? "-"}`;
  });
  for (const problem of document.problems.cases) {
    lines.push(`Loop scope: ${problem.case} capture status ${problem.capture ?? "not run"}, compare status ${problem.compare ?? "not run"}`);
  }
  if (document.problems.otherFindings > 0) lines.push(`Loop scope: ${document.problems.otherFindings} other findings without pixel analysis`);
  const { measures } = document;
  lines.push(`Outcome: ${document.outcome}; ${measures.fixed} of ${measures.clusters} clusters fixed, ${attemptCount(measures.attempts)}, `
    + `model time ${minutes(measures.modelMilliseconds)}, elapsed ${measures.elapsedMilliseconds === null ? "unknown" : minutes(measures.elapsedMilliseconds)}; ${path}`);
  return lines;
}
