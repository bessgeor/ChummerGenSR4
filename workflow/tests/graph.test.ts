import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import { buildWorkflowGraph, nodeMode, type DiagnosisSteps, type RepairSteps, type WorkflowSteps } from "../src/graph/workflow-graph.js";
import { exitStatus, runWorkflow, type RunDependencies } from "../src/graph/run-workflow.js";
import { SetupError } from "../src/host/setup-error.js";
import type { Arguments, NodeName } from "../src/options/arguments.js";
import type { RunOptions } from "../src/options/run-options.js";
import type { CompareReport } from "../../contracts/generated/typescript/parity-compare-report.js";
import type { CaseDetails } from "../src/steps/case-details.js";
import type { InputFingerprints } from "../src/steps/input-fingerprints.js";
import type { StepContext, StepOutcome } from "../src/steps/step-outcome.js";

const fingerprints: InputFingerprints = {
  canonicalExecutable: "e", canonicalSupport: "s", canonicalSupportStat: "ss", tessdata: "default", candidate: "c", overlay: "none", captureTools: "ct", compareTools: "mt", candidateSource: "src",
};

function plannedCase(name: string): PlannedCase {
  return { name, characterFile: `${name}.chum`, fixturePath: `${name}.chum`, mode: "build", actions: [], startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null };
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Records every call with its mode and the moments it started and ended; fails where told to. */
class FakeSteps implements WorkflowSteps {
  readonly events: string[] = [];
  readonly calls: string[] = [];
  captureStatus: Record<string, 0 | 1 | 2> = {};
  compareStatus: Record<string, 0 | 1 | 2> = {};
  failCapture: string | null = null;
  buildCandidate: boolean[] = [];
  buildSignals: (AbortSignal | undefined)[] = [];
  onBuild: ((signal: AbortSignal | undefined) => Promise<void>) | null = null;

  async build(_options: RunOptions, buildCandidate: boolean, signal?: AbortSignal): Promise<InputFingerprints> {
    this.buildCandidate.push(buildCandidate);
    this.buildSignals.push(signal);
    await this.onBuild?.(signal);
    return fingerprints;
  }

  async capture(context: StepContext, item: PlannedCase): Promise<StepOutcome> {
    this.calls.push(`capture ${item.name} ${context.mode}`);
    this.events.push(`capture ${item.name} start`);
    await delay(30);
    if (this.failCapture === item.name) throw new SetupError(`capture ${item.name} exited with 3`);
    this.events.push(`capture ${item.name} end`);
    return { case: item.name, status: this.captureStatus[item.name] ?? 0, runFolder: `runs/${item.name}`, key: `k-${item.name}`, reusedFrom: null };
  }

  async compare(context: StepContext, capture: StepOutcome): Promise<StepOutcome> {
    this.calls.push(`compare ${capture.case} ${context.mode}`);
    this.events.push(`compare ${capture.case} start`);
    await delay(20);
    this.events.push(`compare ${capture.case} end`);
    return { ...capture, status: this.compareStatus[capture.case] ?? 0 };
  }

  async triage(input: { plan: readonly PlannedCase[] }) {
    this.calls.push("triage");
    return { path: "triage.json", discrepancies: 0, clusters: 0, newClusters: 0, otherFindings: 0, cases: input.plan.length };
  }
}

/** What the run folder of each fake capture would say: case `a` has invalid coverage, case `b` valid coverage from the cache. */
function fakeDetails(runFolder: string, compared: boolean): CaseDetails {
  const valid = runFolder !== "runs/a";
  return {
    execution: {
      coverageValid: valid, invalidReasons: valid ? [] : ["an action failed"], contiguous: true, failures: valid ? 0 : 1,
      optionalAbsent: 1, canonicalSource: valid ? "cache" : "live",
    },
    visual: {
      passed: 1, failed: valid ? 0 : 2,
      report: compared ? {
        status: "clear", totals: { discrepancies: 0, groups: 0 },
        completeness: { totals: { planned: 5, reported: 3, optionalAbsent: 1, analysisFailed: 0, filtered: 0, executionLost: 0, unaccounted: 0 } },
      } as unknown as CompareReport : null,
    },
  };
}

/** These runs turn diagnosis off; diagnosis is tested with its own harness. */
const noDiagnosis: DiagnosisSteps = {
  prepare: () => Promise.reject(new Error("diagnosis is off")),
  hypothesize: () => Promise.reject(new Error("diagnosis is off")),
  challenge: () => Promise.reject(new Error("diagnosis is off")),
  waitForQuota: () => Promise.reject(new Error("diagnosis is off")),
  check: () => Promise.reject(new Error("diagnosis is off")),
  finish: () => {
    throw new Error("diagnosis is off");
  },
};

const noRepair: RepairSteps = {
  prepare: () => {
    throw new Error("repair is off");
  },
  repair: () => Promise.reject(new Error("repair is off")),
  waitForQuota: () => Promise.reject(new Error("repair is off")),
  finish: () => {
    throw new Error("repair is off");
  },
};

const baseArguments: Arguments = {
  cases: [], captures: [], settingsOverlay: null, threshold: null, caseFile: null, canonicalCache: null,
  liveCanonical: false, noOcr: false, tessdata: null, only: null, recapture: false, noDiagnosis: false, noRepair: false, unattended: false,
};

function harness(cases: string[], steps = new FakeSteps(), checkpointer = new MemorySaver(), signal?: AbortSignal) {
  const graph = buildWorkflowGraph(steps, noDiagnosis, noRepair).compile({ checkpointer, store: new InMemoryStore() });
  const lines: string[] = [];
  const readCalls: [string, boolean][] = [];
  const dependencies: RunDependencies = {
    graph,
    resolveOptions: (command) => ({
      caseFile: "cases.json", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: "cache",
      canonicalCacheSource: "default", noOcr: false, tessdata: null, only: command.arguments.only, recapture: false,
      diagnosis: false, agents: resolveAgentSettings(undefined), unattended: false, certificates: "certificates", repair: null,
    }),
    planCases: () => ({ cases: cases.map(plannedCase), excluded: [] }),
    certificateProblems: () => [],
    readCase: (runFolder, compared) => {
      readCalls.push([runFolder, compared]);
      return fakeDetails(runFolder, compared);
    },
    log: (line) => lines.push(line),
    now: () => new Date("2026-10-01T12:00:00Z"),
    ...(signal === undefined ? {} : { signal }),
  };
  const startRun = (only: NodeName | null = null) => runWorkflow({ kind: "start", arguments: { ...baseArguments, only } }, dependencies);
  const threadId = () => /Thread (wf-\S+):/.exec(lines.join("\n"))?.[1] ?? "";
  return { steps, lines, dependencies, startRun, threadId, checkpointer, readCalls };
}

test("compare of each case overlaps the capture of the next, and triage runs last", async () => {
  const { steps, startRun } = harness(["a", "b", "c"]);
  equal(await startRun(), 0);
  const at = (event: string) => steps.events.indexOf(event);
  ok(at("compare a start") < at("capture b end") && at("capture b start") < at("compare a end"));
  ok(at("compare b start") < at("capture c end") && at("capture c start") < at("compare b end"));
  deepStrictEqual(steps.calls.at(-1), "triage");
  deepStrictEqual(steps.buildCandidate, [true]);
});

test("the exit status is the highest capture and compare status", async () => {
  const steps = new FakeSteps();
  steps.captureStatus = { a: 1, b: 2 };
  steps.compareStatus = { a: 1 };
  const { startRun } = harness(["a", "b"], steps);
  equal(await startRun(), 2);
  equal(exitStatus({ captures: {}, compares: {} }), 0);
});

test("a setup error stops the run with status 3 and the thread resumes without repeating finished steps", async () => {
  const steps = new FakeSteps();
  steps.failCapture = "b";
  const run = harness(["a", "b", "c"], steps);
  equal(await run.startRun(), 3);
  ok(run.lines.some((line) => line.includes("--resume")));
  ok(!steps.calls.some((call) => call.startsWith("capture c")));

  steps.failCapture = null;
  steps.calls.length = 0;
  equal(await runWorkflow({ kind: "resume", threadId: run.threadId() }, run.dependencies), 0);
  ok(!steps.calls.includes("capture a run"), steps.calls.join(", "));
  deepStrictEqual(steps.calls.filter((call) => call.startsWith("capture")), ["capture b run", "capture c run"]);
  deepStrictEqual(steps.calls.at(-1), "triage");
});

test("a finished or unknown thread cannot be resumed", async () => {
  const run = harness(["a"]);
  equal(await run.startRun(), 0);
  const calls = run.steps.calls.length;
  equal(await runWorkflow({ kind: "resume", threadId: run.threadId() }, run.dependencies), 3);
  ok(run.lines.some((line) => line.includes("already finished")));
  equal(await runWorkflow({ kind: "resume", threadId: "wf-unknown" }, run.dependencies), 3);
  ok(run.lines.some((line) => line.includes("no thread wf-unknown")));
  equal(run.steps.calls.length, calls);
});

test("--only runs one node, reuses the nodes before it and skips the nodes after it", async () => {
  deepStrictEqual([nodeMode("capture", "triage"), nodeMode("compare", "triage"), nodeMode("triage", "capture")], ["reuse-only", "reuse-only", "skip"]);
  const capture = harness(["a", "b"]);
  equal(await capture.startRun("capture"), 0);
  deepStrictEqual(capture.steps.calls, ["capture a run", "capture b run"]);
  deepStrictEqual(capture.steps.buildCandidate, [true]);

  const compare = harness(["a"]);
  equal(await compare.startRun("compare"), 0);
  deepStrictEqual(compare.steps.calls, ["capture a reuse-only", "compare a run"]);
  deepStrictEqual(compare.steps.buildCandidate, [false]);

  const triage = harness(["a"]);
  equal(await triage.startRun("triage"), 0);
  deepStrictEqual(triage.steps.calls, ["capture a reuse-only", "compare a reuse-only", "triage"]);
});

test("each case's execution outcome is reported apart from its visual outcome", async () => {
  const steps = new FakeSteps();
  steps.captureStatus = { a: 2, b: 1 };
  steps.compareStatus = { b: 1 };
  const run = harness(["a", "b"], steps);
  await run.startRun();
  const lines = run.lines.filter((line) => /^[ab]: /.test(line));
  deepStrictEqual(lines.map((line) => line.split(": ").slice(0, 2).join(": ")), ["a: execution", "a: visual", "b: execution", "b: visual"]);
  ok(lines[0]!.includes("capture 2 (execution failures, ran); coverage INVALID: an action failed; canonical side live"), lines[0]);
  ok(lines[1]!.includes("1 passed, 2 failed; compare 0 (clear, ran), report clear: 0 discrepancies in 0 groups; completeness 5 planned, 3 reported, 1 optional absent"), lines[1]);
  ok(lines[2]!.includes("coverage valid (contiguous, 0 failures, 1 optional absent); canonical side from the cache"), lines[2]);
  ok(lines[3]!.includes("compare 1 (differences, ran)"), lines[3]);
});

test("with --only capture the compare outcome is not run and no report is read", async () => {
  const run = harness(["a"]);
  await run.startRun("capture");
  ok(run.lines.some((line) => line.startsWith("a: visual: ") && line.endsWith("compare not run")), run.lines.join("\n"));
  deepStrictEqual(run.readCalls, [["runs/a", false]]);
});

test("a setup error in one step stops the children of the steps that run beside it", async () => {
  const steps = new FakeSteps();
  const aborted: string[] = [];
  const capture = steps.capture.bind(steps);
  steps.capture = async (context, item) => {
    if (item.name !== "b") return capture(context, item);
    await new Promise<void>((resolve) => {
      if (context.signal?.aborted === true) resolve();
      context.signal?.addEventListener("abort", () => resolve(), { once: true });
      setTimeout(resolve, 2000);
    });
    if (context.signal?.aborted === true) aborted.push(item.name);
    return capture(context, item);
  };
  steps.compare = async () => {
    throw new SetupError("compare a exited with 3");
  };
  const run = harness(["a", "b"], steps);
  equal(await run.startRun(), 3);
  deepStrictEqual(aborted, ["b"]);
});
test("an interrupted run (Ctrl+C) stops the running step, exits with 3 and can be resumed", async () => {
  const steps = new FakeSteps();
  const capture = steps.capture.bind(steps);
  let interrupted = true;
  steps.capture = async (context, item) => {
    if (!interrupted) return capture(context, item);
    await new Promise<void>((resolve) => {
      context.signal?.addEventListener("abort", () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
    if (context.signal?.aborted === true) throw new SetupError("capture a was stopped");
    return capture(context, item);
  };
  const controller = new AbortController();
  const checkpointer = new MemorySaver();
  const run = harness(["a", "b"], steps, checkpointer, controller.signal);
  setTimeout(() => controller.abort(), 100);
  equal(await run.startRun(), 3);
  ok(run.lines.some((line) => line.startsWith("Interrupted")), run.lines.join("\n"));
  ok(!run.lines.some((line) => line.startsWith("Setup error")), run.lines.join("\n"));
  ok(run.lines.some((line) => line.includes("--resume")));

  interrupted = false;
  const resumed = harness(["a", "b"], steps, checkpointer);
  equal(await runWorkflow({ kind: "resume", threadId: run.threadId() }, resumed.dependencies), 0);
  deepStrictEqual(steps.calls.filter((call) => call.endsWith(" run") && call.startsWith("capture")).slice(-2), ["capture a run", "capture b run"]);
});
test("an interrupt during the build reaches the build step's signal and stops the run", async () => {
  const steps = new FakeSteps();
  steps.onBuild = async (signal) => {
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
    if (signal?.aborted === true) throw new SetupError("build was stopped");
  };
  const controller = new AbortController();
  const run = harness(["a"], steps, new MemorySaver(), controller.signal);
  setTimeout(() => controller.abort(), 100);
  equal(await run.startRun(), 3);
  ok(steps.buildSignals[0] !== undefined);
  ok(run.lines.some((line) => line.startsWith("Interrupted")), run.lines.join("\n"));
  ok(!steps.calls.some((call) => call.startsWith("capture")));
});

test("results that cannot be read after the graph finished are a setup error without a resume hint", async () => {
  const run = harness(["a"]);
  const unreadable: RunDependencies = {
    ...run.dependencies,
    certificateProblems: () => [],
    readCase: () => {
      throw new SetupError("a/coverage.json cannot be read");
    },
  };
  equal(await runWorkflow({ kind: "start", arguments: baseArguments }, unreadable), 3);
  ok(run.lines.some((line) => line === "Setup error: a/coverage.json cannot be read"), run.lines.join("\n"));
  ok(run.lines.some((line) => line.includes("has nothing to resume")), run.lines.join("\n"));
  ok(!run.lines.some((line) => line.includes("stopped; resume it with")), run.lines.join("\n"));
  equal(await runWorkflow({ kind: "resume", threadId: run.threadId() }, run.dependencies), 3);
  ok(run.lines.some((line) => line.includes("already finished")));
});