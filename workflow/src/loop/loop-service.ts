import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PlannedCase } from "../cases/case-plan.js";
import type { CheckResult } from "../diagnosis/check.js";
import type { ClusterDiagnosis } from "../diagnosis/cluster-diagnosis.js";
import type { ThreadDiscovery } from "../discovery/thread-discovery.js";
import type { RunOptions } from "../options/run-options.js";
import type { ClusterRepair } from "../repair/cluster-repair.js";
import { readDocument } from "../steps/read-document.js";
import type { StepOutcome } from "../steps/step-outcome.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";
import type { AcceptedState, ClusterWidening } from "../widening/cluster-widening.js";
import type { HeadBranch, Integration, IntegrationRequest } from "../git/integration.js";
import { threadBranches } from "../git/thread-source.js";
import { clusterEnd, type ClusterMerge } from "./disposition.js";
import { threadOutcome, type MergeDocument, type MergedFix, type OutcomeDocument, type ScopeProblem } from "./outcome.js";
import { retryLimits, retryPlan } from "./retry.js";

export type LoopDependencies = {
  readonly threadFolder: (threadId: string) => string;
  /** Merges commits into a branch of the repository (see `integrate`). */
  readonly integrate: (request: IntegrationRequest) => Integration;
  readonly now: () => Date;
};

/** The thread's state when it concludes. */
export type ConcludeInput = {
  readonly threadId: string;
  readonly options: RunOptions;
  readonly plan: readonly PlannedCase[];
  readonly captures: Readonly<Record<string, StepOutcome>>;
  readonly compares: Readonly<Record<string, StepOutcome>>;
  readonly triagePath: string;
  readonly otherFindings: number;
  readonly clusters: Readonly<Record<string, ClusterDiagnosis>>;
  readonly check: CheckResult | null;
  readonly repairs: Readonly<Record<string, ClusterRepair>>;
  readonly widenings: Readonly<Record<string, ClusterWidening>>;
  readonly accepted: AcceptedState | null;
  /** The branch the thread started on and its commit, or null for a thread stored before it was recorded. */
  readonly base: HeadBranch | null;
  readonly agentMilliseconds: number;
  /** When the thread started, or null for a thread stored before it was recorded. */
  readonly startedUtc: string | null;
  /** The thread's discovery, or null when it did not discover. */
  readonly discovery: ThreadDiscovery | null;
};

/** The thread's outcome and the path of its `outcome.json`. */
export type Conclusion = { readonly document: OutcomeDocument; readonly path: string };

/**
 * Ends a thread: merges its promoted fixes into the branch it started on, then decides every triage cluster's
 * disposition, the outcome and the measures, written to `outcome.json`.
 */
export class LoopService {
  constructor(private readonly dependencies: LoopDependencies) {}

  /**
   * Merges the promoted fixes, in the order of the promotions, into the branch the thread started on (see `integrate`):
   * each one's commit rebased from its parent as `workflow/<thread>/fix/<cluster>` and merged with a merge commit. A
   * branch that moved meanwhile or a fast-forward git refuses is a setup error; the resumed thread merges again and
   * skips the fixes the branch already has.
   */
  private merge(input: ConcludeInput): { merges: Record<string, ClusterMerge> | null; document: MergeDocument | null } {
    const promoted = (input.accepted?.promoted ?? []).map((clusterId) => {
      const widening = input.widenings[clusterId];
      if (widening?.status !== "promoted" || widening.commit === null) throw new Error(`Cluster ${clusterId} is listed as promoted, but its widening is ${widening?.status ?? "missing"}.`);
      return { clusterId, commit: widening.commit };
    });
    if (promoted.length === 0) return { merges: {}, document: null };
    if (input.base === null) {
      const skipped = `the thread was stored before the branch it started on was recorded, so its fixes stay on ${input.accepted!.branch}`;
      return { merges: null, document: { branch: null, before: null, after: null, integrationBranch: null, fixes: [], skipped } };
    }
    // A thread that widens starts on a branch; one whose HEAD was detached was refused at its start.
    if (input.base.branch === null) throw new Error("Fixes were promoted in a thread that started on a detached HEAD.");
    const threadId = input.threadId;
    const integration = this.dependencies.integrate({
      branch: input.base.branch,
      items: promoted.map(({ clusterId, commit }) => ({
        name: clusterId, commit, branch: threadBranches.fix(threadId, clusterId), subject: `Merge fix for discrepancy ${clusterId}`,
        trailer: { key: "Merged-Fix", value: `${threadId}/${clusterId}` }, trailers: [{ key: "Workflow-Thread", value: threadId }],
      })),
      worktree: join(this.dependencies.threadFolder(threadId), "merge"),
      integrationBranch: threadBranches.integration(threadId),
    });
    const fixes: MergedFix[] = integration.items.map((item, index) => ({
      clusterId: item.name, commit: promoted[index]!.commit, fixBranch: item.branch, status: item.status, mergeCommit: item.mergeCommit, reason: item.reason, files: item.files,
    }));
    const merges = Object.fromEntries(fixes.map((fix) => [fix.clusterId, { merged: fix.status === "merged", mergeCommit: fix.mergeCommit, reason: fix.reason }]));
    return {
      merges,
      document: { branch: integration.branch, before: integration.before, after: integration.after, integrationBranch: integration.integrationBranch, fixes, skipped: null },
    };
  }

  conclude(input: ConcludeInput): Conclusion {
    const triage = readDocument(input.triagePath, TriageDocumentSchema);
    const { budget } = retryPlan(input.repairs, input.widenings, retryLimits(input.options, input.agentMilliseconds));
    const merge = this.merge(input);
    const ends = triage.clusters.map((cluster) => cluster.id).sort()
      .map((id) => clusterEnd(id, { clusters: input.clusters, check: input.check, repairs: input.repairs, widenings: input.widenings, budgetBlocked: budget, merges: merge.merges }));
    const cases: ScopeProblem[] = input.plan.flatMap((item) => {
      const capture = input.captures[item.name]?.status ?? null;
      const compare = input.compares[item.name]?.status ?? null;
      return capture === null || compare === null || capture >= 2 || compare >= 2 ? [{ case: item.name, capture, compare }] : [];
    });
    const problems = { cases, otherFindings: input.otherFindings };
    const now = this.dependencies.now();
    const fixed = ends.filter((end) => end.disposition === "fixed").length;
    const document: OutcomeDocument = {
      threadId: input.threadId,
      outcome: threadOutcome(ends, problems),
      scope: { cases: input.plan.map((item) => item.name), captures: input.options.captures.length === 0 ? null : input.options.captures },
      problems, clusters: ends,
      accepted: input.accepted === null ? null : { branch: input.accepted.branch, commit: input.accepted.commit },
      merge: merge.document,
      measures: {
        clusters: ends.length, fixed, fixRate: ends.length === 0 ? null : fixed / ends.length,
        attempts: ends.reduce((sum, end) => sum + end.attempts, 0),
        modelMilliseconds: input.agentMilliseconds,
        elapsedMilliseconds: input.startedUtc === null ? null : now.getTime() - Date.parse(input.startedUtc),
      },
      discovery: input.discovery,
      concludedUtc: now.toISOString(),
    };
    const path = join(this.dependencies.threadFolder(input.threadId), "outcome.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    return { document, path };
  }
}
