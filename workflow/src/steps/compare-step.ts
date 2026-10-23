import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostRunner } from "../host/host-runner.js";
import { SetupError } from "../host/setup-error.js";
import type { WorkflowPaths } from "../paths.js";
import { sha256File } from "./fingerprint.js";
import { changedInputs, compareInputs } from "./input-fingerprints.js";
import { compareKey } from "./step-keys.js";
import { finishedStatus, type StepContext, type StepOutcome } from "./step-outcome.js";
import type { StepStore } from "./step-store.js";

export const reportPath = join("compare", "report.json");
const reportStatuses = new Map<unknown, 0 | 1 | 2>([["clear", 0], ["differences", 1], ["analysis-failures", 2]]);

export type CompareDependencies = {
  readonly paths: WorkflowPaths;
  readonly host: HostRunner;
  readonly store: StepStore;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  /** Checks the inputs again, so a thread never mixes tools; replaceable in tests. */
  readonly changedInputs: typeof changedInputs;
};

/** The report's status when it matches the comparer's exit status; anything else is a setup error. */
export function checkReport(runFolder: string, label: string, status: 0 | 1 | 2): void {
  const path = join(runFolder, reportPath);
  if (!existsSync(path)) throw new SetupError(`${label} exited with ${status} but wrote no ${path}; it did not analyze the run.`);
  let reportStatus: unknown;
  try {
    reportStatus = (JSON.parse(readFileSync(path, "utf8")) as { status?: unknown }).status;
  } catch (error) {
    throw new SetupError(`${path} cannot be read: ${(error as Error).message}`);
  }
  if (reportStatuses.get(reportStatus) !== status) {
    throw new SetupError(`${label} exited with ${status}, but ${path} has status '${String(reportStatus)}'.`);
  }
}

/**
 * Fails when the compare report of a case is no longer the one its step recorded: the comparer replaces `compare/`
 * in the capture's run folder, which another thread may share, so a report must be read only while its record holds.
 */
export async function requireCurrentReport(store: StepStore, outcome: StepOutcome): Promise<void> {
  if (outcome.status === 2) return;
  const found = await store.lookup("compare", outcome.key);
  if (found.found !== "valid") {
    const why = found.found === "stale" ? ` (${found.reason})` : "";
    throw new SetupError(`The compare report of ${outcome.case} in ${outcome.runFolder} is not the one its step recorded${why}; another run may have `
      + "compared that capture again. Run the compare step again.");
  }
}

/** Compares one captured case in the CPU pool, or reuses a completed compare with the same inputs. */
export class CompareStep {
  constructor(private readonly dependencies: CompareDependencies) {}

  async run(context: StepContext, capture: StepOutcome): Promise<StepOutcome> {
    const { paths, store, log } = this.dependencies;
    const label = `compare ${capture.case}`;
    const changed = await this.dependencies.changedInputs(paths, context.options, context.fingerprints, compareInputs);
    if (changed.length > 0) {
      throw new SetupError(`Inputs changed since the thread started (${changed.join(", ")}); start a new thread.`);
    }
    const stepKey = compareKey(capture.key, await sha256File(join(capture.runFolder, "results.json")),
      await sha256File(join(capture.runFolder, "coverage.json")), context.options, context.fingerprints);
    const found = await store.lookup("compare", stepKey.key);
    if (found.found === "valid") {
      log(`${label}: reusing the report in ${found.record.runFolder} from thread ${found.record.threadId} (status ${found.record.status}).`);
      return { case: capture.case, status: found.record.status, runFolder: found.record.runFolder, key: stepKey.key, reusedFrom: found.record.threadId };
    }
    if (context.mode === "reuse-only") {
      const why = found.found === "stale" ? `its record is stale: ${found.reason}` : "there is no completed compare with these inputs";
      throw new SetupError(`${label}: ${why}; run the compare node first.`);
    }
    if (found.found === "stale") log(`${label}: comparing again because ${found.reason}.`);

    const args = [join(paths.compareTools, "Parity.Compare.dll"), "--run", capture.runFolder];
    if (context.options.noOcr) args.push("--no-ocr");
    if (context.options.tessdata !== null) args.push("--tessdata", context.options.tessdata);
    const exit = await this.dependencies.host.run({
      resource: "cpu", label, command: "dotnet", args, ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    const status = finishedStatus(exit);
    if (status === null) throw new SetupError(`${label} exited with ${exit}, not with 0, 1 or 2, so its analysis did not finish.`);
    checkReport(capture.runFolder, label, status);
    if (status !== 2) {
      await store.save({ kind: "compare", key: stepKey.key, keyLines: [...stepKey.lines], case: capture.case, runFolder: capture.runFolder, status, threadId: context.threadId },
        [reportPath.replaceAll("\\", "/")], this.dependencies.now());
    }
    return { case: capture.case, status, runFolder: capture.runFolder, key: stepKey.key, reusedFrom: null };
  }
}
