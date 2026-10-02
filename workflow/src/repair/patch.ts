import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parsePatch } from "../evals/benchmark.js";
import { SetupError } from "../host/setup-error.js";

export type PatchFile = {
  /** Relative to the source copy, with `/` separators. */
  readonly path: string;
  readonly change: "added" | "modified" | "deleted";
  /** SHA-256 of the file in the snapshot, or null when it was added. */
  readonly before: string | null;
  /** SHA-256 of the file in the copy, or null when it was deleted. */
  readonly after: string | null;
  readonly added: number;
  readonly removed: number;
  /** Whether either side holds a NUL byte. */
  readonly binary: boolean;
};

/** What an attempt changed in its source copy against the snapshot. */
export type Patch = {
  readonly files: readonly PatchFile[];
  /** Entries of the copy that are neither files nor folders (links), which the comparison cannot follow. */
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

/** Relative paths with `/` of the files under a folder, and of the entries that are neither files nor folders. */
function entries(root: string): { files: Map<string, string>; others: string[] } {
  const files = new Map<string, string>();
  const others: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/");
    if (entry.isFile()) files.set(path, join(root, path));
    else if (!entry.isDirectory()) others.push(path);
  }
  return { files, others: others.sort() };
}

/** The SHA-256 of every file under a folder, by relative path with `/`. */
export function fileHashes(root: string): Map<string, string> {
  return new Map([...entries(root).files].map(([path, file]) => [path, sha256(readFileSync(file))]));
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

/**
 * Compares the source copy with the snapshot by content, lays out the changed files under `layout/before/` and
 * `layout/after/` (a folder outside the repository, so no repository's attributes apply) and diffs each of them.
 */
export function computePatch(snapshot: string, copy: string, layout: string): Patch {
  const base = entries(snapshot).files;
  const work = entries(copy);
  const paths = [...new Set([...base.keys(), ...work.files.keys()])].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const files: PatchFile[] = [];
  const texts: string[] = [];
  for (const path of paths) {
    const beforeFile = base.get(path);
    const afterFile = work.files.get(path);
    const beforeBytes = beforeFile === undefined ? null : readFileSync(beforeFile);
    const afterBytes = afterFile === undefined ? null : readFileSync(afterFile);
    const before = beforeBytes === null ? null : sha256(beforeBytes);
    const after = afterBytes === null ? null : sha256(afterBytes);
    if (before === after) continue;
    for (const [side, source] of [["before", beforeFile], ["after", afterFile]] as const) {
      if (source === undefined) continue;
      mkdirSync(dirname(join(layout, side, path)), { recursive: true });
      copyFileSync(source, join(layout, side, path));
    }
    const text = fileDiff(layout, before === null ? "/dev/null" : `before/${path}`, after === null ? "/dev/null" : `after/${path}`);
    const hunks = parsePatch(text).flatMap((file) => file.hunks);
    texts.push(text.endsWith("\n") ? text : `${text}\n`);
    files.push({
      path, change: before === null ? "added" : after === null ? "deleted" : "modified", before, after,
      added: hunks.reduce((sum, hunk) => sum + hunk.added.length, 0), removed: hunks.reduce((sum, hunk) => sum + hunk.removed.length, 0),
      binary: [beforeBytes, afterBytes].some((bytes) => bytes !== null && bytes.includes(0)),
    });
  }
  return {
    files, others: work.others, text: texts.join(""),
    added: files.reduce((sum, file) => sum + file.added, 0), removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}
