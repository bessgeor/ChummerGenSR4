import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SetupError } from "../host/setup-error.js";
import { FixRecordSchema, type FixRecord } from "./fix-record.js";

/** At most this many archived fixes go into a cluster's context. */
export const maximumPriors = 3;

/** An archived fix change: its folder in the archive (`<date>-<name>`) and its record. */
export type ArchivedFix = { readonly name: string; readonly folder: string; readonly record: FixRecord };

/** What retrieval compares: the cluster's look, where it was seen, and the OCR text of its members. */
export type ClusterTraits = {
  readonly imageHash: string;
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly ocr: readonly (string | null)[];
};

export type RankedFix = ArchivedFix & { readonly score: number; readonly reasons: readonly string[] };

/** Every archived fix change of an archive folder, by name; a change without a valid `fix.json` is a setup error. */
export function readArchivedFixes(archive: string): ArchivedFix[] {
  if (!existsSync(archive)) return [];
  const fixes: ArchivedFix[] = [];
  for (const entry of readdirSync(archive, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
    const path = join(archive, entry, "fix.json");
    if (!existsSync(path)) throw new SetupError(`The archived fix change ${join(archive, entry)} has no fix.json.`);
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new SetupError(`The fix record ${path} cannot be read: ${(error as Error).message}`);
    }
    const parsed = FixRecordSchema.safeParse(document);
    if (!parsed.success) throw new SetupError(`The fix record ${path} is invalid: ${z.prettifyError(parsed.error)}`);
    fixes.push({ name: entry, folder: join(archive, entry), record: parsed.data });
  }
  return fixes;
}

/** The OCR words of some texts: runs of three or more letters or digits, lower case. */
export function ocrWords(texts: readonly (string | null)[]): Set<string> {
  const words = new Set<string>();
  for (const text of texts) {
    for (const word of (text ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) words.add(word);
  }
  return words;
}

function shared(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set(left)].filter((item) => right.includes(item)).sort();
}

/** How much an archived fix's discrepancy resembles a cluster, and why; 0 when nothing is shared. */
export function scoreFix(cluster: ClusterTraits, fix: FixRecord): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (fix.cluster.imageHash === cluster.imageHash) {
    score += 8;
    reasons.push("same image hash");
  }
  for (const capture of shared(cluster.captures, fix.cluster.captures)) {
    score += 3;
    reasons.push(`capture ${capture}`);
  }
  for (const name of shared(cluster.cases, fix.cluster.cases)) {
    score += 1;
    reasons.push(`case ${name}`);
  }
  const mine = ocrWords(cluster.ocr);
  const theirs = ocrWords(fix.members.flatMap((member) => [member.canonicalOcr, member.candidateOcr]));
  const common = [...mine].filter((word) => theirs.has(word)).sort();
  if (common.length > 0) {
    const jaccard = common.length / new Set([...mine, ...theirs]).size;
    score += 4 * jaccard;
    reasons.push(`OCR words ${common.slice(0, 5).join(", ")}${common.length > 5 ? ` and ${common.length - 5} more` : ""} (Jaccard ${jaccard.toFixed(2)})`);
  }
  return { score: Math.round(score * 1000) / 1000, reasons };
}

/** The archived fixes that resemble a cluster, best first (by score, then by name), at most `maximumPriors`. */
export function rankFixes(cluster: ClusterTraits, fixes: readonly ArchivedFix[]): RankedFix[] {
  return fixes.map((fix) => ({ ...fix, ...scoreFix(cluster, fix.record) }))
    .filter((fix) => fix.score > 0)
    .sort((left, right) => right.score - left.score || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .slice(0, maximumPriors);
}
