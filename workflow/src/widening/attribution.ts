import { join } from "node:path";
import { CaptureResultsSchema, type CaptureResult } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { readDocument } from "../steps/read-document.js";
import { differingShare, readPng } from "./png-pixels.js";

/** Why a capture of a level that is not within the threshold differs, judged against the accepted source. */
export const attributions = ["target", "introduced", "changed", "pre-existing", "unattributed"] as const;
export type Attribution = (typeof attributions)[number];

/** A capture of a level that is not within the threshold, with its attribution. */
export type Finding = {
  readonly case: string;
  readonly capture: string;
  readonly reason: CaptureResult["reason"];
  readonly difference: number;
  readonly attribution: Attribution;
  /** The run whose row was the baseline, or null when there was none. */
  readonly baselineRun: string | null;
  readonly detail: string;
};

export type RunRow = { readonly runFolder: string; readonly row: CaptureResult };

/** The results of a capture run. */
export function readResults(runFolder: string) {
  return readDocument(join(runFolder, "results.json"), CaptureResultsSchema);
}

/** The rows of runs of the accepted source, where the newest run's row for a case and capture is its baseline. */
export class BaselineIndex {
  private readonly rows = new Map<string, RunRow>();

  /** `runs` oldest first. */
  constructor(runs: readonly string[]) {
    for (const runFolder of runs) this.add(runFolder);
  }

  add(runFolder: string): void {
    for (const row of readResults(runFolder).results) this.rows.set(key(row.case, row.capture), { runFolder, row });
  }

  find(caseName: string, capture: string): RunRow | null {
    return this.rows.get(key(caseName, capture)) ?? null;
  }
}

export function key(caseName: string, capture: string): string {
  return `${caseName}/${capture}`;
}

/** Whether two rows' candidate captures have the same pixels within the threshold; two missing captures count as the same. */
function sameCandidate(left: RunRow, right: RunRow, threshold: number): { same: boolean; detail: string } {
  const path = (item: RunRow) => (item.row.candidateCapture === undefined ? null : join(item.runFolder, item.row.candidateCapture));
  const leftPath = path(left);
  const rightPath = path(right);
  if (leftPath === null || rightPath === null) {
    return leftPath === rightPath ? { same: true, detail: "no candidate capture in either run" } : { same: false, detail: "the candidate capture is missing in one run" };
  }
  const share = differingShare(readPng(leftPath), readPng(rightPath));
  return { same: share <= threshold, detail: `candidate pixels differ from the baseline's in a share of ${share}` };
}

/**
 * Attributes a row that is not within the threshold: `target` when it is a capture of the cluster, else against its
 * baseline row; `unattributed` without one. `threshold` is the level run's.
 */
export function attribute(found: RunRow, targets: ReadonlySet<string>, baseline: RunRow | null, threshold: number): Finding {
  const { row } = found;
  const finding = (attribution: Attribution, detail: string): Finding => ({
    case: row.case, capture: row.capture, reason: row.reason, difference: row.difference, attribution, baselineRun: baseline?.runFolder ?? null, detail,
  });
  if (targets.has(key(row.case, row.capture))) return finding("target", "a capture of the cluster is not within the threshold");
  if (baseline === null) return finding("unattributed", "no run of the accepted source has this capture");
  if (baseline.row.passed) return finding("introduced", `the accepted source passed it (${baseline.row.difference})`);
  const compared = sameCandidate(found, baseline, threshold);
  return finding(compared.same ? "pre-existing" : "changed", `the accepted source differed too (${baseline.row.reason}, ${baseline.row.difference}); ${compared.detail}`);
}

/** Only pre-existing differences let a level pass. */
export function blocks(finding: Finding): boolean {
  return finding.attribution !== "pre-existing";
}
