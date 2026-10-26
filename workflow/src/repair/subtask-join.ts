import { rmSync } from "node:fs";
import { join } from "node:path";
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

export type Conflict = { readonly path: string; readonly first: number; readonly second: number };

/** The blob of every file of the thread's source commit, taken once for an attempt. */
export type SourceBlobs = ReadonlyMap<string, string>;

/**
 * Replays subtasks' changes in ID order over the source commit. A file whose blob in the join is not the blob a
 * subtask started from was changed by an earlier subtask that does not block it: a conflict.
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
  }
  return { joined };
}

/** The files of a join whose blob is not the source commit's, sorted: what the joined source changes. */
export function joinedPaths(source: SourceBlobs, joined: ReadonlyMap<string, JoinedFile>): string[] {
  return [...joined].filter(([path, file]) => file.hash !== (source.get(path) ?? null)).map(([path]) => path).sort();
}

/** Writes a join into a worktree at the source commit: each file from the commit that holds it, or its removal. */
export function applyJoin(worktrees: Worktrees, joined: ReadonlyMap<string, JoinedFile>, worktree: string): void {
  for (const [path, file] of joined) {
    if (file.commit === null) rmSync(join(worktree, path), { force: true });
    else worktrees.checkoutFile(worktree, file.commit, path);
  }
}

/** What a subtask changed: the files its commit changes against the commit it started from; nothing without a commit. */
export function subtaskChanges(worktrees: Worktrees, start: string, commit: string | null): SubtaskChange[] {
  if (commit === null) return [];
  return worktrees.changes(start, commit).filter((change) => !change.special)
    .map((change) => ({ path: change.path, start: change.before, after: change.after, commit: change.after === null ? null : commit }));
}
