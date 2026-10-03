import { maximumPriors, ocrWords, type ArchivedFix } from "../fixes/retrieval.js";
import type { FixRecord } from "../fixes/fix-record.js";
import type { InventoryClass } from "../inventory/source-inventory-document.js";
import type { Target } from "./targets.js";

/** What a target is compared on: its class's files, the fixture cases of its mode, and its texts. */
export type TargetTraits = {
  readonly target: Target;
  readonly classFiles: readonly string[];
  readonly fixtureCases: readonly string[];
};

export type RankedPrior = ArchivedFix & {
  readonly score: number;
  /** The target the fix resembles most, and why. */
  readonly target: string;
  readonly reasons: readonly string[];
};

function normalized(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

/** How much an archived fix relates to a target, and why; 0 when nothing is shared. */
export function scoreFixForTarget(traits: TargetTraits, fix: FixRecord): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const files = new Set(traits.classFiles.map(normalized));
  const changed = fix.patch.files.map((file) => file.path).filter((path) => files.has(normalized(path))).sort();
  if (changed.length > 0) {
    score += 3;
    reasons.push(`changes ${changed.join(", ")}`);
  }
  for (const name of [...new Set(fix.cluster.cases)].filter((item) => traits.fixtureCases.includes(item)).sort()) {
    score += 1;
    reasons.push(`case ${name}`);
  }
  const { target } = traits;
  const mine = ocrWords([...target.controls.map((control) => control.text), ...target.pages.map((page) => page.text), ...(target.tabControl?.pages.map((page) => page.text) ?? [])]);
  const theirs = ocrWords(fix.members.flatMap((member) => [member.canonicalOcr, member.candidateOcr]));
  const common = [...mine].filter((word) => theirs.has(word)).sort();
  if (common.length > 0) {
    const jaccard = common.length / new Set([...mine, ...theirs]).size;
    score += 4 * jaccard;
    reasons.push(`words ${common.slice(0, 5).join(", ")}${common.length > 5 ? ` and ${common.length - 5} more` : ""} (Jaccard ${jaccard.toFixed(2)})`);
  }
  return { score: Math.round(score * 1000) / 1000, reasons };
}

/** The class files a fix may change to affect a class: its designer and code files. */
export function classFiles(item: Pick<InventoryClass, "designerFile" | "codeFile">): string[] {
  return [item.designerFile, item.codeFile];
}

/**
 * The archived fixes that relate to the targets, each by the target it relates to most (ties by target ID), best first
 * (by score, then by name), at most `maximumPriors`.
 */
export function rankPriors(targets: readonly TargetTraits[], fixes: readonly ArchivedFix[]): RankedPrior[] {
  return fixes.flatMap((fix): RankedPrior[] => {
    let best: RankedPrior | null = null;
    for (const traits of targets) {
      const { score, reasons } = scoreFixForTarget(traits, fix.record);
      if (score > 0 && (best === null || score > best.score || (score === best.score && traits.target.id < best.target))) {
        best = { ...fix, score, target: traits.target.id, reasons };
      }
    }
    return best === null ? [] : [best];
  }).sort((left, right) => right.score - left.score || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)).slice(0, maximumPriors);
}
