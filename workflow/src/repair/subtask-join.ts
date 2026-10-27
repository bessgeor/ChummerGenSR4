import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BlobId, Worktrees } from "../git/worktrees.js";

/** One file a subtask changed: its blob when the subtask started and after it (null: absent), and the commit that holds the after side. */
export type SubtaskChange = {
  readonly path: string;
  readonly start: BlobId;
  readonly after: BlobId;
  /** The subtask's commit, or null when the subtask deleted the file. */
  readonly commit: string | null;
};

export type SubtaskChanges = { readonly id: number; readonly changes: readonly SubtaskChange[] };

/** A file's content in a join: its blob (null: absent), the commit that holds it, and the subtask that wrote it. */
export type JoinedFile = { readonly hash: BlobId; readonly commit: string | null; readonly writer: number };

/**
 * Two subtasks' changes that cannot both apply: `path` was changed by both, or, with `other`, `path` is a file in one
 * and `other` a file inside it (or the reverse) in the other.
 */
export type Conflict = { readonly path: string; readonly first: number; readonly second: number; readonly other?: string };

/** The blob of every file of the thread's source commit, taken once for an attempt. */
export type SourceBlobs = ReadonlyMap<string, string>;

/**
 * The file of the join that stands where a file added at `path` needs a folder or is a folder: a file at one of its
 * ancestor paths, or a file inside it. Null when none.
 */
function pathCollision(source: SourceBlobs, joined: ReadonlyMap<string, JoinedFile>, path: string): string | null {
  const present = (candidate: string) => {
    const file = joined.get(candidate);
    return file === undefined ? source.has(candidate) : file.hash !== null;
  };
  const parts = path.split("/");
  for (let length = 1; length < parts.length; length += 1) {
    const ancestor = parts.slice(0, length).join("/");
    if (present(ancestor)) return ancestor;
  }
  const inside = `${path}/`;
  for (const candidate of [...source.keys(), ...joined.keys()]) {
    if (candidate.startsWith(inside) && present(candidate)) return candidate;
  }
  return null;
}

/**
 * Replays subtasks' changes in ID order over the source commit. A file whose blob in the join is not the blob a
 * subtask started from was changed by an earlier subtask that does not block it: a conflict. So is a file added where
 * the join has a folder, or inside a path where it has a file: git could not check such a join out.
 */
export function joinChanges(source: SourceBlobs, subtasks: readonly SubtaskChanges[]): { joined: Map<string, JoinedFile> } | { conflict: Conflict } {
  const joined = new Map<string, JoinedFile>();
  for (const subtask of [...subtasks].sort((left, right) => left.id - right.id)) {
    for (const change of subtask.changes) {
      const current = joined.get(change.path);
      const hash = current === undefined ? source.get(change.path) ?? null : current.hash;
      if (hash !== change.start) return { conflict: { path: change.path, first: current?.writer ?? subtask.id, second: subtask.id } };
      joined.set(change.path, { hash: change.after, commit: change.commit, writer: subtask.id });
    }
    // After all the subtask's changes, so that it may replace a file by a folder of the same name.
    for (const change of subtask.changes) {
      if (change.after === null || change.start !== null) continue;
      const other = pathCollision(source, joined, change.path);
      if (other !== null) return { conflict: { path: change.path, first: joined.get(other)?.writer ?? subtask.id, second: subtask.id, other } };
    }
  }
  return { joined };
}

/** The files of a join whose blob is not the source commit's, sorted: what the joined source changes. */
export function joinedPaths(source: SourceBlobs, joined: ReadonlyMap<string, JoinedFile>): string[] {
  return [...joined].filter(([path, file]) => file.hash !== (source.get(path) ?? null)).map(([path]) => path).sort();
}

/**
 * Writes a join into a worktree at the source commit: each file from the commit that holds it, or its removal. The
 * removals come first, with the folders they empty, so that a file may take the place of a folder and the reverse.
 */
export function applyJoin(worktrees: Worktrees, joined: ReadonlyMap<string, JoinedFile>, worktree: string): void {
  for (const [path, file] of joined) {
    if (file.commit !== null) continue;
    rmSync(join(worktree, path), { force: true });
    for (let folder = dirname(path); folder !== "." && folder !== "/"; folder = dirname(folder)) {
      const full = join(worktree, folder);
      if (!existsSync(full)) continue;
      if (readdirSync(full).length > 0) break;
      rmdirSync(full);
    }
  }
  for (const [path, file] of joined) {
    if (file.commit !== null) worktrees.checkoutFile(worktree, file.commit, path);
  }
}

/**
 * What a subtask changed against the commit it started from, nothing without a commit: its files, and apart from them
 * the paths of symbolic links and submodules, which a join cannot carry and the attempt must account for.
 */
export function subtaskChanges(worktrees: Worktrees, start: string, commit: string | null): { changes: SubtaskChange[]; others: string[] } {
  if (commit === null) return { changes: [], others: [] };
  const all = worktrees.changes(start, commit);
  return {
    changes: all.filter((change) => !change.special)
      .map((change) => ({ path: change.path, start: change.before, after: change.after, commit: change.after === null ? null : commit })),
    others: all.filter((change) => change.special).map((change) => change.path),
  };
}
