import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentFailure, Effort, Provider } from "../agents/agent-job.js";
import type { RepairStage } from "../evals/eval-record.js";
import { renameWithRetry } from "../host/rename-with-retry.js";
import { SetupError } from "../host/setup-error.js";
import type { CheckRow } from "./attempt-host.js";
import type { CheckExecution } from "./cluster-repair.js";
import type { PatchFile } from "./patch.js";
import type { PlannedWork } from "./planned-attempt.js";
import type { RepairOutput } from "./repair-schemas.js";

/** `attempt.json`: everything about one finished attempt. */
export type AttemptDocument = {
  readonly schemaVersion: 1;
  readonly threadId: string;
  readonly clusterId: string;
  readonly attempt: number;
  readonly recordId: string;
  readonly contextHash: string;
  /** The attempt's branch, `workflow/<thread>/repair/<cluster>/attempt-<n>`. */
  readonly branch: string;
  /** The attempt commit on that branch, or null when the jobs changed nothing. */
  readonly commit: string | null;
  readonly snapshotIdentity: string;
  readonly hypothesisRecord: string;
  readonly agent: { readonly provider: Provider; readonly model: string | null; readonly effort: Effort };
  readonly answer: RepairOutput | null;
  readonly failure: AgentFailure | null;
  readonly patch: { readonly files: readonly PatchFile[]; readonly added: number; readonly removed: number } | null;
  readonly guard: readonly string[];
  readonly build: { readonly status: number; readonly durationMs: number; readonly log: string | null } | null;
  readonly check: (CheckExecution & { readonly rows: readonly CheckRow[] }) | null;
  readonly outcome: "passed" | "rejected";
  readonly stage: RepairStage | null;
  readonly reason: string | null;
  readonly startedUtc: string;
  readonly finishedUtc: string;
  /** In a thread with fix changes: the plan and each subtask; absent otherwise. */
  readonly planned?: PlannedWork;
};

/** Where an attempt's archive is: `repair/<cluster>/attempt-<n>/` in the thread's folder. */
export function attemptFolder(threadFolder: string, clusterId: string, attempt: number): string {
  return join(threadFolder, "repair", clusterId, `attempt-${attempt}`);
}

export type ArchiveInput = {
  readonly folder: string;
  readonly document: AttemptDocument;
  /** The unified diff of the patch, empty when nothing changed. */
  readonly patchText: string;
  /** The layout `computePatch` wrote (`before/`, `after/`), or null when no patch was computed. */
  readonly layout: string | null;
  /** The build's log file, or null when no build ran or it wrote none. */
  readonly buildLog: string | null;
  /** More files by their path in the archive, such as the draft of a fix change. */
  readonly extra?: Readonly<Record<string, string>>;
};

/**
 * Writes an attempt's archive under a temporary name beside its folder and renames it when complete, so a folder
 * that exists is whole. An existing folder of the same name is a setup error: an attempt number is never reused.
 */
export function writeArchive(input: ArchiveInput): void {
  if (existsSync(input.folder)) throw new SetupError(`The repair archive ${input.folder} exists already; an attempt is archived once.`);
  const partial = `${input.folder}.partial-${randomBytes(4).toString("hex")}`;
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, "attempt.json"), `${JSON.stringify(input.document, null, 2)}\n`);
  writeFileSync(join(partial, "patch.diff"), input.patchText);
  if (input.layout !== null) {
    for (const side of ["before", "after"]) {
      const source = join(input.layout, side);
      if (existsSync(source)) cpSync(source, join(partial, "files", side), { recursive: true });
    }
  }
  if (input.buildLog !== null && existsSync(input.buildLog)) cpSync(input.buildLog, join(partial, "build.log"));
  for (const [path, content] of Object.entries(input.extra ?? {})) {
    mkdirSync(dirname(join(partial, path)), { recursive: true });
    writeFileSync(join(partial, path), content);
  }
  mkdirSync(dirname(input.folder), { recursive: true });
  renameWithRetry(partial, input.folder);
}
