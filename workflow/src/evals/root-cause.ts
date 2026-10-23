import { ChallengeOutputSchema, HypothesisOutputSchema, type Explanation, type mechanisms } from "../diagnosis/job-schemas.js";
import type { EvalRecord, Grade } from "./eval-record.js";

/** A line range of a file, both ends included, in the source the graded explanations saw. */
export type LineRange = { readonly start: number; readonly end: number };

export type RootCauseFile = {
  readonly path: string;
  readonly ranges: readonly LineRange[];
  /** Names that identify the changed code: hunk headers, or the symbol a reviewer confirmed. */
  readonly symbols: readonly string[];
  /** The changed lines' text, where a cited symbol may also occur. */
  readonly changedLines: readonly string[];
};

/** A known root cause of a discrepancy: where the cause lies and its mechanism class. */
export type RootCause = {
  /** Where it comes from: `benchmark:<item>` or `review:<record>`. */
  readonly source: string;
  readonly mechanism: (typeof mechanisms)[number];
  readonly files: readonly RootCauseFile[];
};

/** A line this close to a changed range still points at the changed code. */
export const lineTolerance = 3;

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isRight(grade: Grade): boolean {
  return grade === "symbol" || grade === "file";
}

/**
 * `symbol` when a location points at changed code (a line near a changed range, or a symbol the change names),
 * `file` when a location names a changed file, `mechanism` when only the mechanism class agrees, else `wrong`;
 * no explanation is `abstained`.
 */
export function gradeExplanation(explanation: Explanation | null, root: RootCause): Grade {
  if (explanation === null) return "abstained";
  let fileMatch = false;
  for (const location of explanation.locations) {
    const file = root.files.find((item) => item.path === normalizePath(location.path));
    if (file === undefined) continue;
    fileMatch = true;
    const line = location.line;
    if (line !== null && file.ranges.some((range) => line >= range.start - lineTolerance && line <= range.end + lineTolerance)) return "symbol";
    const symbol = location.symbol?.trim() ?? "";
    if (symbol.length > 0 && [...file.symbols, ...file.changedLines].some((text) => text.includes(symbol))) return "symbol";
  }
  if (fileMatch) return "file";
  return explanation.mechanism === root.mechanism ? "mechanism" : "wrong";
}

/** The explanation a record's answer gives: a hypothesis's explanation or a challenge's alternative; null for an abstention. */
export function explanationOf(record: EvalRecord): Explanation | null {
  if (record.jobKind === "hypothesis") return HypothesisOutputSchema.parse(record.output).explanation;
  if (record.jobKind === "challenge") return ChallengeOutputSchema.parse(record.output).alternative;
  throw new Error(`A ${record.jobKind} record has no explanation.`);
}

/** The root cause a reviewer confirmed: the explanation's locations (a line as a one-line range) and mechanism. */
export function rootCauseOfExplanation(source: string, explanation: Explanation): RootCause {
  const files = new Map<string, { ranges: LineRange[]; symbols: string[] }>();
  for (const location of explanation.locations) {
    const path = normalizePath(location.path);
    const file = files.get(path) ?? { ranges: [], symbols: [] };
    if (location.line !== null) file.ranges.push({ start: location.line, end: location.line });
    if (location.symbol !== null && location.symbol.trim().length > 0) file.symbols.push(location.symbol.trim());
    files.set(path, file);
  }
  return { source, mechanism: explanation.mechanism, files: [...files].map(([path, file]) => ({ path, ...file, changedLines: [] })) };
}
