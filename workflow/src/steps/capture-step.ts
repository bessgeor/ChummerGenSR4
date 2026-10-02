import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlannedCase } from "../cases/case-plan.js";
import type { HostRunner } from "../host/host-runner.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { z } from "zod";
import { listFiles, sha256File } from "./fingerprint.js";
import { captureInputs, changedInputs } from "./input-fingerprints.js";
import { captureKey } from "./step-keys.js";
import { readDocument } from "./read-document.js";
import { finishedStatus, type StepContext, type StepOutcome } from "./step-outcome.js";
import type { StepStore } from "./step-store.js";

/** The files a completed capture run must have; their hashes guard a reused record, with every screenshot. */
export const captureOutputs = ["summary.json", "results.json", "coverage.json"] as const;

export type CaptureDependencies = {
  readonly paths: WorkflowPaths;
  readonly host: HostRunner;
  readonly store: StepStore;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  /** Checks the inputs again, so a thread never mixes candidates or tools; replaceable in tests. */
  readonly changedInputs: typeof changedInputs;
};

/** The cases a capture run covered, from its coverage document. */
const RunCasesSchema = z.object({ cases: z.array(z.object({ case: z.string() })) });

/** What one capture runner call captures: the named cases, and only the named captures unless the filter is null. */
export type CaptureSelection = { readonly cases: readonly string[]; readonly captures: readonly string[] | null };

/**
 * The capture runner's arguments for a selection under a thread's options; every capture run uses them. A candidate
 * executable replaces the thread's candidate (`out/candidate/bin/`).
 */
export function captureArguments(paths: WorkflowPaths, options: RunOptions, selection: CaptureSelection, runFolderFile: string, candidateExecutable: string | null = null): string[] {
  const args = [join(paths.captureTools, "Parity.Capture.dll"),
    "--case", selection.cases.join(","), "--case-file", options.caseFile, "--repo-root", paths.repositoryRoot, "--run-folder-file", runFolderFile];
  if (candidateExecutable !== null) args.push("--candidate-exe", candidateExecutable);
  if (selection.captures !== null) args.push("--capture", selection.captures.join(","));
  if (options.threshold !== null) args.push("--threshold", String(options.threshold));
  if (options.settingsOverlay !== null) args.push("--settings-overlay", options.settingsOverlay);
  if (options.canonicalCache !== null) args.push("--canonical-cache", options.canonicalCache);
  return args;
}

export type CaptureRunRequest = {
  readonly paths: WorkflowPaths;
  readonly host: HostRunner;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly options: RunOptions;
  readonly selection: CaptureSelection;
  /** Names the run in the host's progress lines and its errors, for example `capture alpha`. */
  readonly subject: string;
  /** The executable to capture as the candidate instead of the thread's. */
  readonly candidateExecutable?: string;
  readonly signal?: AbortSignal;
};

/**
 * Runs the capture runner on the desktop lane and returns its finished status and run folder. Status 3, a run
 * that reports no folder, or one without its summary, results and coverage is a setup error.
 */
export async function runCaptureRunner(request: CaptureRunRequest): Promise<{ readonly status: 0 | 1 | 2; readonly runFolder: string }> {
  const scratch = request.createScratchFolder("workflow-capture-");
  try {
    const runFolderFile = join(scratch.path, "run-folder.txt");
    const exit = await request.host.run({
      resource: "desktop", label: request.subject, command: "dotnet",
      args: captureArguments(request.paths, request.options, request.selection, runFolderFile, request.candidateExecutable ?? null), ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const status = finishedStatus(exit);
    if (status === null) throw new SetupError(`${request.subject} exited with ${exit}, so its run did not finish.`);
    if (!existsSync(runFolderFile)) throw new SetupError(`${request.subject} exited with ${exit} but did not report its run folder.`);
    const runFolder = readFileSync(runFolderFile, "utf8").trim();
    for (const output of captureOutputs) {
      if (!existsSync(join(runFolder, output))) throw new SetupError(`${request.subject} exited with ${exit} but wrote no ${join(runFolder, output)}.`);
    }
    return { status, runFolder };
  } finally {
    scratch.remove();
  }
}

/** The screenshots of a run, relative to its folder. */
function screenshots(runFolder: string): string[] {
  return existsSync(join(runFolder, "captures")) ? listFiles(join(runFolder, "captures"), true).map((path) => `captures/${path}`) : [];
}

/** Captures one case on the desktop lane, or reuses a completed capture with the same inputs. */
export class CaptureStep {
  constructor(private readonly dependencies: CaptureDependencies) {}

  async run(context: StepContext, item: PlannedCase): Promise<StepOutcome> {
    const { paths, store, log } = this.dependencies;
    const changed = await this.dependencies.changedInputs(paths, context.options, context.fingerprints, captureInputs);
    if (changed.length > 0) {
      throw new SetupError(`Inputs changed since the thread started (${changed.join(", ")}); start a new thread.`);
    }
    const environment = await this.readEnvironment(context, item);
    const stepKey = captureKey(item, await sha256File(item.fixturePath), environment, context.options, context.fingerprints);
    const recapture = context.options.recapture && context.mode === "run";
    const found = recapture ? { found: "none" as const } : await store.lookup("capture", stepKey.key);
    if (found.found === "valid") {
      log(`capture ${item.name}: reusing ${found.record.runFolder} from thread ${found.record.threadId} (status ${found.record.status}).`);
      return { case: item.name, status: found.record.status, runFolder: found.record.runFolder, key: stepKey.key, reusedFrom: found.record.threadId };
    }
    if (context.mode === "reuse-only") {
      const why = found.found === "stale" ? `its record is stale: ${found.reason}` : "there is no completed capture with these inputs";
      throw new SetupError(`capture ${item.name}: ${why}; run the capture node first.`);
    }
    if (recapture) log(`capture ${item.name}: capturing again (--recapture).`);
    else if (found.found === "stale") log(`capture ${item.name}: capturing again because ${found.reason}.`);

    const { status, runFolder } = await runCaptureRunner({
      paths, host: this.dependencies.host, createScratchFolder: this.dependencies.createScratchFolder, options: context.options,
      selection: { cases: [item.name], captures: item.captureFilter }, subject: `capture ${item.name}`,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    // The runner also matches `--case` against fixture file names, so it may have run more than the planned case.
    const covered = readDocument(join(runFolder, "coverage.json"), RunCasesSchema).cases.map((entry) => entry.case);
    if (covered.length !== 1 || covered[0] !== item.name) {
      throw new SetupError(`capture ${item.name} ran ${covered.length} cases (${covered.join(", ")}) in ${runFolder}, not only the planned one; nothing it wrote is recorded.`);
    }
    if (status !== 2) {
      await store.save({ kind: "capture", key: stepKey.key, keyLines: [...stepKey.lines], case: item.name, runFolder, status, threadId: context.threadId },
        [...captureOutputs, ...screenshots(runFolder)], this.dependencies.now());
    }
    return { case: item.name, status, runFolder, key: stepKey.key, reusedFrom: null };
  }

  private readEnvironment(context: StepContext, item: PlannedCase): Promise<string> {
    return readEnvironmentFingerprint(this.dependencies.paths, this.dependencies.host, this.dependencies.createScratchFolder, `environment ${item.name}`, context.signal);
  }
}

/** The capture runner's fingerprint of the machine and app environment, which decides the pixels. */
export async function readEnvironmentFingerprint(
  paths: WorkflowPaths, host: HostRunner, createScratchFolder: (prefix: string) => ScratchFolder, label: string, signal?: AbortSignal,
): Promise<string> {
  const scratch = createScratchFolder("workflow-environment-");
  try {
    const file = join(scratch.path, "environment.txt");
    const exit = await host.run({
      resource: "cpu", label, command: "dotnet", args: [join(paths.captureTools, "Parity.Capture.dll"), "--environment-fingerprint-file", file],
      ...(signal === undefined ? {} : { signal }),
    });
    if (exit !== 0 || !existsSync(file)) throw new SetupError(`The capture runner could not fingerprint the environment (exit ${exit}).`);
    const fingerprint = readFileSync(file, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new SetupError(`The capture runner wrote an environment fingerprint that is not a SHA-256: '${fingerprint}'.`);
    return fingerprint;
  } finally {
    scratch.remove();
  }
}

/** Fails a level or baseline capture whose run covered other cases than the selected ones: the runner also matches `--case` against fixture file names. */
export function requireCoveredCases(subject: string, runFolder: string, expected: readonly string[]): void {
  const covered = readDocument(join(runFolder, "coverage.json"), RunCasesSchema).cases.map((entry) => entry.case);
  const wanted = new Set(expected);
  if (covered.length !== wanted.size || covered.some((name) => !wanted.has(name))) {
    throw new SetupError(`${subject} ran ${covered.length} cases (${covered.join(", ")}) in ${runFolder}, not only the selected ${[...wanted].join(", ")}; nothing it wrote is used.`);
  }
}