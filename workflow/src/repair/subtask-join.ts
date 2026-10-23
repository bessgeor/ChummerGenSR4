import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileHashes } from "./patch.js";

/** One file a subtask changed: its content when the subtask started and after it, by SHA-256 (null: absent), and where the after side is kept. */
export type SubtaskChange = {
  readonly path: string;
  readonly start: string | null;
  readonly after: string | null;
  /** The kept copy of the after side, or null when the subtask deleted the file. */
  readonly file: string | null;
};

export type SubtaskChanges = { readonly id: number; readonly changes: readonly SubtaskChange[] };

/** A file's content in a join: its SHA-256 (null: absent), its copy, and the subtask that wrote it. */
export type JoinedFile = { readonly hash: string | null; readonly file: string | null; readonly writer: number };

export type Conflict = { readonly path: string; readonly first: number; readonly second: number };

/** The SHA-256 of every file of the snapshot, taken once for an attempt. */
export type SnapshotHashes = ReadonlyMap<string, string>;

export function snapshotHashes(snapshot: string): SnapshotHashes {
  return fileHashes(snapshot);
}

/**
 * Replays subtasks' changes in ID order over the snapshot. A file whose content in the join is not the content a
 * subtask started from was changed by an earlier subtask that does not block it: a conflict.
 */
export function joinChanges(snapshot: SnapshotHashes, subtasks: readonly SubtaskChanges[]): { joined: Map<string, JoinedFile> } | { conflict: Conflict } {
  const joined = new Map<string, JoinedFile>();
  for (const subtask of [...subtasks].sort((left, right) => left.id - right.id)) {
    for (const change of subtask.changes) {
      const current = joined.get(change.path);
      const hash = current === undefined ? snapshot.get(change.path) ?? null : current.hash;
      if (hash !== change.start) return { conflict: { path: change.path, first: current?.writer ?? subtask.id, second: subtask.id } };
      joined.set(change.path, { hash: change.after, file: change.file, writer: subtask.id });
    }
  }
  return { joined };
}

/** The files of a join whose content is not the snapshot's, sorted: what the joined source changes. */
export function joinedPaths(snapshot: SnapshotHashes, joined: ReadonlyMap<string, JoinedFile>): string[] {
  return [...joined].filter(([path, file]) => file.hash !== (snapshot.get(path) ?? null)).map(([path]) => path).sort();
}

/** Writes a join over a copy of the snapshot: each file's after side, or its removal. */
export function applyJoin(joined: ReadonlyMap<string, JoinedFile>, target: string): void {
  for (const [path, file] of joined) {
    const destination = join(target, path);
    if (file.file === null) {
      rmSync(destination, { force: true });
    } else {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(file.file, destination);
    }
  }
}

/**
 * What a subtask changed in its copy, against the content it started with (the snapshot with its blockers' join):
 * the after sides are kept under `keep/<path>`.
 */
export function subtaskChanges(snapshot: SnapshotHashes, copy: string, start: ReadonlyMap<string, JoinedFile>, keep: string): SubtaskChange[] {
  const work = fileHashes(copy);
  const changes: SubtaskChange[] = [];
  // A file the blockers changed and this subtask set back to the snapshot's content is among the start's.
  const paths = [...new Set([...snapshot.keys(), ...work.keys(), ...start.keys()])].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (const path of paths) {
    const from = start.has(path) ? start.get(path)!.hash : snapshot.get(path) ?? null;
    const after = work.get(path) ?? null;
    if (after === from) continue;
    let file: string | null = null;
    if (after !== null) {
      file = join(keep, path);
      mkdirSync(dirname(file), { recursive: true });
      copyFileSync(join(copy, path), file);
    }
    changes.push({ path, start: from, after, file });
  }
  return changes;
}
