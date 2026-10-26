import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { fingerprintFolder, listFiles } from "../steps/fingerprint.js";

/** The folders of one attempt, all in its scratch folder outside the repository. */
export type AttemptWorkspace = {
  /** The attempt's scratch folder. */
  readonly root: string;
  /** The attempt's worktree of the repository on its own branch: the repair job's working folder and the build's source. */
  readonly source: string;
  /** The copy of the cluster's sealed context, which the job may only read. */
  readonly context: string;
  /** The build's output folder (`bin/`, `obj/`). */
  readonly build: string;
  readonly buildLog: string;
  /** Where the patch's files before and after are laid out for the diff. */
  readonly patch: string;
};

/** Where an attempt's folders will be in its scratch folder; nothing exists there until `stageWorkspace` makes it. */
export function workspaceIn(scratch: ScratchFolder, clusterId: string): AttemptWorkspace {
  return {
    root: scratch.path, source: join(scratch.path, "source"), context: join(scratch.path, clusterId), build: join(scratch.path, "build"),
    buildLog: join(scratch.path, "build.log"), patch: join(scratch.path, "patch"),
  };
}

/**
 * Copies the cluster's context into the attempt's scratch folder, without history, and has `checkout` make the attempt's
 * worktree at `source`. The scratch folder lies outside the repository, and nothing but the two lies in it.
 */
export function stageWorkspace(workspace: AttemptWorkspace, contextFolder: string, checkout: (folder: string) => void): void {
  cpSync(contextFolder, workspace.context, { recursive: true });
  checkout(workspace.source);
}

/**
 * What a repair job changed outside its worktree, as sentences: the context copy differing from the sealed context it
 * was copied from, or anything in the scratch folder beside the worktree and the context copy. Only the worktree may change.
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
