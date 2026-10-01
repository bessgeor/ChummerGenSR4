import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { fingerprintFolder, listFiles } from "../steps/fingerprint.js";

/** The folders of one attempt, all in its scratch folder outside the repository. */
export type AttemptWorkspace = {
  /** The attempt's scratch folder. */
  readonly root: string;
  /** The writable copy of the source snapshot: the repair job's working folder and the build's source. */
  readonly source: string;
  /** The copy of the cluster's sealed context, which the job may only read. */
  readonly context: string;
  /** The build's output folder (`bin/`, `obj/`). */
  readonly build: string;
  readonly buildLog: string;
  /** Where the patch's files before and after are laid out for the diff. */
  readonly patch: string;
};

/** Where an attempt's folders will be in its scratch folder; nothing exists there until `stageWorkspace` copies it. */
export function workspaceIn(scratch: ScratchFolder, clusterId: string): AttemptWorkspace {
  return {
    root: scratch.path, source: join(scratch.path, "source"), context: join(scratch.path, clusterId), build: join(scratch.path, "build"),
    buildLog: join(scratch.path, "build.log"), patch: join(scratch.path, "patch"),
  };
}

/**
 * Copies the cluster's context and the thread's snapshot into the attempt's scratch folder. The snapshot has no
 * version history and the scratch folder lies outside the repository, so nothing the job can reach leads to the
 * repository's history, another attempt or another thread.
 */
export function stageWorkspace(workspace: AttemptWorkspace, contextFolder: string, snapshotFolder: string): void {
  cpSync(contextFolder, workspace.context, { recursive: true });
  cpSync(snapshotFolder, workspace.source, { recursive: true });
}

/**
 * What a repair job changed outside the source copy, as sentences: the context copy differing from the sealed
 * context it was copied from, or anything in the scratch folder beside the two copies. Only the source copy may change.
 */
export async function changesOutsideSource(workspace: AttemptWorkspace, contextFolder: string): Promise<string[]> {
  const changes: string[] = [];
  const expected = new Set(["source", workspace.context.slice(workspace.root.length + 1)]);
  for (const entry of readdirSync(workspace.root)) {
    if (!expected.has(entry)) changes.push(`the scratch folder holds ${entry}, which the job did not get`);
  }
  if (!existsSync(workspace.context)) {
    changes.push("the context copy was removed");
  } else {
    const before = listFiles(contextFolder, true);
    const after = listFiles(workspace.context, true);
    const added = after.filter((file) => !before.includes(file));
    const removed = before.filter((file) => !after.includes(file));
    if (added.length > 0) changes.push(`the context copy gained ${added.join(", ")}`);
    if (removed.length > 0) changes.push(`the context copy lost ${removed.join(", ")}`);
    if (added.length === 0 && removed.length === 0 && await fingerprintFolder(contextFolder, true) !== await fingerprintFolder(workspace.context, true)) {
      changes.push("the context copy's files changed");
    }
  }
  return changes;
}
