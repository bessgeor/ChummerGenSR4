import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compiledFoldersText } from "../compiled-source.js";
import { SetupError } from "../host/setup-error.js";
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

function sha256RecordPath(paths: WorkflowPaths): string {
  return join(dirname(paths.candidateApp), "candidate-sha256.txt");
}

/** Records the SHA-256 of the candidate the workflow's build produced, so a candidate built later outside it shows. */
export function recordCandidateSha256(paths: WorkflowPaths, sha256: string): void {
  writeFileSync(sha256RecordPath(paths), `${sha256}\n`);
}

/** The SHA-256 of the candidate built from the recorded source, or undefined when no build recorded one. */
export function recordedCandidateSha256(paths: WorkflowPaths): string | undefined {
  const path = sha256RecordPath(paths);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
}

/** The compiled-source identity recorded by the build of the candidate that is there now, or `unrecordedSource` when none was recorded. */
export function recordedCandidateSource(paths: WorkflowPaths): string {
  const path = recordPath(paths);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : unrecordedSource;
}

/** Fails when the candidate's build recorded no source; `why` says how the candidate came to lack one and what to do. */
export function requireRecordedSource(recorded: string, why: string): void {
  if (recorded === unrecordedSource) throw new SetupError(`The candidate has no recorded source: ${why}`);
}

/**
 * Fails when the compiled source now differs from the one the candidate's build recorded: what the candidate shows is then
 * not this source. `consequence` names what that spoils and how to recover.
 */
export function requireSameSource(recorded: string, current: string, consequence: string): void {
  if (current !== recorded) {
    throw new SetupError(`The compiled source (${compiledFoldersText}) differs from the source the candidate was built from (recorded ${recorded.slice(0, 12)}, now ${current.slice(0, 12)}); ${consequence}`);
  }
}