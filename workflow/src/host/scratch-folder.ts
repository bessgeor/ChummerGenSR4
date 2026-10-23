import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SetupError } from "./setup-error.js";

/** A temporary folder a step writes its hand-over files to. */
export type ScratchFolder = {
  readonly path: string;
  remove(): void;
};

export function createScratchFolder(prefix: string): ScratchFolder {
  const path = mkdtempSync(join(tmpdir(), prefix));
  // A process a job left behind may still hold the folder for a moment (Windows), so removing it retries.
  return { path, remove: () => rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

/** Removes a scratch folder; the setup error naming a copy that stays, for the caller to raise once it has stored its result. */
export function removalFailure(scratch: ScratchFolder): SetupError | null {
  try {
    scratch.remove();
    return null;
  } catch (error) {
    return new SetupError(`The scratch copy ${scratch.path} could not be removed: ${(error as Error).message}`);
  }
}
