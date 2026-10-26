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
import { clusterEnd } from "./disposition.js";
import { threadOutcome, type OutcomeDocument, type ScopeProblem } from "./outcome.js";
import { retryLimits, retryPlan } from "./retry.js";

export type LoopDependencies = {
  readonly threadFolder: (threadId: string) => string;
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
  readonly agentMilliseconds: number;
  /** When the thread started, or null for a thread stored before it was recorded. */
  readonly startedUtc: string | null;
  /** The thread's discovery, or null when it did not discover. */
  readonly discovery: ThreadDiscovery | null;
};

/** The thread's outcome and the path of its `outcome.json`. */
export type Conclusion = { readonly document: OutcomeDocument; readonly path: string };

/** Ends a thread: every triage cluster's disposition, the outcome and the measures, written to `outcome.json`. */
export class LoopService {
  constructor(private readonly dependencies: LoopDependencies) {}

  conclude(input: ConcludeInput): Conclusion {
    const triage = readDocument(input.triagePath, TriageDocumentSchema);
    const { budget } = retryPlan(input.repairs, input.widenings, retryLimits(input.options, input.agentMilliseconds));
    const ends = triage.clusters.map((cluster) => cluster.id).sort()
      .map((id) => clusterEnd(id, { clusters: input.clusters, check: input.check, repairs: input.repairs, widenings: input.widenings, budgetBlocked: budget }));
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
