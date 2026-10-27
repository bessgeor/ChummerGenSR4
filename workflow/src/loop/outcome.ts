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

/** A promoted fix and what its merge into the branch the thread started on made. */
export type MergedFix = {
  readonly clusterId: string;
  /** The fix's commit on the accepted branch. */
  readonly commit: string;
  /** `workflow/<thread>/fix/<cluster>`: the fix rebased onto the branch. */
  readonly fixBranch: string;
  /** `merged`, `conflict` (its rebase conflicts) or `blocked` (an earlier fix did not merge). */
  readonly status: "merged" | "conflict" | "blocked";
  /** The merge commit, or null when nothing was merged (or the branch had the change already). */
  readonly mergeCommit: string | null;
  readonly reason: string | null;
  /** The files a conflicting rebase could not merge. */
  readonly files: readonly string[];
};

/** The merges of the promoted fixes into the branch the thread started on. */
export type MergeDocument = {
  /** The branch the thread started on; null for a thread stored before it was recorded, which does not merge. */
  readonly branch: string | null;
  /** The branch's commit before the merges and after them. */
  readonly before: string | null;
  readonly after: string | null;
  /** `workflow/<thread>/integration`, where the merged tip was kept; null when nothing was merged. */
  readonly integrationBranch: string | null;
  /** Every promoted fix, in the order of the promotions. */
  readonly fixes: readonly MergedFix[];
  /** Why nothing was merged although fixes were promoted, or null. */
  readonly skipped: string | null;
};

/** The thread's `outcome.json`. */
export type OutcomeDocument = {
  readonly threadId: string;
  readonly outcome: ThreadOutcome;
  readonly scope: { readonly cases: readonly string[]; readonly captures: readonly string[] | null };
  readonly problems: { readonly cases: readonly ScopeProblem[]; readonly otherFindings: number };
  readonly clusters: readonly ClusterEnd[];
  readonly accepted: { readonly branch: string; readonly commit: string | null } | null;
  /** The merges of the promoted fixes; null when nothing was promoted. */
  readonly merge: MergeDocument | null;
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

function describeMerge(merge: MergeDocument): string {
  if (merge.branch === null) return `Merge: none; ${merge.skipped ?? "nothing was merged"}`;
  const merged = merge.fixes.filter((fix) => fix.status === "merged").length;
  return `Merge: ${merge.branch} ${merge.before ?? "-"} -> ${merge.after ?? "-"}; ${merged} of ${merge.fixes.length} fixes merged`
    + (merge.integrationBranch === null ? "" : `, kept on ${merge.integrationBranch}`);
}

/** The loop lines of the end-of-run report: each cluster's disposition, the merge when fixes were promoted, then the outcome with its counts. */
export function describeOutcome(document: OutcomeDocument, path: string): string[] {
  const lines = document.clusters.map((end) => {
    const head = `Loop ${end.clusterId}: ${end.disposition} after ${attemptCount(end.attempts)}`;
    const parts = [
      ...(end.stage === null && end.reason === null ? [] : [`${end.stage ?? "-"}: ${end.reason ?? "-"}`]),
      ...(end.commit === null ? [] : [end.mergeCommit === null ? end.commit : `${end.commit} merged as ${end.mergeCommit}`]),
    ];
    return parts.length === 0 ? head : `${head}; ${parts.join("; ")}`;
  });
  for (const problem of document.problems.cases) {
    lines.push(`Loop scope: ${problem.case} capture status ${problem.capture ?? "not run"}, compare status ${problem.compare ?? "not run"}`);
  }
  if (document.problems.otherFindings > 0) lines.push(`Loop scope: ${document.problems.otherFindings} other findings without pixel analysis`);
  if (document.merge !== null) lines.push(describeMerge(document.merge));
  const { measures } = document;
  lines.push(`Outcome: ${document.outcome}; ${measures.fixed} of ${measures.clusters} clusters fixed, ${attemptCount(measures.attempts)}, `
    + `model time ${minutes(measures.modelMilliseconds)}, elapsed ${measures.elapsedMilliseconds === null ? "unknown" : minutes(measures.elapsedMilliseconds)}; ${path}`);
  return lines;
}
