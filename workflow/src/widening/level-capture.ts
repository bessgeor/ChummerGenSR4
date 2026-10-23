import type { HostRunner } from "../host/host-runner.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { runCaptureRunner } from "../steps/capture-step.js";

export type LevelCaptureRequest = {
  readonly label: string;
  readonly cases: readonly string[];
  /** The captures, or null for every capture of the cases. */
  readonly captures: readonly string[] | null;
  readonly candidateExecutable: string;
  readonly options: RunOptions;
  readonly signal?: AbortSignal;
};

/** Captures the named cases with an executable as candidate and returns the run's status and folder. */
export type LevelCapture = (request: LevelCaptureRequest) => Promise<{ readonly status: 0 | 1 | 2; readonly runFolder: string }>;

/** A level or baseline capture on the desktop lane: one capture runner call made like every other, never a recorded step. */
export function hostLevelCapture(paths: WorkflowPaths, host: HostRunner, createScratchFolder: (prefix: string) => ScratchFolder): LevelCapture {
  return (request) => runCaptureRunner({
    paths, host, createScratchFolder, options: request.options, selection: { cases: request.cases, captures: request.captures },
    candidateExecutable: request.candidateExecutable, subject: request.label, ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
}
