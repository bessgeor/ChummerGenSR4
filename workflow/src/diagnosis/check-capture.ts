import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostRunner } from "../host/host-runner.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { finishedStatus } from "../steps/step-outcome.js";

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
 * and canonical cache. It never reuses a recorded capture step. Status 3, or a run that reports no folder or
 * writes no results and coverage, is a setup error.
 */
export function hostCheckCapture(paths: WorkflowPaths, host: HostRunner, createScratchFolder: (prefix: string) => ScratchFolder): CheckCapture {
  return async (request) => {
    const { options } = request;
    const scratch = createScratchFolder("workflow-check-");
    try {
      const runFolderFile = join(scratch.path, "run-folder.txt");
      const args = [join(paths.captureTools, "Parity.Capture.dll"), "--case", request.cases.join(","), "--capture", request.captures.join(","),
        "--case-file", options.caseFile, "--repo-root", paths.repositoryRoot, "--run-folder-file", runFolderFile];
      if (options.threshold !== null) args.push("--threshold", String(options.threshold));
      if (options.settingsOverlay !== null) args.push("--settings-overlay", options.settingsOverlay);
      if (options.canonicalCache !== null) args.push("--canonical-cache", options.canonicalCache);
      const exit = await host.run({ resource: "desktop", label: "diagnosis check", command: "dotnet", args, ...(request.signal === undefined ? {} : { signal: request.signal }) });
      const status = finishedStatus(exit);
      if (status === null) throw new SetupError(`The diagnosis check capture exited with ${exit}, so its run did not finish.`);
      if (!existsSync(runFolderFile)) throw new SetupError(`The diagnosis check capture exited with ${exit} but did not report its run folder.`);
      const runFolder = readFileSync(runFolderFile, "utf8").trim();
      for (const output of ["results.json", "coverage.json"]) {
        if (!existsSync(join(runFolder, output))) throw new SetupError(`The diagnosis check capture exited with ${exit} but wrote no ${join(runFolder, output)}.`);
      }
      return { status, runFolder };
    } finally {
      scratch.remove();
    }
  };
}
