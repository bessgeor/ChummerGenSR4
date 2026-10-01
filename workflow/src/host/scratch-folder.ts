import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temporary folder a step writes its hand-over files to. */
export type ScratchFolder = {
  readonly path: string;
  remove(): void;
};

export function createScratchFolder(prefix: string): ScratchFolder {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}