import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Git } from "../diagnosis/source-snapshot.js";
import type { BenchmarkItem } from "./benchmark.js";
import type { EvalRecord } from "./eval-record.js";
import { contextExists, recordContext } from "./record-context.js";

/** Why a record cannot be graded by a benchmark item: null when the lines its answer cited are the lines the fix's ranges are in. */
export type BaseCheck = (record: EvalRecord, item: BenchmarkItem) => string | null;

const normalized = (text: string) => text.replaceAll("\r\n", "\n");

/**
 * The ranges of a fix are lines of its parent commit, and a record's citations are lines of its thread's snapshot, so
 * they compare only when every file the fix touches is the same in both.
 */
export function snapshotBaseCheck(git: Git, threadFolder: (threadId: string) => string): BaseCheck {
  return (record, item) => {
    if (!contextExists(threadFolder, record)) return "its context or its thread's snapshot no longer exists";
    const { sourceFolder } = recordContext(threadFolder, record);
    for (const file of item.fix.files) {
      const inBase = git(["ls-tree", "--name-only", item.base.commit, "--", file.path]).trim().length > 0;
      const expected = inBase ? normalized(git(["show", `${item.base.commit}:${file.path}`])) : null;
      const path = join(sourceFolder, file.path);
      const actual = existsSync(path) ? normalized(readFileSync(path, "utf8")) : null;
      if (actual !== expected) return `${file.path} of its snapshot differs from the fix's parent ${item.base.commit.slice(0, 12)}, so its cited lines are not the fix's lines`;
    }
    return null;
  };
}
