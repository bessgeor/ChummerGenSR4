import { join } from "node:path";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { ExecutionCoverageSchema } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import type { HostRunner } from "../host/host-runner.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { runCaptureRunner } from "../steps/capture-step.js";
import { readDocument } from "../steps/read-document.js";
import type { CheckExecution } from "./cluster-repair.js";

export type AttemptBuildRequest = {
  readonly label: string;
  /** The folder that holds the patched `Chummer/` and `Core/`; the build needs both. */
  readonly source: string;
  /** The output folder: the executable goes to `bin/`, intermediate files to `obj/`. */
  readonly output: string;
  readonly log: string;
  readonly signal: AbortSignal;
};

/** Builds an attempt's source and returns the build script's exit status: 0 built, 1 failed, 3 setup error. */
export type AttemptBuild = (request: AttemptBuildRequest) => Promise<number>;

/** The attempt's build in the CPU pool, by the candidate build script with the attempt's own source and output folders. */
export function hostAttemptBuild(paths: WorkflowPaths, host: HostRunner): AttemptBuild {
  return (request) => host.run({
    resource: "cpu", label: request.label, command: process.execPath,
    args: [join(paths.repositoryRoot, "parity", "scripts", "build-candidate.mjs"), "--source", request.source, "--output", request.output, "--log", request.log],
    signal: request.signal,
  });
}

export type NarrowCheckRequest = {
  readonly label: string;
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly candidateExecutable: string;
  readonly options: RunOptions;
  readonly signal?: AbortSignal;
};

/** Captures the named cases and captures with the attempt's executable as candidate and returns the run's status and folder. */
export type NarrowCheck = (request: NarrowCheckRequest) => Promise<{ readonly status: 0 | 1 | 2; readonly runFolder: string }>;

/** The narrow check on the desktop lane: one capture runner call made like the capture step's, never a recorded step. */
export function hostNarrowCheck(paths: WorkflowPaths, host: HostRunner, createScratchFolder: (prefix: string, parent?: string) => ScratchFolder): NarrowCheck {
  return (request) => runCaptureRunner({
    paths, host, createScratchFolder, options: request.options, selection: { cases: request.cases, captures: request.captures },
    candidateExecutable: request.candidateExecutable, subject: request.label, ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
}

export type CheckRow = { readonly case: string; readonly capture: string; readonly passed: boolean; readonly reason: string; readonly difference: number };

/** What a narrow check run shows: its execution outcome, each selected capture's result, and why it rejects the attempt, or null when it passes. */
export function judgeNarrowCheck(status: 0 | 1 | 2, runFolder: string): { execution: CheckExecution; rows: CheckRow[]; rejection: string | null } {
  const results = readDocument(join(runFolder, "results.json"), CaptureResultsSchema);
  const coverage = readDocument(join(runFolder, "coverage.json"), ExecutionCoverageSchema);
  const rows: CheckRow[] = results.results.map((row) => ({ case: row.case, capture: row.capture, passed: row.passed, reason: row.reason, difference: row.difference }));
  const failing = rows.filter((row) => !row.passed);
  const execution: CheckExecution = {
    runFolder, status, coverageValid: coverage.valid, invalidReasons: coverage.invalidReasons, failures: coverage.totals.failures,
    passed: rows.length - failing.length, failed: failing.length,
  };
  let rejection: string | null = null;
  if (status === 2 || !coverage.valid) {
    rejection = `execution failure: capture status ${status}, coverage ${coverage.valid ? "valid" : `invalid (${coverage.invalidReasons.join("; ")})`}`;
  } else if (status === 1 || failing.length > 0) {
    rejection = `still differs: ${failing.map((row) => `${row.case}/${row.capture} ${row.reason} (${row.difference})`).join(", ")}`;
  }
  return { execution, rows, rejection };
}
