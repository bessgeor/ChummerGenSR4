import { join } from "node:path";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { CompareReportSchema, type CompareReport } from "../../../contracts/generated/typescript/parity-compare-report.js";
import { ExecutionCoverageSchema } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import { reportPath } from "./compare-step.js";
import { readDocument } from "./read-document.js";

/** Where a case's canonical sides came from; `mixed` when some were cached and some ran live. */
export type CanonicalSource = "live" | "cache" | "mixed";

/** What a capture run did: did every action run, and where did the canonical side come from. */
export type ExecutionDetails = {
  readonly coverageValid: boolean;
  readonly invalidReasons: readonly string[];
  /** Whether every side's recorded action indexes are contiguous. */
  readonly contiguous: boolean;
  readonly failures: number;
  readonly optionalAbsent: number;
  readonly canonicalSource: CanonicalSource;
};

/** What the capture runner's results say, and the comparer's report when the run was compared. */
export type VisualDetails = {
  readonly passed: number;
  readonly failed: number;
  readonly report: CompareReport | null;
};

export type CaseDetails = { readonly execution: ExecutionDetails; readonly visual: VisualDetails };

/** Reads a case's run folder: its coverage and results and, when `compared`, the comparer's report. */
export function readCaseDetails(runFolder: string, compared: boolean): CaseDetails {
  const coverage = readDocument(join(runFolder, "coverage.json"), ExecutionCoverageSchema);
  const results = readDocument(join(runFolder, "results.json"), CaptureResultsSchema);
  const sides = coverage.cases.flatMap((entry) => entry.sides);
  const canonical = sides.filter((side) => side.side === "canonical");
  const cached = canonical.filter((side) => side.source === "cache").length;
  return {
    execution: {
      coverageValid: coverage.valid,
      invalidReasons: coverage.invalidReasons,
      contiguous: sides.every((side) => side.contiguous),
      failures: coverage.totals.failures,
      optionalAbsent: coverage.totals.optionalAbsent,
      canonicalSource: cached === 0 ? "live" : cached === canonical.length ? "cache" : "mixed",
    },
    visual: {
      passed: results.results.filter((row) => row.passed).length,
      failed: results.results.filter((row) => !row.passed).length,
      report: compared ? readDocument(join(runFolder, reportPath), CompareReportSchema) : null,
    },
  };
}