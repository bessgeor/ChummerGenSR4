import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ScratchFolder } from "../host/scratch-folder.js";

/** The folders one job sees: its context folder and, beside it as the manifest says, the source snapshot. */
export type JobFolder = { readonly context: string; readonly source: string };

/** Where a job's folders will be in a scratch folder; nothing exists there until `stageJobFolder` copies it. */
export function jobFolderIn(scratch: ScratchFolder, clusterId: string): JobFolder {
  return { context: join(scratch.path, clusterId), source: join(scratch.path, "source") };
}

/**
 * Copies a cluster's context and the snapshot into a scratch folder outside the repository. The Codex sandbox
 * limits writes, not reads, so a job could read whatever lies around its working folder: here that is nothing
 * but the two copies, and not the thread's logs, the other threads, the repository or its history.
 *
 * `withoutPriors` leaves out the archived fixes the context carries (the `priors/` folder and the manifest's
 * `priors`), for a job that must not be pulled towards an earlier fix.
 */
export function stageJobFolder(staged: JobFolder, contextFolder: string, snapshotFolder: string, withoutPriors = false): void {
  cpSync(contextFolder, staged.context, {
    recursive: true,
    filter: (source) => !withoutPriors || relative(contextFolder, source).split(/[\\/]/)[0] !== "priors",
  });
  cpSync(snapshotFolder, staged.source, { recursive: true });
  if (withoutPriors) {
    const manifestPath = join(staged.context, "context.json");
    const { priors: _, ...manifest } = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
