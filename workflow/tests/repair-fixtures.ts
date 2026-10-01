import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AttemptBuild, AttemptBuildRequest, NarrowCheck, NarrowCheckRequest } from "../src/repair/attempt-host.js";
import type { RepairOutput } from "../src/repair/repair-schemas.js";
import type { JobCall, Reply } from "./diagnosis-harness.js";

const examples = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "examples");

/** What the fake build does: exit with a status, or run until its signal stops it. */
export type BuildBehaviour = number | "hang";

/** What the fake narrow check observes per `case/capture` (anything not named passes), and its exit status unless derived. */
export type CheckBehaviour = {
  readonly observed?: Readonly<Record<string, "passed" | "failed">>;
  readonly status?: 0 | 1 | 2 | 3;
  /** Runs until the run's signal stops it, calling this once it started. */
  readonly hang?: () => void;
};

/** A fake host for repair attempts: builds and narrow checks are recorded and answered from a script. */
export class FakeRepairHost {
  readonly builds: AttemptBuildRequest[] = [];
  readonly checks: NarrowCheckRequest[] = [];
  /** What the source copy held when its build started, for each build. */
  readonly builtSources: string[] = [];

  constructor(private readonly root: string, public buildBehaviour: BuildBehaviour = 0, public checkBehaviour: CheckBehaviour = {}) {}

  readonly build: AttemptBuild = async (request) => {
    this.builds.push(request);
    this.builtSources.push(readFileSync(join(request.source, "Chummer", "frmCreate.cs"), "utf8"));
    mkdirSync(dirname(request.log), { recursive: true });
    writeFileSync(request.log, `build of ${request.source}\n`);
    if (this.buildBehaviour === "hang") {
      return new Promise<number>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error(`${request.label}: stopped`)), { once: true }));
    }
    return this.buildBehaviour;
  };

  readonly narrowCheck: NarrowCheck = async (request) => {
    this.checks.push(request);
    const hang = this.checkBehaviour.hang;
    if (hang !== undefined) {
      hang();
      return new Promise((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(new Error(`${request.label}: stopped`)), { once: true }));
    }
    const runFolder = join(this.root, "narrow-runs", String(this.checks.length));
    mkdirSync(runFolder, { recursive: true });
    const observed = this.checkBehaviour.observed ?? {};
    const results = request.cases.flatMap((name) => request.captures.map((capture) => {
      const failed = observed[`${name}/${capture}`] === "failed";
      return { case: name, characterFile: `${name}.chum`, mode: "build" as const, capture, passed: !failed, reason: failed ? "visual-difference" as const : "within-threshold" as const, difference: failed ? 0.01 : 0 };
    }));
    writeFileSync(join(runFolder, "results.json"), JSON.stringify({ runId: "narrow", threshold: 0.00004, results }));
    const coverage = JSON.parse(readFileSync(join(examples, "parity-execution-coverage.example.json"), "utf8")) as { valid: boolean; invalidReasons: string[] };
    const status = this.checkBehaviour.status ?? (results.some((row) => !row.passed) ? 1 : 0);
    if (status === 3) throw new Error("repair check exited with 3, so its run did not finish.");
    coverage.valid = status !== 2;
    coverage.invalidReasons = status === 2 ? ["failure:build-alpha/candidate"] : [];
    writeFileSync(join(runFolder, "coverage.json"), JSON.stringify(coverage));
    return { status, runFolder };
  };
}

/** A repair answer that edits files of its working folder first, like a model with edit tools. */
export function patchedReply(edits: Readonly<Record<string, string>>, answer: Partial<RepairOutput> = {}): (call: JobCall) => Reply {
  return (call) => {
    for (const [path, text] of Object.entries(edits)) {
      mkdirSync(dirname(join(call.workspace.folder, path)), { recursive: true });
      writeFileSync(join(call.workspace.folder, path), text);
    }
    return { answer: { outcome: "patched", reason: "The label was moved back.", summary: "Restored the location.", files: Object.keys(edits), ...answer } };
  };
}

/** The fixture source's `Chummer/frmCreate.cs` with a repair applied. */
export const repairedSource = "class frmCreate { int restored; }";
