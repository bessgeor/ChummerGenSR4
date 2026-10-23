import type { StepOutcome } from "../steps/step-outcome.js";
import type { CaseDetails } from "../steps/case-details.js";

const captureMeaning = ["passed", "visual differences", "execution failures"];
const compareMeaning = ["clear", "differences", "analysis failures"];

function describe(outcome: StepOutcome | undefined, meaning: string[]): string {
  if (outcome === undefined) return "not run";
  const origin = outcome.reusedFrom === null ? "ran" : `reused from ${outcome.reusedFrom}`;
  return `${outcome.status} (${meaning[outcome.status]}, ${origin})`;
}

/**
 * The lines that report one case: its execution outcome (capture status, coverage, where the canonical side came
 * from) apart from its visual outcome (results, compare status, report counts and completeness).
 */
export function describeCase(name: string, capture: StepOutcome | undefined, compare: StepOutcome | undefined, details: CaseDetails | null): string[] {
  if (capture === undefined || details === null) return [`${name}: execution: capture not run`];
  const { execution, visual } = details;
  const coverage = execution.coverageValid
    ? `coverage valid (${execution.contiguous ? "contiguous" : "not contiguous"}, ${execution.failures} failures, ${execution.optionalAbsent} optional absent)`
    : `coverage INVALID: ${execution.invalidReasons.join("; ")}`;
  const lines = [
    `${name}: execution: capture ${describe(capture, captureMeaning)}; ${coverage}; canonical side ${execution.canonicalSource === "cache" ? "from the cache" : execution.canonicalSource === "live" ? "live" : "partly from the cache"}; run folder ${capture.runFolder}`,
  ];
  const report = visual.report;
  if (report === null) {
    lines.push(`${name}: visual: ${visual.passed} passed, ${visual.failed} failed; compare ${describe(compare, compareMeaning)}`);
  } else {
    const totals = report.completeness.totals;
    lines.push(`${name}: visual: ${visual.passed} passed, ${visual.failed} failed; compare ${describe(compare, compareMeaning)}, report ${report.status}: `
      + `${report.totals.discrepancies} discrepancies in ${report.totals.groups} groups; completeness ${totals.planned} planned, ${totals.reported} reported, `
      + `${totals.optionalAbsent} optional absent, ${totals.analysisFailed} analysis-failed, ${totals.filtered} filtered, ${totals.executionLost} execution-lost, ${totals.unaccounted} unaccounted`);
  }
  return lines;
}