import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver, type StateSnapshot } from "@langchain/langgraph";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import { buildFlatGraph } from "./flat-graph.js";
import { buildLegacyCaseGraph } from "./legacy-case-graph.js";
import { buildWorkflowGraph, discovers, nodeMode, stageIds, type DiagnosisSteps, type InventoryInput, type LoopSteps, type RepairSteps, type WideningSteps, type WorkflowSteps } from "../src/graph/workflow-graph.js";
import { inventoryLines, type InventorySummary } from "../src/inventory/inventory-service.js";
import type { WorkflowStateValue } from "../src/graph/workflow-state.js";
import type { Conclusion, ConcludeInput } from "../src/loop/loop-service.js";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import { exitStatus, runWorkflow, type RunDependencies } from "../src/graph/run-workflow.js";
import { SetupError } from "../src/host/setup-error.js";
import type { Arguments, NodeName } from "../src/options/arguments.js";
import { resolveRunOptions, type RunOptions } from "../src/options/run-options.js";
import type { Profile } from "../src/options/profile.js";
import { RunnerDiscovery } from "../src/discovery/thread-discovery.js";
import { FakeDiscoveryRunner, noDiscovery, type FakeConclusion } from "./thread-discovery-fixtures.js";
import type { CompareReport } from "../../contracts/generated/typescript/parity-compare-report.js";
import type { CaseDetails } from "../src/steps/case-details.js";
import type { InputFingerprints } from "../src/steps/input-fingerprints.js";
import type { StepContext, StepOutcome } from "../src/steps/step-outcome.js";

const fingerprints: InputFingerprints = {
  canonicalExecutable: "e", canonicalSupport: "s", canonicalSupportStat: "ss", tessdata: "default", candidate: "c", overlay: "none", captureTools: "ct", compareTools: "mt", candidateSource: "src", environment: "env",
};

function plannedCase(name: string): PlannedCase {
  return { name, characterFile: `${name}.chum`, fixturePath: `${name}.chum`, mode: "build", actions: [], startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null };
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Records every call with its mode and the moments it started and ended; fails where told to. */
class FakeSteps implements WorkflowSteps {
  captureLanes = 1;
  readonly events: string[] = [];
  readonly calls: string[] = [];
  captureStatus: Record<string, 0 | 1 | 2> = {};
  compareStatus: Record<string, 0 | 1 | 2> = {};
  failCapture: string | null = null;
  failCompare: string | null = null;
  failTriage = false;
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
    // Late enough for the capture beside it to finish and have its result stored.
    if (this.failCompare === capture.case) {
      await delay(100);
      throw new SetupError(`compare ${capture.case} exited with 3`);
    }
    this.events.push(`compare ${capture.case} end`);
    return { ...capture, status: this.compareStatus[capture.case] ?? 0 };
  }

  /** What triage finds: discrepancies in clusters (one per discrepancy) and other findings. */
  triageFinds = { discrepancies: 0, otherFindings: 0 };

  async triage(input: { plan: readonly PlannedCase[] }) {
    this.calls.push("triage");
    if (this.failTriage) throw new SetupError("triage exited with 3");
    const { discrepancies, otherFindings } = this.triageFinds;
    return { path: "triage.json", discrepancies, clusters: discrepancies, newClusters: discrepancies, otherFindings, cases: input.plan.length };
  }

  failInventory = false;

  async inventory(input: InventoryInput): Promise<InventorySummary> {
    this.calls.push(`inventory ${input.candidateSource} ${Object.keys(input.captures).sort().join(",")}`);
    if (this.failInventory) throw new SetupError("The scope file does not match the source.");
    return {
      folder: "inventory", classes: 3, activeClasses: 2, controls: { active: 10, observed: 4 }, interactions: { active: 6, exercised: 1 },
      tuples: { planned: input.plan.length, observed: input.plan.length }, unresolved: 2,
    };
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

const noWidening: WideningSteps = {
  prepare: () => {
    throw new Error("widening is off");
  },
  widen: () => Promise.reject(new Error("widening is off")),
  promote: () => Promise.reject(new Error("widening is off")),
  rollBack: () => Promise.reject(new Error("widening is off")),
  finish: () => {
    throw new Error("widening is off");
  },
};

/** Records each conclusion; the loop itself is tested with the diagnosis harness. */
class FakeLoop implements LoopSteps {
  readonly concluded: string[] = [];
  readonly inputs: ConcludeInput[] = [];

  conclude(input: ConcludeInput): Conclusion {
    this.concluded.push(input.threadId);
    this.inputs.push(input);
    const document: OutcomeDocument = {
      threadId: input.threadId, outcome: "verified_for_scope", scope: { cases: input.plan.map((item) => item.name), captures: null },
      problems: { cases: [], otherFindings: 0 }, clusters: [], accepted: null, merge: null,
      measures: { clusters: 0, fixed: 0, fixRate: null, attempts: 0, modelMilliseconds: 0, elapsedMilliseconds: null }, discovery: input.discovery,
      concludedUtc: "2026-10-01T12:00:00Z",
    };
    return { document, path: "outcome.json" };
  }
}

const baseArguments: Arguments = {
  cases: [], captures: [], settingsOverlay: null, threshold: null, caseFile: null, canonicalCache: null,
  liveCanonical: false, noOcr: false, tessdata: null, only: null, recapture: false, noDiagnosis: false, noRepair: false, noWidening: false, noDiscovery: false, unattended: false, fixChanges: false,
};

/** A run that may discover: its options are resolved as `npm start` resolves them, without repair, and diagnosis only records that it ran. */
type Discovering = { readonly runner: FakeDiscoveryRunner; readonly root: string; readonly profile?: Profile; readonly diagnosed: string[] };

function discovering(profile?: Profile): Discovering {
  const root = mkdtempSync(join(tmpdir(), "workflow-graph-discovery-"));
  return { runner: new FakeDiscoveryRunner(join(root, "discovery")), root, diagnosed: [], ...(profile === undefined ? {} : { profile }) };
}

function recordingDiagnosis(diagnosed: string[]): DiagnosisSteps {
  return {
    ...noDiagnosis,
    prepare: async (input) => {
      diagnosed.push(input.threadId);
      return {};
    },
    finish: () => "diagnosis.json",
  };
}

function harness(cases: string[], steps = new FakeSteps(), checkpointer = new MemorySaver(), signal?: AbortSignal, discovery?: Discovering) {
  const loop = new FakeLoop();
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const graph = buildWorkflowGraph(steps, discovery === undefined ? noDiagnosis : recordingDiagnosis(discovery.diagnosed), noRepair, noWidening, loop,
    discovery === undefined ? noDiscovery : new RunnerDiscovery(discovery.runner, log)).compile({ checkpointer, store: new InMemoryStore() });
  const readCalls: [string, boolean][] = [];
  const dependencies: RunDependencies = {
    graph,
    resolveOptions: (command) => (discovery === undefined ? {
      caseFile: "cases.json", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: "cache",
      canonicalCacheSource: "default", noOcr: false, tessdata: null, only: command.arguments.only, recapture: false,
      diagnosis: false, agents: resolveAgentSettings(undefined), unattended: false, certificates: "certificates", repair: null, widening: false,
    } : { ...resolveRunOptions(command.arguments, discovery.profile ?? {}, { LOCALAPPDATA: discovery.root }, discovery.root), repair: null, widening: false }),
    planCases: () => ({ cases: cases.map(plannedCase), excluded: [] }),
    certificateProblems: () => [],
    head: () => ({ branch: "main", commit: "c0ffee" }),
    readCase: (runFolder, compared) => {
      readCalls.push([runFolder, compared]);
      return fakeDetails(runFolder, compared);
    },
    log,
    now: () => new Date("2026-10-01T12:00:00Z"),
    ...(signal === undefined ? {} : { signal }),
  };
  const startRun = (only: NodeName | null = null, overrides: Partial<Arguments> = {}) => runWorkflow({ kind: "start", arguments: { ...baseArguments, only, ...overrides } }, dependencies);
  const threadId = () => /Thread (wf-\S+):/.exec(lines.join("\n"))?.[1] ?? "";
  return { steps, lines, dependencies, startRun, threadId, checkpointer, readCalls, loop };
}

test("compare of each case overlaps the capture of the next, and triage and the inventory run last", async () => {
  const { steps, startRun } = harness(["a", "b", "c"]);
  equal(await startRun(), 0);
  const at = (event: string) => steps.events.indexOf(event);
  ok(at("compare a start") < at("capture b end") && at("capture b start") < at("compare a end"));
  ok(at("compare b start") < at("capture c end") && at("capture c start") < at("compare b end"));
  deepStrictEqual(steps.calls.slice(-2), ["triage", "inventory src a,b,c"]);
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
  deepStrictEqual(steps.calls.slice(-2), ["triage", "inventory src a,b,c"]);
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
  deepStrictEqual(triage.steps.calls, ["capture a reuse-only", "compare a reuse-only", "triage", "inventory src a"]);
  // A run that triaged concludes; one that ended before triage has no outcome.
  deepStrictEqual([triage.loop.concluded, capture.loop.concluded, compare.loop.concluded], [[triage.threadId()], [], []]);
  ok(triage.lines.at(-2)!.startsWith("Outcome: verified_for_scope; 0 of 0 clusters fixed, "), triage.lines.join("\n"));
  ok(!capture.lines.some((line) => line.startsWith("Outcome: ")));
});

test("the inventory's totals follow the triage totals in the report", async () => {
  const run = harness(["a"]);
  equal(await run.startRun(), 0);
  const triage = run.lines.findIndex((line) => line.startsWith("Triage: "));
  equal(run.lines[triage + 1], "Inventory: 3 classes (2 active), controls observed 4/10, interactions exercised 1/6, tuples observed 1/1, unresolved 2; inventory");
});

test("an inventory setup error ends the run with 3, and the resumed thread runs the inventory again without triaging again", async () => {
  const steps = new FakeSteps();
  steps.failInventory = true;
  const run = harness(["a", "b"], steps);
  equal(await run.startRun(), 3);
  ok(run.lines.some((line) => line === "Setup error: The scope file does not match the source."), run.lines.join("\n"));
  equal(run.loop.concluded.length, 0);

  steps.failInventory = false;
  steps.calls.length = 0;
  equal(await runWorkflow({ kind: "resume", threadId: run.threadId() }, run.dependencies), 0);
  deepStrictEqual(steps.calls, ["inventory src a,b"]);
  equal(run.loop.concluded.length, 1);
});

test("a thread stored before the inventory existed skips it and its report says so", async () => {
  const run = harness(["a"]);
  const graph = buildWorkflowGraph(run.steps, noDiagnosis, noRepair, noWidening, run.loop, noDiscovery).compile({ checkpointer: new MemorySaver(), store: new InMemoryStore() });
  const options = run.dependencies.resolveOptions({ kind: "start", arguments: baseArguments }, "wf-test");
  const { inventorySummary: _absent, ...stored }: WorkflowStateValue = {
    threadId: "wf-old", options, plan: [plannedCase("a")], pendingCaseIndexes: [], fingerprints: null, captures: {}, compares: {}, triageSummary: null, inventorySummary: null,
    clusters: {}, agentMilliseconds: 0, diagnosisCheck: null, diagnosisPath: null, repairs: {}, repairPath: null, widenings: {}, earlierWidenings: [], accepted: null,
    wideningPath: null, threadDiscovery: null, startedUtc: null, base: { branch: "main", commit: "c0ffee" }, outcome: null, outcomePath: null,
  };
  const final = await graph.invoke(stored as WorkflowStateValue, { configurable: { thread_id: "wf-old" } });
  deepStrictEqual(run.steps.calls.filter((call) => !call.startsWith("capture") && !call.startsWith("compare")), ["triage"]);
  equal(final.inventorySummary, undefined);
  equal(run.loop.concluded.length, 1);
  deepStrictEqual(inventoryLines(undefined, true), ["Inventory: not run; the thread started before its capture runs recorded UI trees."]);
  deepStrictEqual([inventoryLines(undefined, false), inventoryLines(null, false)], [[], []]);
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
    head: () => ({ branch: "main", commit: "c0ffee" }),
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
test("with two lanes two cases are captured at once, and the third while the first two are compared", async () => {
  const steps = new FakeSteps();
  steps.captureLanes = 2;
  const { startRun } = harness(["a", "b", "c"], steps);
  equal(await startRun(), 0);
  const at = (event: string) => steps.events.indexOf(event);
  ok(at("capture b start") < at("capture a end") && at("capture a start") < at("capture b end"), steps.events.join(", "));
  ok(at("capture c start") < at("compare a end") && at("compare a start") < at("capture c end"), steps.events.join(", "));
  ok(at("compare b start") < at("capture c end"), steps.events.join(", "));
  deepStrictEqual(steps.calls.slice(-2), ["triage", "inventory src a,b,c"]);

  const capture = harness(["a", "b", "c"], Object.assign(new FakeSteps(), { captureLanes: 2 }));
  equal(await capture.startRun("capture"), 0);
  deepStrictEqual(capture.steps.calls, ["capture a run", "capture b run", "capture c run"]);
});

test("with two lanes a failed capture keeps the capture beside it, and the resumed thread captures only the rest", async () => {
  const steps = new FakeSteps();
  steps.captureLanes = 2;
  steps.failCapture = "b";
  const run = harness(["a", "b", "c"], steps);
  equal(await run.startRun(), 3);
  ok(!steps.calls.some((call) => call.startsWith("capture c")));

  steps.failCapture = null;
  steps.calls.length = 0;
  equal(await runWorkflow({ kind: "resume", threadId: run.threadId() }, run.dependencies), 0);
  deepStrictEqual(steps.calls.filter((call) => call.startsWith("capture")), ["capture b run", "capture c run"]);
  deepStrictEqual(steps.calls.filter((call) => call.startsWith("compare")).sort(), ["compare a run", "compare b run", "compare c run"]);
});

const storedBefore = {
  threadId: "wf-stored-before", fingerprints: null, captures: {}, lastCaptured: -1, compares: {}, triageSummary: null, inventorySummary: null,
  clusters: {}, agentMilliseconds: 0, diagnosisCheck: null, diagnosisPath: null, repairs: {}, repairPath: null, widenings: {}, earlierWidenings: [],
  accepted: null, wideningPath: null, startedUtc: "2026-10-01T12:00:00Z", outcome: null, outcomePath: null,
};

/** Starts a thread in the older checkpoint format, which stops where `steps` fails. */
async function storeOlder(run: ReturnType<typeof harness>, names: string[]): Promise<void> {
  const older = buildLegacyCaseGraph(run.steps).compile({ checkpointer: run.checkpointer });
  await rejects(older.invoke({
    ...storedBefore, options: run.dependencies.resolveOptions({ kind: "start", arguments: baseArguments }, "wf-test"), plan: names.map(plannedCase),
  }, { configurable: { thread_id: storedBefore.threadId } }), SetupError);
}

test("a thread stored in the older checkpoint format before triage is refused, with its recorded steps left for a new run", async () => {
  const names = ["a", "b", "c", "d"];
  const stops: ((steps: FakeSteps) => void)[] = [
    (steps) => { steps.failCompare = "a"; },
    (steps) => { steps.failCapture = "c"; },
    (steps) => { steps.failCompare = "b"; },
    (steps) => { steps.failTriage = true; },
  ];
  for (const stop of stops) {
    const steps = new FakeSteps();
    stop(steps);
    const run = harness(names, steps);
    await storeOlder(run, names);
    steps.failCapture = null;
    steps.failCompare = null;
    steps.failTriage = false;
    steps.calls.length = 0;
    equal(await runWorkflow({ kind: "resume", threadId: storedBefore.threadId }, run.dependencies), 3);
    ok(run.lines.some((line) => line.includes("Start a new run with the same options")), run.lines.join("\n"));
    deepStrictEqual(steps.calls, []);
  }
});

test("a thread stored in the older checkpoint format after triage is refused as well", async () => {
  const names = ["a", "b"];
  const steps = new FakeSteps();
  steps.failInventory = true;
  const run = harness(names, steps);
  await storeOlder(run, names);
  steps.failInventory = false;
  steps.calls.length = 0;
  equal(await runWorkflow({ kind: "resume", threadId: storedBefore.threadId }, run.dependencies), 3, run.lines.join("\n"));
  ok(run.lines.some((line) => line.includes("cannot be resumed")), run.lines.join("\n"));
  deepStrictEqual(steps.calls, []);
});

test("the drawing with xray shows every stage with its inner nodes", async () => {
  const { graph } = harness(["a"]).dependencies;
  const stages = Object.keys((await graph.getGraphAsync()).nodes).filter((id) => !id.startsWith("__"));
  deepStrictEqual(stages, [...stageIds]);
  const inner = {
    start: ["build"],
    capture: ["route_cases", "capture", "compare", "triage", "inventory"],
    discovery: ["discover"],
    diagnose: ["prepare_diagnosis", "route_diagnosis", "hypothesize", "challenge", "wait_for_quota", "check", "finish_diagnosis"],
    repair: ["prepare_repair", "route_repair", "repair", "wait_for_repair_quota", "finish_repair", "retry_repair"],
    widen: ["prepare_widening", "route_widening", "widen", "promote", "roll_back", "finish_widening", "retry_repair"],
    conclude: ["conclude"],
  };
  const subgraphs: Record<string, string[]> = {};
  for await (const [stage, subgraph] of graph.getSubgraphsAsync()) subgraphs[stage] = Object.keys(subgraph.nodes).filter((node) => !node.startsWith("__"));
  deepStrictEqual(subgraphs, inner);
  // LangGraph draws a stage of one node as that node under the stage's ID, and every other stage as its inner nodes.
  const drawn: Record<string, string[]> = {};
  for (const id of Object.keys((await graph.getGraphAsync({ xray: true })).nodes)) {
    const [stage, node] = id.split(":");
    if (stage!.startsWith("__") || node?.startsWith("__") === true) continue;
    (drawn[stage!] ??= []).push(node ?? stage!);
  }
  deepStrictEqual(drawn, { ...inner, start: ["start"], discovery: ["discovery"], conclude: ["conclude"] });
});

test("during a capture the state read with subgraphs shows the pending tasks in the capture stage's namespace, with their case indexes", async () => {
  const steps = new FakeSteps();
  let release = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let started = () => {};
  const capturing = new Promise<void>((resolve) => { started = resolve; });
  const capture = steps.capture.bind(steps);
  steps.capture = async (context, item) => {
    if (item.name === "c") {
      started();
      await released;
    }
    return capture(context, item);
  };
  const run = harness(["a", "b", "c"], steps);
  const finished = run.startRun();
  await capturing;
  const snapshot = await run.dependencies.graph.getState({ configurable: { thread_id: run.threadId() } }, { subgraphs: true });
  deepStrictEqual(snapshot.next, ["capture"]);
  const stage = snapshot.tasks[0]!.state as StateSnapshot;
  const namespace = String(stage.config.configurable?.["checkpoint_ns"]);
  ok(namespace.startsWith("capture:"), namespace);
  // The third case is captured while the second is compared: the tasks are the pushes of that step, in this order.
  deepStrictEqual(stage.tasks.map((task) => [task.name, task.path]), [["compare", ["__pregel_push", 0]], ["capture", ["__pregel_push", 1]]]);
  deepStrictEqual(stage.values.pendingCaseIndexes, [1, 2]);
  release();
  equal(await finished, 0);
});

const { lastCaptured: _older, ...flatInput } = storedBefore;

test("a thread checkpointed by the flat graph is refused wherever it stopped, and nothing runs", async () => {
  const names = ["a", "b", "c"];
  const stops: ((steps: FakeSteps) => void)[] = [
    (steps) => {
      steps.onBuild = () => Promise.reject(new SetupError("build exited with 3"));
    },
    (steps) => { steps.failCapture = "b"; },
    (steps) => { steps.failInventory = true; },
  ];
  for (const stop of stops) {
    const steps = new FakeSteps();
    stop(steps);
    const run = harness(names, steps);
    const flat = buildFlatGraph(steps).compile({ checkpointer: run.checkpointer });
    await rejects(flat.invoke({
      ...flatInput, threadId: "wf-flat", options: run.dependencies.resolveOptions({ kind: "start", arguments: baseArguments }, "wf-flat"), plan: names.map(plannedCase),
    }, { configurable: { thread_id: "wf-flat" } }), SetupError);
    steps.onBuild = null;
    steps.failCapture = null;
    steps.failInventory = false;
    steps.calls.length = 0;
    equal(await runWorkflow({ kind: "resume", threadId: "wf-flat" }, run.dependencies), 3);
    ok(run.lines.includes("Setup error: Thread wf-flat was checkpointed before the workflow graph had stages, so it cannot be resumed. "
      + "Start a new run with the same options: it reuses the capture and compare steps the thread recorded."), run.lines.join("\n"));
    ok(!run.lines.some((line) => line.includes("resume it with")), run.lines.join("\n"));
    deepStrictEqual(steps.calls, []);
    deepStrictEqual(steps.buildCandidate.length, 1);
  }
});

/** The thread's state once its graph ended or stopped between stages. */
async function stateOf(run: ReturnType<typeof harness>): Promise<WorkflowStateValue> {
  return (await run.dependencies.graph.getState({ configurable: { thread_id: run.threadId() } })).values as WorkflowStateValue;
}

test("a clean scope discovers in thread disc-<thread> from its own inventory, records what it found and concludes without diagnosis", async () => {
  const setup = discovering({ discovery: { targets: 2 } });
  setup.runner.conclusion = {
    exitStatus: 1,
    scenarios: [
      { case: "build-x@s1", admission: "admitted", outcome: "finding" }, { case: "build-y@s2", admission: "admitted", outcome: "clear" },
      { case: "build-z@s3", admission: "duplicate", outcome: "finding" }, { case: null, admission: null, outcome: null },
    ],
  };
  const run = harness(["a", "b"], new FakeSteps(), new MemorySaver(), undefined, setup);
  equal(await run.startRun(), 1, run.lines.join("\n"));
  const threadId = run.threadId();
  const discoveryThread = `disc-${threadId}`;
  deepStrictEqual(setup.runner.calls, [`start ${discoveryThread}`]);
  const options = setup.runner.started[0]!.options;
  deepStrictEqual([options.from, options.caseFile, options.targets, options.unattended, options.canonicalCache, options.settingsOverlay, options.threshold],
    [threadId, join(setup.root, "parity", "cases", "characters.json"), 2, false, join(setup.root, "ChummerGenSR4", "canonical-cache"), null, null]);
  deepStrictEqual(run.steps.calls.slice(-2), ["triage", "inventory src a,b"]);
  deepStrictEqual([setup.diagnosed, run.loop.concluded], [[], [threadId]]);
  const state = await stateOf(run);
  deepStrictEqual(state.threadDiscovery, {
    threadId: discoveryThread, exitStatus: 1, admitted: ["build-x@s1", "build-y@s2"], differing: ["build-x@s1"],
    documentPath: join(setup.root, "discovery", discoveryThread, "discovery.json"),
  });
  ok(state.outcome !== null);
  const started = run.lines.indexOf(`Discovery thread ${discoveryThread}: baseline ${threadId}, 2 targets at most.`);
  const { documentPath } = state.threadDiscovery!;
  deepStrictEqual(run.lines.slice(started + 1, started + 4), [
    `Report of ${discoveryThread}`, `Discovery: 4 targets; registry 0 -> 2 entries; ${documentPath}`, `Discovery thread ${discoveryThread} finished: exit 1; ${documentPath}`,
  ]);
});

test("a scope with a difference, a failed step or another finding is diagnosed and does not discover", async () => {
  const differences: [string, (steps: FakeSteps) => void][] = [
    ["a cluster", (steps) => { steps.triageFinds = { discrepancies: 1, otherFindings: 0 }; }],
    ["another finding", (steps) => { steps.triageFinds = { discrepancies: 0, otherFindings: 1 }; }],
    ["a compare with differences", (steps) => { steps.compareStatus = { b: 1 }; }],
    ["a capture with execution failures", (steps) => { steps.captureStatus = { a: 2 }; }],
  ];
  for (const [name, difference] of differences) {
    const setup = discovering();
    const steps = new FakeSteps();
    difference(steps);
    const run = harness(["a", "b"], steps, new MemorySaver(), undefined, setup);
    await run.startRun();
    deepStrictEqual([setup.runner.calls, setup.diagnosed, run.loop.concluded], [[], [run.threadId()], [run.threadId()]], name);
    equal((await stateOf(run)).threadDiscovery, null, name);
  }
});

test("--no-discovery, --no-diagnosis, --only and the registry's case file turn discovery off; a clean scope then goes on as before", async () => {
  const runs: [string, NodeName | null, Partial<Arguments>, boolean][] = [
    ["--no-discovery", null, { noDiscovery: true }, true],
    ["--no-diagnosis", null, { noDiagnosis: true }, false],
    ["--only triage", "triage", {}, false],
    ["--only diagnose", "diagnose", {}, true],
    ["--case-file parity/cases/discovered.json", null, { caseFile: join("parity", "cases", "discovered.json") }, true],
  ];
  for (const [name, only, overrides, diagnoses] of runs) {
    const setup = discovering();
    const run = harness(["a"], new FakeSteps(), new MemorySaver(), undefined, setup);
    equal(await run.startRun(only, overrides), 0, name);
    const state = await stateOf(run);
    deepStrictEqual([setup.runner.calls, state.options.discovery, state.threadDiscovery], [[], null, null], name);
    deepStrictEqual([setup.diagnosed, run.loop.concluded], [diagnoses ? [run.threadId()] : [], [run.threadId()]], name);
    deepStrictEqual([run.loop.inputs[0]!.discovery, state.outcome?.discovery], [null, null], name);
    ok(!run.lines.some((line) => line.startsWith("Discovery")), name);
  }
});

test("the exit status counts the discovery's status 0, 1 or 2, and the report and the outcome show the discovery after the triage and inventory lines", async () => {
  const conclusions: [number, FakeConclusion, string][] = [
    [0, { exitStatus: 0, scenarios: [{ case: "build-x@s1", admission: "admitted", outcome: "clear" }] }, "1 admitted (build-x@s1), 0 differing"],
    [1, {
      exitStatus: 1,
      scenarios: [{ case: "build-x@s1", admission: "admitted", outcome: "finding" }, { case: "build-y@s2", admission: "admitted", outcome: "clear" }],
    }, "2 admitted (build-x@s1, build-y@s2), 1 differing (build-x@s1)"],
    [2, { exitStatus: 2, scenarios: [{ case: null, admission: null, outcome: null }] }, "0 admitted, 0 differing"],
  ];
  for (const [status, conclusion, found] of conclusions) {
    const setup = discovering();
    setup.runner.conclusion = conclusion;
    const run = harness(["a"], new FakeSteps(), new MemorySaver(), undefined, setup);
    equal(await run.startRun(), status, run.lines.join("\n"));
    const threadId = run.threadId();
    const state = await stateOf(run);
    const documentPath = join(setup.root, "discovery", `disc-${threadId}`, "discovery.json");
    deepStrictEqual([run.loop.inputs[0]!.discovery, state.outcome?.discovery, state.outcome?.outcome], [state.threadDiscovery, state.threadDiscovery, "verified_for_scope"], `${status}`);
    // The end-of-run report: the triage and inventory lines, the discovery's line, the outcome and the exit status.
    const report = run.lines.slice(run.lines.findIndex((line) => line.startsWith("Triage: ")));
    deepStrictEqual(report.map((line) => line.split(":")[0]), ["Triage", "Inventory", "Discovery", "Outcome", `Thread ${threadId} finished`], report.join("\n"));
    equal(report[2], `Discovery: disc-${threadId} exit ${status}; ${found}; ${documentPath}`);
    equal(report.at(-1), `Thread ${threadId} finished: exit ${status}.`);
  }
});

test("the exit status is the highest of the capture, compare and discovery statuses", () => {
  const discovery = (exit: number) => ({ threadId: "disc-wf", exitStatus: exit, admitted: [], differing: [], documentPath: "discovery.json" });
  const step = (status: 0 | 1 | 2): Record<string, StepOutcome> => ({ a: { case: "a", status, runFolder: "runs/a", key: "k", reusedFrom: null } });
  deepStrictEqual([
    exitStatus({ captures: step(2), compares: step(0), threadDiscovery: discovery(1) }), exitStatus({ captures: step(0), compares: step(2), threadDiscovery: discovery(1) }),
    exitStatus({ captures: step(0), compares: step(1), threadDiscovery: discovery(2) }), exitStatus({ captures: step(0), compares: step(1), threadDiscovery: discovery(0) }),
    exitStatus({ captures: step(0), compares: step(0), threadDiscovery: null }),
  ], [2, 2, 2, 1, 0]);
});

test("a thread stopped during its discovery resumes the same discovery thread without capturing again or starting another", async () => {
  const setup = discovering();
  setup.runner.failAfterCheckpoint = new SetupError("the desktop lane is gone");
  const run = harness(["a", "b"], new FakeSteps(), new MemorySaver(), undefined, setup);
  equal(await run.startRun(), 3);
  const threadId = run.threadId();
  ok(run.lines.includes("Setup error: the desktop lane is gone"), run.lines.join("\n"));
  ok(run.lines.includes(`Thread ${threadId} stopped; resume it with: npm start -- --resume ${threadId}`), run.lines.join("\n"));
  equal(run.loop.concluded.length, 0);
  equal((await setup.runner.thread(`disc-${threadId}`)).kind, "unfinished");

  run.steps.calls.length = 0;
  equal(await runWorkflow({ kind: "resume", threadId }, run.dependencies), 0);
  deepStrictEqual(setup.runner.calls, [`start disc-${threadId}`, `resume disc-${threadId}`]);
  ok(run.lines.includes(`Resuming discovery thread disc-${threadId}.`), run.lines.join("\n"));
  deepStrictEqual([run.steps.calls, setup.diagnosed, run.loop.concluded], [[], [], [threadId]]);
  equal((await stateOf(run)).threadDiscovery?.threadId, `disc-${threadId}`);
});

test("a discovery setup error ends the run with 3 before the conclusion, and the resumed thread runs its discovery again", async () => {
  const setup = discovering();
  setup.runner.failBeforeCheckpoint = new SetupError("The designer and code files differ from the baseline's; run npm start again.");
  const run = harness(["a"], new FakeSteps(), new MemorySaver(), undefined, setup);
  equal(await run.startRun(), 3);
  const threadId = run.threadId();
  ok(run.lines.includes("Setup error: The designer and code files differ from the baseline's; run npm start again."), run.lines.join("\n"));
  ok(run.lines.some((line) => line.includes(`resume it with: npm start -- --resume ${threadId}`)), run.lines.join("\n"));
  deepStrictEqual([(await setup.runner.thread(`disc-${threadId}`)).kind, run.loop.concluded, (await stateOf(run)).threadDiscovery], ["absent", [], null]);

  run.steps.calls.length = 0;
  equal(await runWorkflow({ kind: "resume", threadId }, run.dependencies), 0);
  deepStrictEqual(setup.runner.calls, [`start disc-${threadId}`, `start disc-${threadId}`]);
  deepStrictEqual([run.steps.calls, run.loop.concluded], [[], [threadId]]);
});

test("a thread discovers only when its options hold discovery settings and its inventory ran", () => {
  const clean = {
    options: { discovery: { caseFile: "cases.json", targets: 3 } }, plan: [{ name: "a" }], captures: { a: { status: 0 } }, compares: { a: { status: 0 } },
    triageSummary: { discrepancies: 0, clusters: 0, otherFindings: 0 }, inventorySummary: { folder: "inventory" },
  } as unknown as WorkflowStateValue;
  equal(discovers(clean), true);
  const { discovery: _absent, ...stored } = clean.options;
  const { inventorySummary: _none, ...beforeInventory } = clean;
  deepStrictEqual([
    discovers({ ...clean, options: stored as RunOptions }), discovers({ ...clean, options: { ...clean.options, discovery: null } }),
    discovers(beforeInventory as WorkflowStateValue), discovers({ ...clean, compares: {} }),
  ], [false, false, false, false]);
});