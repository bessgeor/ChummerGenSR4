import type { CheckExecution } from "../repair/cluster-repair.js";
import type { Finding } from "./attribution.js";
import type { ClusterScope, LevelName } from "./ladder.js";

/** One level of a widening: what it captured, its execution outcome apart from its findings, and its verdict. */
export type LevelResult = {
  readonly level: LevelName;
  readonly cases: readonly string[];
  /** The captures of the level, or null for every capture of its cases. */
  readonly captures: readonly string[] | null;
  /** The level's run, or null when it had no case to capture. */
  readonly run: CheckExecution | null;
  /** The capture of the accepted build for rows without a baseline, or null when none was needed. */
  readonly baseline: CheckExecution | null;
  /** Every row of the level that is not within the threshold, attributed. */
  readonly findings: readonly Finding[];
  readonly outcome: "passed" | "failed" | "nothing-new";
  readonly reason: string | null;
  /** Whether the level failed because its run or its baseline capture had execution failures. */
  readonly executionFailure: boolean;
};

/** Where a rejected widening stopped. */
export type WideningStage = "apply" | "build" | LevelName;

export type WideningStatus =
  /** The widened candidate is not built yet. */
  | "pending"
  /** Built; the next level is due. */
  | "widening"
  /** Every level passed; the promotion is due. */
  | "verified"
  /** The patch did not apply, the build failed or a level failed; the rollback is due. */
  | "failed"
  | "promoted"
  | "rejected";

/** Where one passed repair attempt's widening stands; checkpointed with the thread. */
export type ClusterWidening = {
  readonly clusterId: string;
  readonly attempt: number;
  readonly recordId: string;
  /** The attempt's repair archive. */
  readonly archive: string;
  /** `widening/<cluster>/` in the thread's folder: the widened source and build, and `widening.json`. */
  readonly folder: string;
  readonly scope: ClusterScope;
  /** The cluster's members as `case/capture`. */
  readonly targets: readonly string[];
  readonly status: WideningStatus;
  readonly build: { readonly status: number; readonly durationMs: number } | null;
  readonly levels: readonly LevelResult[];
  readonly rejection: { readonly stage: WideningStage; readonly reason: string; readonly executionFailure: boolean } | null;
  readonly commit: string | null;
};

/** The source accepted so far in the thread, which the next widening starts from. */
export type AcceptedState = {
  /** The accepted branch's name, `accepted/<thread>`. */
  readonly branch: string;
  /** The commit the thread's snapshot was taken on. */
  readonly base: string;
  /** The branch's commit, or null until the first promotion. */
  readonly commit: string | null;
  /** The folder whose `Chummer/` is the accepted source. */
  readonly source: string;
  /** The folder whose `bin/` holds the accepted build, or null until one is needed. */
  readonly build: string | null;
  /** Capture runs of the accepted source, oldest first: the baseline of attribution. */
  readonly baselineRuns: readonly string[];
  readonly promoted: readonly string[];
};

export type WideningUpdate = { readonly clusterId: string } & Partial<Omit<ClusterWidening, "clusterId">>;

const final: readonly WideningStatus[] = ["promoted", "rejected"];

/** Merges widening updates by cluster; each update replaces the fields it names. */
export function mergeWidenings(current: Readonly<Record<string, ClusterWidening>>, update: Readonly<Record<string, WideningUpdate>>): Record<string, ClusterWidening> {
  const merged: Record<string, ClusterWidening> = { ...current };
  for (const [id, change] of Object.entries(update)) {
    const existing = merged[id];
    if (existing === undefined && (change.status === undefined || change.archive === undefined)) throw new Error(`A partial update for widening ${id}, which the thread does not have.`);
    merged[id] = { ...(existing ?? {}), ...change } as ClusterWidening;
  }
  return merged;
}

export type WideningRoute =
  | { readonly kind: "widen" | "promote" | "roll_back"; readonly clusterId: string }
  | { readonly kind: "end" };

/** One widening at a time, in cluster ID order: the first that is not final decides the next step. */
export function nextWideningRoute(widenings: Readonly<Record<string, ClusterWidening>>): WideningRoute {
  const current = Object.values(widenings).filter((item) => !final.includes(item.status))
    .sort((left, right) => (left.clusterId < right.clusterId ? -1 : left.clusterId > right.clusterId ? 1 : 0))[0];
  if (current === undefined) return { kind: "end" };
  switch (current.status) {
    case "verified": return { kind: "promote", clusterId: current.clusterId };
    case "failed": return { kind: "roll_back", clusterId: current.clusterId };
    default: return { kind: "widen", clusterId: current.clusterId };
  }
}
