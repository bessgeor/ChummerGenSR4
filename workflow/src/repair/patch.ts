import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parsePatch } from "../evals/benchmark.js";
import type { Worktrees } from "../git/worktrees.js";
import { SetupError } from "../host/setup-error.js";

export type PatchFile = {
  /** Relative to the worktree, with `/` separators. */
  readonly path: string;
  readonly change: "added" | "modified" | "deleted";
  /** SHA-256 of the file as the source commit stores it, or null when it was added. */
  readonly before: string | null;
  /** SHA-256 of the file as the attempt commit stores it, or null when it was deleted. */
  readonly after: string | null;
  readonly added: number;
  readonly removed: number;
  /** Whether either side holds a NUL byte. */
  readonly binary: boolean;
};

/** What an attempt commit changes against the thread's source commit. */
export type Patch = {
  readonly files: readonly PatchFile[];
  /** Changed entries that are neither files nor folders (links, submodules), which the comparison does not follow. */
  readonly others: readonly string[];
  /** The unified diff of every file, with paths `a/<path>` and `b/<path>`. */
  readonly text: string;
  readonly added: number;
  readonly removed: number;
};

/** The diff options of benchmark patches, pinned so the machine's diff configuration cannot change the text. */
const diffOptions = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--indent-heuristic", "-U3"];
const gitConfig = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=false"];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Runs `git diff --no-index` in `folder` on two of its paths (or /dev/null) and returns the diff with the layout folders taken out of its paths. */
function fileDiff(folder: string, before: string, after: string): string {
  let text: string;
  try {
    text = execFileSync("git", [...gitConfig, "diff", "--no-index", ...diffOptions, "--", before, after],
      { cwd: folder, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    // Exit 1 means the files differ, which is why this diff runs.
    const failed = error as { status?: number; stdout?: string; message: string };
    if (failed.status !== 1 || failed.stdout === undefined) throw new SetupError(`git diff --no-index ${before} ${after} failed: ${failed.message}`);
    text = failed.stdout;
  }
  // Only the header lines name paths; the layout puts each side under before/ or after/.
  const lines = text.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  return lines.map((line, index) => (firstHunk >= 0 && index >= firstHunk ? line : line.replace(/(^|\s)([ab])\/(?:before|after)\//g, "$1$2/"))).join("\n");
}

/** The patch of an attempt that made no commit. */
export const emptyPatch: Patch = { files: [], others: [], text: "", added: 0, removed: 0 };

/**
 * What `to` changes against `from`, by blob and without rename detection: each changed file's sides are laid out under
 * `layout/before/` and `layout/after/` (a folder outside the repository, so no repository's attributes apply) as git
 * stores them, and diffed. Without a commit `to`, nothing changed.
 */
export function commitPatch(worktrees: Worktrees, from: string, to: string | null, layout: string): Patch {
  if (to === null) return emptyPatch;
  const files: PatchFile[] = [];
  const texts: string[] = [];
  const changes = worktrees.changes(from, to);
  for (const change of changes.filter((item) => !item.special)) {
    const beforeBytes = change.before === null ? null : worktrees.read(change.before);
    const afterBytes = change.after === null ? null : worktrees.read(change.after);
    for (const [side, bytes] of [["before", beforeBytes], ["after", afterBytes]] as const) {
      if (bytes === null) continue;
      mkdirSync(dirname(join(layout, side, change.path)), { recursive: true });
      writeFileSync(join(layout, side, change.path), bytes);
    }
    const text = fileDiff(layout, beforeBytes === null ? "/dev/null" : `before/${change.path}`, afterBytes === null ? "/dev/null" : `after/${change.path}`);
    const hunks = parsePatch(text).flatMap((file) => file.hunks);
    texts.push(text.endsWith("\n") ? text : `${text}\n`);
    files.push({
      path: change.path, change: beforeBytes === null ? "added" : afterBytes === null ? "deleted" : "modified",
      before: beforeBytes === null ? null : sha256(beforeBytes), after: afterBytes === null ? null : sha256(afterBytes),
      added: hunks.reduce((sum, hunk) => sum + hunk.added.length, 0), removed: hunks.reduce((sum, hunk) => sum + hunk.removed.length, 0),
      binary: [beforeBytes, afterBytes].some((bytes) => bytes !== null && bytes.includes(0)),
    });
  }
  return {
    files, others: changes.filter((item) => item.special).map((item) => item.path), text: texts.join(""),
    added: files.reduce((sum, file) => sum + file.added, 0), removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}
