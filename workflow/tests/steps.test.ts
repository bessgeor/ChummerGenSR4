import { deepStrictEqual, equal, notEqual, ok, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { fixtureCaseFile, planCases, type PlannedCase } from "../src/cases/case-plan.js";
import { startOptions, suiteFileName } from "../src/cases/suite.js";
import { parseArguments } from "../src/options/arguments.js";
import type { HostCommand, HostRunner } from "../src/host/host-runner.js";
import { SetupError } from "../src/host/setup-error.js";
import type { RunOptions } from "../src/options/run-options.js";
import { workflowPaths } from "../src/paths.js";
import { CaptureStep } from "../src/steps/capture-step.js";
import { CompareStep, requireCurrentReport } from "../src/steps/compare-step.js";
import { sha256File } from "../src/steps/fingerprint.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { currentFingerprints, type ChangeableInput, type InputFingerprints } from "../src/steps/input-fingerprints.js";
import { captureKey, compareKey } from "../src/steps/step-keys.js";
import type { StepContext, StepMode } from "../src/steps/step-outcome.js";
import { StepStore } from "../src/steps/step-store.js";

const fingerprints: InputFingerprints = {
  canonicalExecutable: "exe", canonicalSupport: "support", canonicalSupportStat: "stat", tessdata: "default", candidate: "candidate", overlay: "none",
  captureTools: "ct", compareTools: "mt", candidateSource: "src", environment: "env",
};

const options: RunOptions = {
  caseFile: "cases.json", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: "C:/cache",
  canonicalCacheSource: "option", noOcr: false, tessdata: null, only: null, recapture: false,
  diagnosis: false, agents: resolveAgentSettings(undefined), unattended: false, certificates: "certificates", repair: null, widening: false,
};

function parseStart(args: string[]) {
  const command = parseArguments(args);
  if (command.kind !== "start") throw new Error(`expected start, got ${command.kind}`);
  return command.arguments;
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "workflow-steps-"));
}

function plannedCase(root: string): PlannedCase {
  const fixturePath = join(root, "Alpha.chum");
  writeFileSync(fixturePath, "fixture");
  return {
    name: "build-Alpha", characterFile: "Alpha.chum", fixturePath, mode: "build",
    actions: [{ type: "capture", name: "common" }], startupDelaySeconds: 3, settleMilliseconds: 300, captureFilter: null,
  };
}

/** Plays the capture runner and the comparer: writes their files and returns scripted statuses. */
class FakeHost implements HostRunner {
  readonly commands: HostCommand[] = [];
  readonly lanes = ["desktop"];
  environment = "e".repeat(64);
  environmentReads = 0;
  /** Holds every capture until it is released. */
  gate: Promise<void> | null = null;
  captureStatus = 1;
  compareStatus = 1;
  reportStatus = "differences";
  screenshots = false;
  extraCase: string | null = null;
  private runs = 0;

  constructor(private readonly root: string) {}

  private coveredCases(planned: string): { case: string }[] {
    return [{ case: planned }, ...(this.extraCase === null ? [] : [{ case: this.extraCase }])];
  }

  async run(command: HostCommand): Promise<number> {
    const option = (name: string) => command.args[command.args.indexOf(name) + 1]!;
    if (command.args.includes("--environment-fingerprint-file")) {
      this.environmentReads++;
      writeFileSync(option("--environment-fingerprint-file"), `${this.environment}\n`);
      return 0;
    }
    this.commands.push(command);
    if (command.resource === "desktop") {
      await this.gate;
      const runFolder = join(this.root, "runs", `run-${++this.runs}`);
      mkdirSync(runFolder, { recursive: true });
      for (const file of ["summary.json", "results.json"]) writeFileSync(join(runFolder, file), `${file} ${this.runs}`);
      writeFileSync(join(runFolder, "coverage.json"), JSON.stringify({ cases: this.coveredCases(option("--case")), run: this.runs }));
      if (this.screenshots) {
        for (const side of ["canonical", "candidate"]) {
          mkdirSync(join(runFolder, "captures", "build-Alpha", side), { recursive: true });
          writeFileSync(join(runFolder, "captures", "build-Alpha", side, "common.png"), `png ${side} ${this.runs}`);
        }
      }
      if (command.args.includes("--ui-tree")) {
        mkdirSync(join(runFolder, "ui-trees", "build-Alpha"), { recursive: true });
        writeFileSync(join(runFolder, "ui-trees", "build-Alpha", "common.json"), `tree ${this.runs}`);
      }
      writeFileSync(option("--run-folder-file"), runFolder);
      return this.captureStatus;
    }
    mkdirSync(join(option("--run"), "compare"), { recursive: true });
    writeFileSync(join(option("--run"), "compare", "report.json"), JSON.stringify({ status: this.reportStatus }));
    return this.compareStatus;
  }
}

function setup(root = scratch()) {
  const host = new FakeHost(root);
  const lines: string[] = [];
  const dependencies = {
    paths: workflowPaths(root), host, store: new StepStore(join(root, "steps")), log: (line: string) => lines.push(line),
    now: () => new Date("2026-10-01T00:00:00Z"),
  };
  let apps = { ...fingerprints };
  const changedInputs = async (_paths: unknown, _options: unknown, expected: InputFingerprints, names: readonly ChangeableInput[]) =>
    names.filter((name) => apps[name] !== expected[name]);
  const capture = new CaptureStep({ ...dependencies, createScratchFolder, changedInputs });
  const compare = new CompareStep({ ...dependencies, changedInputs });
  const context = (mode: StepMode = "run", threadId = "t1", runOptions: RunOptions = options): StepContext =>
    ({ threadId, options: runOptions, fingerprints, mode });
  return { root, host, lines, capture, compare, context, setApps: (value: typeof apps) => { apps = value; } };
}

test("the capture key changes with every input", () => {
  const root = scratch();
  const item = plannedCase(root);
  const environment = "e".repeat(64);
  const base = captureKey(item, "fixture", environment, options, fingerprints).key;
  const variants = [
    captureKey({ ...item, name: "other" }, "fixture", environment, options, fingerprints),
    captureKey({ ...item, actions: [] }, "fixture", environment, options, fingerprints),
    captureKey({ ...item, settleMilliseconds: 1 }, "fixture", environment, options, fingerprints),
    captureKey({ ...item, captureFilter: ["common"] }, "fixture", environment, options, fingerprints),
    captureKey(item, "other", environment, options, fingerprints),
    captureKey(item, "fixture", "f".repeat(64), options, fingerprints),
    captureKey(item, "fixture", environment, { ...options, threshold: 0.1 }, fingerprints),
    captureKey(item, "fixture", environment, { ...options, canonicalCache: null }, fingerprints),
    ...(Object.keys(fingerprints) as (keyof InputFingerprints)[]).filter((name) => name !== "compareTools" && name !== "tessdata" && name !== "canonicalSupportStat" && name !== "candidateSource" && name !== "environment")
      .map((name) => captureKey(item, "fixture", environment, options, { ...fingerprints, [name]: "changed" })),
  ];
  for (const variant of variants) notEqual(variant.key, base);
  equal(captureKey(item, "fixture", environment, { ...options, canonicalCache: "D:/elsewhere" }, fingerprints).key, base);
  equal(captureKey(item, "fixture", environment, options, { ...fingerprints, compareTools: "changed" }).key, base);
  equal(captureKey(item, "fixture", environment, options, { ...fingerprints, canonicalSupportStat: "changed" }).key, base);
  // The recorded source guards diagnosis only; it is not part of a step key, so recorded steps stay valid.
  equal(captureKey(item, "fixture", environment, options, { ...fingerprints, candidateSource: "changed" }).key, base);
  // The environment enters a key as its own argument, read again for every capture; the thread's is only a guard for later runs.
  equal(captureKey(item, "fixture", environment, options, { ...fingerprints, environment: "changed" }).key, base);
  const compareBase = compareKey("k", "r", "c", options, fingerprints).key;
  for (const variant of [compareKey("x", "r", "c", options, fingerprints), compareKey("k", "x", "c", options, fingerprints),
    compareKey("k", "r", "x", options, fingerprints), compareKey("k", "r", "c", { ...options, noOcr: true }, fingerprints),
    compareKey("k", "r", "c", options, { ...fingerprints, tessdata: "changed" }), compareKey("k", "r", "c", options, { ...fingerprints, compareTools: "x" })]) {
    notEqual(variant.key, compareBase);
  }
});

test("a completed capture and compare are reused by a later thread with the same inputs", async () => {
  const { root, host, capture, compare, context } = setup();
  const item = plannedCase(root);
  const first = await capture.run(context(), item);
  const compared = await compare.run(context(), first);
  deepStrictEqual([first.status, first.reusedFrom, compared.status, compared.reusedFrom], [1, null, 1, null]);
  const [captureCommand, compareCommand] = host.commands;
  deepStrictEqual([captureCommand!.resource, compareCommand!.resource], ["desktop", "cpu"]);
  ok(captureCommand!.args.includes("--canonical-cache"));
  deepStrictEqual(compareCommand!.args.slice(1), ["--run", first.runFolder]);

  const again = await capture.run(context("run", "t2"), item);
  const comparedAgain = await compare.run(context("run", "t2"), again);
  equal(host.commands.length, 2);
  deepStrictEqual([again.runFolder, again.reusedFrom, comparedAgain.reusedFrom], [first.runFolder, "t1", "t1"]);
});

test("a changed output makes the step run again", async () => {
  const { root, host, lines, capture, context } = setup();
  const item = plannedCase(root);
  const first = await capture.run(context(), item);
  writeFileSync(join(first.runFolder, "results.json"), "edited");
  const second = await capture.run(context(), item);
  equal(host.commands.length, 2);
  notEqual(second.runFolder, first.runFolder);
  ok(lines.some((line) => line.includes("changed since it was recorded")));
});

test("steps with execution or analysis failures are not recorded", async () => {
  const { root, host, capture, compare, context } = setup();
  const item = plannedCase(root);
  host.captureStatus = 2;
  const failed = await capture.run(context(), item);
  equal(failed.status, 2);
  await capture.run(context(), item);
  equal(host.commands.filter((command) => command.resource === "desktop").length, 2);
  host.compareStatus = 2;
  host.reportStatus = "analysis-failures";
  await compare.run(context(), failed);
  await compare.run(context(), failed);
  equal(host.commands.filter((command) => command.resource === "cpu").length, 2);
});

test("setup errors from the tools and missing outputs are setup errors and are not recorded", async () => {
  const { root, host, capture, compare, context } = setup();
  const item = plannedCase(root);
  host.captureStatus = 3;
  await rejects(capture.run(context(), item), SetupError);
  const key = captureKey(item, await sha256File(item.fixturePath), "e".repeat(64), options, fingerprints).key;
  equal((await new StepStore(join(root, "steps")).lookup("capture", key)).found, "none");
  host.captureStatus = 0;
  const ok0 = await capture.run(context(), item);
  host.compareStatus = 0;
  host.reportStatus = "differences";
  await rejects(compare.run(context(), ok0), /has status 'differences'/);
  host.compareStatus = 3;
  await rejects(compare.run(context(), ok0), SetupError);
  equal(host.commands.filter((command) => command.resource === "cpu").length, 2);
});

test("reuse-only steps fail with a setup error naming the case when nothing is recorded", async () => {
  const { root, capture, context } = setup();
  await rejects(capture.run(context("reuse-only"), plannedCase(root)), (error: Error) => error instanceof SetupError && error.message.includes("build-Alpha"));
});

test("a capture fails when the apps or the tools changed since the thread started", async () => {
  const { root, host, capture, context, setApps } = setup();
  const item = plannedCase(root);
  for (const name of ["candidate", "captureTools", "canonicalExecutable", "canonicalSupportStat", "overlay"] as const) {
    setApps({ ...fingerprints, [name]: "rebuilt" });
    await rejects(capture.run(context(), item), new RegExp(`Inputs changed since the thread started \\(${name}\\)`));
  }
  equal(host.commands.length, 0);
});

test("a compare fails when the comparer changed since the thread started", async () => {
  const { root, host, capture, compare, context, setApps } = setup();
  const captured = await capture.run(context(), plannedCase(root));
  setApps({ ...fingerprints, compareTools: "rebuilt" });
  await rejects(compare.run(context(), captured), /compareTools/);
  equal(host.commands.filter((command) => command.resource === "cpu").length, 0);
});

test("a changed environment is a different capture step", async () => {
  const { root, host, capture, context } = setup();
  const item = plannedCase(root);
  const first = await capture.run(context(), item);
  host.environment = "a".repeat(64);
  const second = await capture.run(context("run", "t2"), item);
  equal(second.reusedFrom, null);
  notEqual(second.key, first.key);
  equal(host.commands.length, 2);
  host.environment = "not a hash";
  await rejects(capture.run(context(), item), /not a SHA-256/);
});

test("--recapture runs the step again and records the new run", async () => {
  const { root, host, lines, capture, context } = setup();
  const item = plannedCase(root);
  const first = await capture.run(context(), item);
  const again = await capture.run(context("run", "t2", { ...options, recapture: true }), item);
  equal(host.commands.length, 2);
  notEqual(again.runFolder, first.runFolder);
  ok(lines.some((line) => line.includes("--recapture")));
  const reused = await capture.run(context("run", "t3"), item);
  deepStrictEqual([reused.runFolder, reused.reusedFrom], [again.runFolder, "t2"]);
});

test("a capture recorded from the fixture case file is reused for the same case planned from a thread's suite", async () => {
  const { root, host, capture, context } = setup();
  mkdirSync(join(root, "parity", "fixtures", "characters"), { recursive: true });
  writeFileSync(join(root, "parity", "fixtures", "characters", "Alpha.chum"), "fixture");
  mkdirSync(join(root, "parity", "cases"), { recursive: true });
  writeFileSync(fixtureCaseFile(root), JSON.stringify({
    startupDelaySeconds: 3, settleMilliseconds: 300, sequences: {}, buildActions: [{ type: "capture", name: "common" }], careerActions: [],
    characters: [{ path: "../fixtures/characters/Alpha.chum", mode: "build" }],
  }));
  const fixtureOptions = { ...options, caseFile: fixtureCaseFile(root) };
  const first = await capture.run(context("run", "t1", fixtureOptions), planCases(fixtureOptions.caseFile, [], []).cases[0]!);

  const suiteOptions = startOptions(parseStart([]), {}, { LOCALAPPDATA: root }, root, join(root, "threads", "t2"));
  equal(suiteOptions.caseFile, join(root, "threads", "t2", suiteFileName));
  const fromSuite = await capture.run(context("run", "t2", { ...options, caseFile: suiteOptions.caseFile }), planCases(suiteOptions.caseFile, [], []).cases[0]!);
  deepStrictEqual([fromSuite.runFolder, fromSuite.reusedFrom, host.commands.length], [first.runFolder, "t1", 1]);
});

test("a capture step records the candidate's UI trees and keeps them with its outputs", async () => {
  const { root, host, lines, capture, context } = setup();
  const item = plannedCase(root);
  const first = await capture.run(context(), item);
  ok(host.commands[0]!.args.includes("--ui-tree"), host.commands[0]!.args.join(" "));
  // Records made before capture runs recorded trees have the earlier format, so they miss.
  ok(captureKey(item, "fixture", "e".repeat(64), options, fingerprints).lines.includes("format:capture/2"));
  equal((await capture.run(context("run", "t2"), item)).reusedFrom, "t1");
  writeFileSync(join(first.runFolder, "ui-trees", "build-Alpha", "common.json"), "edited");
  const second = await capture.run(context("run", "t3"), item);
  notEqual(second.runFolder, first.runFolder);
  ok(lines.some((line) => line.includes("common.json") && line.includes("changed since it was recorded")), lines.join("\n"));
});

test("a record is stale when a screenshot changed or disappeared", async () => {
  const { root, host, lines, capture, context } = setup();
  const item = plannedCase(root);
  host.screenshots = true;
  const first = await capture.run(context(), item);
  writeFileSync(join(first.runFolder, "captures", "build-Alpha", "canonical", "common.png"), "edited");
  const second = await capture.run(context(), item);
  notEqual(second.runFolder, first.runFolder);
  ok(lines.some((line) => line.includes("common.png") && line.includes("changed since it was recorded")));
  rmSync(join(second.runFolder, "captures", "build-Alpha", "candidate", "common.png"));
  const third = await capture.run(context(), item);
  notEqual(third.runFolder, second.runFolder);
  ok(lines.some((line) => line.includes("no longer exists")));
});
test("a report another run replaced is not read by triage", async () => {
  const { root, host, capture, compare, context } = setup();
  const captured = await capture.run(context(), plannedCase(root));
  const compared = await compare.run(context(), captured);
  const store = new StepStore(join(root, "steps"));
  await requireCurrentReport(store, compared);
  writeFileSync(join(captured.runFolder, "compare", "report.json"), JSON.stringify({ status: "clear" }));
  await rejects(requireCurrentReport(store, compared), (error: Error) => error instanceof SetupError && /changed since it was recorded/.test(error.message) && error.message.includes(captured.runFolder));
  await requireCurrentReport(store, { ...compared, status: 2 });
  await rejects(requireCurrentReport(store, { ...compared, key: "0".repeat(64) }), /another run may have compared/);
  equal(host.commands.length, 2);
});
test("a capture that also ran another case is a setup error and is not recorded", async () => {
  const { root, host, capture, context } = setup();
  const item = plannedCase(root);
  host.extraCase = "build-career-Alpha";
  await rejects(capture.run(context(), item), (error: Error) => error instanceof SetupError && /ran 2 cases \(build-Alpha, build-career-Alpha\)/.test(error.message));
  host.extraCase = null;
  const key = captureKey(item, await sha256File(item.fixturePath), host.environment, options, fingerprints).key;
  equal((await new StepStore(join(root, "steps")).lookup("capture", key)).found, "none");
  equal((await capture.run(context(), item)).reusedFrom, null);
});
test("the comparer's fingerprint covers its native files and language data but not debug symbols, and a --tessdata folder is fingerprinted by content", async () => {
  const root = scratch();
  const paths = workflowPaths(root);
  const files: Record<string, string> = {
    "Parity.Compare.dll": "a", "Parity.Compare.pdb": "s", "Tesseract.dll": "t", "x64/tesseract50.dll": "n", "tessdata/eng.traineddata": "d",
  };
  const write = (name: string, content: string) => {
    mkdirSync(join(paths.compareTools, name, ".."), { recursive: true });
    writeFileSync(join(paths.compareTools, name), content);
  };
  for (const [name, content] of Object.entries(files)) write(name, content);
  const tessdata = join(root, "tessdata-elsewhere");
  mkdirSync(tessdata);
  writeFileSync(join(tessdata, "eng.traineddata"), "one");
  const read = async (tessdataFolder: string | null = null) =>
    currentFingerprints(paths, { settingsOverlay: null, tessdata: tessdataFolder }, ["compareTools", "tessdata"]);
  const base = await read();
  equal(base.tessdata, "default");
  write("Parity.Compare.pdb", "other symbols");
  equal((await read()).compareTools, base.compareTools);
  for (const name of ["Tesseract.dll", "x64/tesseract50.dll", "tessdata/eng.traineddata", "Parity.Compare.dll"]) {
    write(name, "changed");
    notEqual((await read()).compareTools, base.compareTools, name);
    write(name, files[name]!);
    equal((await read()).compareTools, base.compareTools);
  }
  const given = await read(tessdata);
  notEqual(given.tessdata, "default");
  writeFileSync(join(tessdata, "eng.traineddata"), "two");
  notEqual((await read(tessdata)).tessdata, given.tessdata);
});

test("captures that run together share one reading of the environment, and the next group reads again", async () => {
  const { host, capture, context, root } = setup();
  const alpha = plannedCase(root);
  const beta = { ...alpha, name: "build-Beta" };
  let release: () => void = () => {};
  host.gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = capture.run(context(), alpha);
  while (host.environmentReads === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  // The second capture starts while the first drives its lane.
  const second = capture.run(context(), beta);
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await Promise.all([first, second]);
  equal(host.environmentReads, 1);
  await capture.run(context(), { ...alpha, name: "build-Gamma" });
  equal(host.environmentReads, 2);
});