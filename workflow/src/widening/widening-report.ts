import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckExecution } from "../repair/cluster-repair.js";
import { attributions } from "./attribution.js";
import type { AcceptedState, ClusterWidening, LevelResult, WideningStatus } from "./cluster-widening.js";

/** The thread's `widening.json`: every current widening, the earlier ones of clusters that got a next attempt, the accepted branch and totals over both. */
export type WideningDocument = {
  readonly threadId: string;
  readonly widenings: readonly ClusterWidening[];
  readonly earlier: readonly ClusterWidening[];
  readonly accepted: AcceptedState | null;
  readonly totals: Readonly<Record<WideningStatus | "clusters" | "attempts", number>>;
};

export function wideningDocument(threadId: string, widenings: Readonly<Record<string, ClusterWidening>>, accepted: AcceptedState | null, earlier: readonly ClusterWidening[]): WideningDocument {
  const current = Object.values(widenings);
  const all = [...earlier, ...current];
  const count = (status: WideningStatus) => all.filter((item) => item.status === status).length;
  return {
    threadId, widenings: current, earlier, accepted,
    totals: {
      clusters: new Set(all.map((item) => item.clusterId)).size, attempts: all.length, pending: count("pending"), widening: count("widening"),
      verified: count("verified"), failed: count("failed"), promoted: count("promoted"), rejected: count("rejected"),
    },
  };
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function lost(execution: CheckExecution | null): boolean {
  return execution !== null && (execution.status === 2 || !execution.coverageValid);
}

/** 2 when a level run or a baseline capture of a current or earlier widening had execution failures, else 0. */
export function wideningStatus(widenings: readonly ClusterWidening[]): 0 | 2 {
  return widenings.some((item) => item.levels.some((level) => lost(level.run) || lost(level.baseline))) ? 2 : 0;
}

function execution(name: string, run: CheckExecution): string {
  return `${name} status ${run.status}, coverage ${run.coverageValid ? "valid" : `INVALID: ${run.invalidReasons.join("; ")}`}, ${run.failures} failures; run folder ${run.runFolder}`;
}

function levelLines(head: string, level: LevelResult): string[] {
  if (level.run === null) return [`${head} ${level.level}: nothing new to capture`];
  const lines = [`${head} ${level.level} execution: ${execution("capture", level.run)}`];
  if (level.baseline !== null) lines.push(`${head} ${level.level} baseline execution: ${execution("capture", level.baseline)}`);
  const counts = attributions.map((name) => `${name} ${level.findings.filter((finding) => finding.attribution === name).length}`).join(", ");
  lines.push(`${head} ${level.level} visual: ${level.run.passed} passed, ${level.run.failed} failed (${counts}); ${level.outcome.toUpperCase()}`);
  return lines;
}

/** The widening lines of the end-of-run report: per widening its outcome, then each level's execution apart from its visual result. */
export function describeWidening(widenings: readonly ClusterWidening[], accepted: AcceptedState | null, path: string | null): string[] {
  const lines: string[] = [];
  for (const item of widenings) {
    const head = `Widening ${item.clusterId}`;
    if (item.status === "promoted") lines.push(`${head}: attempt ${item.attempt} PROMOTED as ${item.commit} on ${accepted?.branch ?? "the accepted branch"}`);
    else if (item.rejection !== null) lines.push(`${head}: attempt ${item.attempt} ${item.status === "rejected" ? "rejected" : "failing"} at ${item.rejection.stage}: ${item.rejection.reason}`);
    else lines.push(`${head}: attempt ${item.attempt} ${item.status}`);
    for (const level of item.levels) lines.push(...levelLines(head, level));
  }
  if (path !== null) {
    const all = widenings;
    const branch = accepted === null ? "no accepted branch" : `${accepted.branch} at ${accepted.commit ?? "no commit (nothing promoted)"}`;
    lines.push(`Widening: ${all.length} attempts, ${all.filter((item) => item.status === "promoted").length} promoted, `
      + `${all.filter((item) => item.status === "rejected").length} rejected; ${branch}; ${path}`);
  }
  return lines;
}
