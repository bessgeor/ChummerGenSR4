import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { attemptLostExecution, type CheckExecution, type ClusterRepair, type RepairStatus } from "./cluster-repair.js";

/** `repair.json`: each repaired cluster's status, attempt and records, with totals. */
export type RepairDocument = {
  readonly threadId: string;
  readonly clusters: readonly ClusterRepair[];
  readonly totals: Readonly<Record<RepairStatus | "clusters", number>>;
};

export function repairDocument(threadId: string, repairs: Readonly<Record<string, ClusterRepair>>): RepairDocument {
  const all = Object.values(repairs);
  const count = (status: RepairStatus) => all.filter((repair) => repair.status === status).length;
  return {
    threadId, clusters: all,
    totals: { clusters: all.length, pending: count("pending"), passed: count("passed"), rejected: count("rejected"), failed: count("failed"), budget_exhausted: count("budget_exhausted") },
  };
}

export function writeRepairDocument(path: string, document: RepairDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

/** 2 when a repair job failed (`invalid_output`, `refused`) or a narrow check had execution failures, else 0. */
export function repairStatus(repairs: Readonly<Record<string, ClusterRepair>>): 0 | 2 {
  const all = Object.values(repairs);
  const failed = all.some((repair) => repair.status === "failed");
  const lost = all.some((repair) => repair.attempt !== null && attemptLostExecution(repair.attempt));
  return failed || lost ? 2 : 0;
}

/** A narrow check's execution line apart from its visual line, or none when no check ran. */
function checkLines(head: string, check: CheckExecution | null): string[] {
  if (check === null) return [];
  return [
    `${head} execution: capture status ${check.status}, coverage ${check.coverageValid ? "valid" : `INVALID: ${check.invalidReasons.join("; ")}`}, ${check.failures} failures; run folder ${check.runFolder}`,
    `${head} visual: ${check.passed} passed, ${check.failed} failed`,
  ];
}

/** The repair lines of the end-of-run report: per cluster its outcome, then its narrow check's execution apart from its visual result. */
export function describeRepair(repairs: Readonly<Record<string, ClusterRepair>>, path: string | null): string[] {
  const lines: string[] = [];
  for (const repair of Object.values(repairs)) {
    const head = `Repair ${repair.clusterId}:`;
    for (const earlier of repair.earlier ?? []) {
      lines.push(`${head} attempt ${earlier.attempt} rejected by ${earlier.rejectedBy} at ${earlier.stage}: ${earlier.reason}; archive ${earlier.archive}`);
    }
    const attempt = repair.attempt;
    if (attempt === null) {
      lines.push(`${head} ${repair.status === "budget_exhausted" ? "budget_exhausted: the run budget was spent before its model job" : repair.status}; ${repair.records.length} records`);
      continue;
    }
    const tries = attempt.tries ?? [];
    const selected = tries.find((item) => item.selected);
    const outcome = attempt.outcome === "passed" ? `PASSED the narrow check${selected === undefined ? "" : ` with try ${selected.try} of ${tries.length}`}`
      : `${repair.status === "failed" ? "FAILED" : repair.status === "budget_exhausted" ? "stopped by the run budget" : "rejected"} at ${attempt.stage}: ${attempt.reason}`;
    lines.push(`${head} attempt ${attempt.attempt} ${outcome}; ${repair.records.length} records; archive ${attempt.folder}`);
    if (tries.length === 0) {
      lines.push(...checkLines(`${head} narrow check`, attempt.check));
      continue;
    }
    // Each try with its own narrow check: the attempt's fields are only those of the try that stands for it.
    for (const item of tries) {
      const size = item.patch === null ? "" : `, ${item.patch.added + item.patch.removed} lines in ${item.patch.files} files`;
      lines.push(`${head} try ${item.try} (hypothesis ${item.hypothesis}) ${item.outcome}${item.stage === null ? "" : ` at ${item.stage}: ${item.reason}`}${size}, `
        + `${item.selected ? "SELECTED" : "not selected"}; branch ${item.branch}; archive ${join(attempt.folder, item.folder)}`);
      lines.push(...checkLines(`${head} try ${item.try} narrow check`, item.check));
    }
  }
  if (path !== null) lines.push(`Repair: ${Object.keys(repairs).length} clusters; ${path}`);
  return lines;
}
