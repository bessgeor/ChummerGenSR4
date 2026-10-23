import { Annotation } from "@langchain/langgraph";
import type { AgentFailureKind } from "../agents/agent-job.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { JobAnswer, QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { RunOptions } from "../options/run-options.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { Ranking, RankOutput, ScenarioOutput } from "./job-schemas.js";
import type { ScenarioProof } from "./proof.js";

/** Everything a discovery thread runs with; stored in its state so a resumed thread uses the same options. */
export type DiscoveryOptions = {
  /** The finished workflow thread whose inventory is the baseline. */
  readonly from: string;
  readonly caseFile: string;
  readonly settingsOverlay: string | null;
  readonly threshold: number | null;
  readonly canonicalCache: string | null;
  readonly canonicalCacheSource: RunOptions["canonicalCacheSource"];
  /** How many targets get a scenario job. */
  readonly targets: number;
  readonly unattended: boolean;
  readonly agents: AgentSettings;
  readonly certificates: string;
};

/** Where one model job stands: its answer, a usage-limit wait, a failure, or a budget that was spent before it could start. */
export type JobState<T> = {
  readonly status: "pending" | "done" | "failed" | "budget_exhausted";
  readonly answer: JobAnswer<T> | null;
  readonly waiting: QuotaWaitMark | null;
  readonly failure: { readonly kind: Exclude<AgentFailureKind, "quota_exhausted" | "infra" | "timeout">; readonly message: string } | null;
  /** Every record of the job, failed and quota attempts included. */
  readonly records: readonly string[];
};

export function pendingJob<T>(): JobState<T> {
  return { status: "pending", answer: null, waiting: null, failure: null, records: [] };
}

/** What `prepare` found and wrote: the baseline, the guards' identities, the targets and the rank context. */
export type Prepared = {
  readonly baselineFolder: string;
  /** The SHA-256 of the baseline's source inventory and coverage manifest, which later nodes must find unchanged. */
  readonly baselineDigest: { readonly inventory: string; readonly manifest: string };
  readonly sourceSha256: string;
  readonly candidateSha256: string;
  readonly candidateSource: string;
  /** The fixture case file's SHA-256: the contexts describe its cases, so it must not change while the thread runs. */
  readonly caseFileSha256: string;
  readonly fingerprints: InputFingerprints;
  readonly targetsPath: string;
  readonly targets: number;
  /** The source snapshot the jobs read; null when there was no target. */
  readonly snapshot: { readonly folder: string; readonly identity: string; readonly commit: string } | null;
  readonly rankContext: { readonly folder: string; readonly hash: string } | null;
  readonly registryEntries: number;
  readonly coverageBefore: Coverage;
};

export type Coverage = { readonly controls: { readonly active: number; readonly observed: number }; readonly interactions: { readonly active: number; readonly exercised: number } };

/** One selected target's scenario: its job, then its validation and the case it ran as. */
export type ScenarioJob = JobState<ScenarioOutput> & {
  readonly targetId: string;
  /** Its place among the selected targets, from 1; its context is `scenario-<index>/`. */
  readonly index: number;
  readonly contextFolder: string;
  readonly contextHash: string;
  readonly ranking: Ranking;
  /** Null until validated; empty for a valid plan. */
  readonly validation: readonly string[] | null;
  /** The generated case name and scenario name of a valid plan. */
  readonly case: string | null;
  readonly scenario: string | null;
};

export type ScenarioUpdate = { readonly targetId: string } & Partial<Omit<ScenarioJob, "targetId">>;

/** Merges scenario updates by target; each update replaces the fields it names. */
export function mergeScenarios(current: Readonly<Record<string, ScenarioJob>>, update: Readonly<Record<string, ScenarioUpdate>>): Record<string, ScenarioJob> {
  const merged: Record<string, ScenarioJob> = { ...current };
  for (const [id, change] of Object.entries(update)) {
    const existing = merged[id];
    if (existing === undefined && (change.contextFolder === undefined || change.status === undefined || change.ranking === undefined)) {
      throw new Error(`A partial update for target ${id}, which has no scenario.`);
    }
    merged[id] = { ...(existing ?? (change as ScenarioJob)), ...change } as ScenarioJob;
  }
  return merged;
}

/** The scenario capture run: its folder, its execution outcome apart from its visual result. */
export type Execution = {
  readonly runFolder: string;
  readonly runId: string;
  readonly status: 0 | 1 | 2;
  readonly coverageValid: boolean;
  readonly invalidReasons: readonly string[];
  readonly failures: number;
  readonly rows: { readonly passed: number; readonly failed: number };
  readonly cases: readonly string[];
};

/** What `register` decided: each executed scenario's proof, the admissions and the scenario run's manifest. */
export type Registered = {
  readonly proofs: Readonly<Record<string, ScenarioProof>>;
  readonly admitted: readonly string[];
  readonly duplicates: readonly string[];
  readonly manifestPath: string | null;
  readonly registryEntries: number;
};

/** The thread's document and exit status, once it concluded. */
export type Concluded = { readonly path: string; readonly exitStatus: number; readonly lines: readonly string[] };

/** The checkpointed state of one discovery thread. */
export const DiscoveryState = Annotation.Root({
  threadId: Annotation<string>(),
  options: Annotation<DiscoveryOptions>(),
  startedUtc: Annotation<string>(),
  prepared: Annotation<Prepared | null>(),
  rankJob: Annotation<JobState<RankOutput>>(),
  /** The selected target IDs in order, once `select` ran. */
  selected: Annotation<string[] | null>(),
  scenarios: Annotation<Record<string, ScenarioJob>, Record<string, ScenarioUpdate>>({ reducer: mergeScenarios, default: () => ({}) }),
  /** Model time of the thread's finished jobs, in milliseconds; quota waits are never added. */
  agentMilliseconds: Annotation<number>({ reducer: (current, update) => current + update, default: () => 0 }),
  execution: Annotation<Execution | null>(),
  registered: Annotation<Registered | null>(),
  concluded: Annotation<Concluded | null>(),
});

export type DiscoveryStateValue = typeof DiscoveryState.State;

/** The payload `Send` gives a scenario job node: the state plus its target. */
export type TargetTask = DiscoveryStateValue & { readonly targetId: string };
