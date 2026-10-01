import { cpSync } from "node:fs";
import { join } from "node:path";
import type { ScratchFolder } from "../host/scratch-folder.js";

/** The folders one job sees: its context folder and, beside it as the manifest says, the source snapshot. */
export type JobFolder = { readonly context: string; readonly source: string };

/**
 * Copies a cluster's context and the snapshot into a scratch folder outside the repository. The Codex sandbox
 * limits writes, not reads, so a job could read whatever lies around its working folder: here that is nothing
 * but the two copies, and not the thread's logs, the other threads, the repository or its history.
 */
export function stageJobFolder(scratch: ScratchFolder, clusterId: string, contextFolder: string, snapshotFolder: string): JobFolder {
  const staged = { context: join(scratch.path, clusterId), source: join(scratch.path, "source") };
  cpSync(contextFolder, staged.context, { recursive: true });
  cpSync(snapshotFolder, staged.source, { recursive: true });
  return staged;
}
