import { cpSync } from "node:fs";
import { join } from "node:path";
import type { ScratchFolder } from "../host/scratch-folder.js";

/** The folders of one attempt, all in its scratch folder outside the repository. */
export type AttemptWorkspace = {
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
    source: join(scratch.path, "source"), context: join(scratch.path, clusterId), build: join(scratch.path, "build"),
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
