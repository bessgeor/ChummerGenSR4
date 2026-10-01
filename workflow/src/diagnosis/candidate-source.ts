import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkflowPaths } from "../paths.js";

/** What the thread's inputs say when the candidate has no recorded source. */
export const unrecordedSource = "unrecorded";

function recordPath(paths: WorkflowPaths): string {
  return join(dirname(paths.candidateApp), "source-fingerprint.txt");
}

/** Records the identity of the compiled source a candidate build started from, next to the candidate. Written only when a build ran. */
export function recordCandidateSource(paths: WorkflowPaths, compiledIdentity: string): void {
  writeFileSync(recordPath(paths), `${compiledIdentity}\n`);
}

/** The compiled-source identity recorded by the build of the candidate that is there now, or `unrecordedSource` when none was recorded. */
export function recordedCandidateSource(paths: WorkflowPaths): string {
  const path = recordPath(paths);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : unrecordedSource;
}