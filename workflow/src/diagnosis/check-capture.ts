import type { HostRunner } from "../host/host-runner.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { runCaptureRunner } from "../steps/capture-step.js";

export type CheckCaptureRequest = {
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly options: RunOptions;
  readonly signal?: AbortSignal;
};

/** Runs one capture of the named cases and captures and returns its status and run folder. */
export type CheckCapture = (request: CheckCaptureRequest) => Promise<{ readonly status: 0 | 1 | 2; readonly runFolder: string }>;

/**
 * The check capture on the desktop lane: one capture runner call with the thread's case file, overlay, threshold
 * and canonical cache, made like the capture step's. It never reuses a recorded capture step.
 */
export function hostCheckCapture(paths: WorkflowPaths, host: HostRunner, createScratchFolder: (prefix: string) => ScratchFolder): CheckCapture {
  return (request) => runCaptureRunner({
    paths, host, createScratchFolder, options: request.options, selection: { cases: request.cases, captures: request.captures },
    subject: "diagnosis check capture", ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
}
