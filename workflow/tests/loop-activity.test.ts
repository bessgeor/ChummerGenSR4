import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import type { ComposedWorkflow } from "../src/compose-workflow.js";
import { buildWorkflowGraph, type DiagnosisSteps, type InventoryInput, type LoopSteps as ConcludeSteps, type RepairSteps, type WideningSteps, type WorkflowSteps } from "../src/graph/workflow-graph.js";
import { runWorkflow, threadProgress, type RunDependencies } from "../src/graph/run-workflow.js";
import { DesktopLane } from "../src/host/desktop-lane.js";
import { SetupError } from "../src/host/setup-error.js";
import { controlFilePauses } from "../src/lanes/host-lanes.js";
import { LanePool } from "../src/lanes/lane-pool.js";
import type { LaneDefinition } from "../src/lanes/lane-settings.js";
import {
  activityPath, ActivityLineSchema, controlPath, LoopStateSchema, readActivity, readLoopState, setPaused, statePath, type ActivityLine, type LoopState, type PauseGate,
} from "../src/loop/loop-control.js";
import { LoopMonitor, taskSubject } from "../src/loop/loop-monitor.js";
import type { Conclusion, ConcludeInput } from "../src/loop/loop-service.js";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import type { Arguments } from "../src/options/arguments.js";
import type { RunOptions } from "../src/options/run-options.js";
import { loopPaths, readLoopDocument, stopRequested, writeLoopDocument } from "../src/loop-driver/loop-document.js";
import type { LoopSteps } from "../src/loop-driver/loop-graph.js";
import { hostLoopSteps, openLoopCheckpointer, runLoop, type LoopDependencies } from "../src/loop-driver/run-loop.js";
import { parseLoopArguments } from "../src/loop-driver/loop-arguments.js";
import { readAutoTuning } from "../src/tuning/auto-tuning.js";
import type { InputFingerprints } from "../src/steps/input-fingerprints.js";
import type { StepContext, StepOutcome } from "../src/steps/step-outcome.js";
import { scratch } from "./diagnosis-fixtures.js";
import { baselineThread, discoveryHarness, fixtureCase, type Reply } from "./discovery-harness.js";
import type { Plan } from "../src/discovery/job-schemas.js";
import type { AgentJob } from "../src/agents/agent-job.js";
import { noDiscovery } from "./thread-discovery-fixtures.js";
import { agents, dueTuning, proposal } from "./tuning-auto-fixtures.js";

const loopId = "loop-20261101T100000Z-0000abcd";
const now = () => new Date("2026-11-01T10:00:00Z");
const tick = (milliseconds = 5) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Waits until what a test expects to happen has happened; how long it takes depends on the machine's load. */
async function until(happened: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!happened()) {
    if (Date.now() >= deadline) throw new Error(`Nothing happened within 10 s: ${happened.toString()}`);
    await tick();
  }
}

const fingerprints: InputFingerprints = {
  canonicalExecutable: "e", canonicalSupport: "s", canonicalSupportStat: "ss", tessdata: "default", candidate: "c", overlay: "none", captureTools: "ct", compareTools: "mt", candidateSource: "src", environment: "env",
};

function plannedCase(name: string): PlannedCase {
  return { name, characterFile: `${name}.chum`, fixturePath: `${name}.chum`, mode: "build", actions: [], startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null };
}

const off = (stage: string) => () => {
  throw new Error(`${stage} is off`);
};
const noDiagnosis: DiagnosisSteps = { prepare: off("diagnosis"), hypothesize: off("diagnosis"), challenge: off("diagnosis"), waitForQuota: off("diagnosis"), check: off("diagnosis"), finish: off("diagnosis") };
const noRepair: RepairSteps = { prepare: off("repair"), repair: off("repair"), waitForQuota: off("repair"), finish: off("repair") };
const noWidening: WideningSteps = { prepare: off("widening"), widen: off("widening"), promote: off("widening"), rollBack: off("widening"), finish: off("widening") };

/** A capture holds a desktop lane of the pool while `during` runs; its case `fail` fails with a setup error. */
class LaneSteps implements WorkflowSteps {
  readonly captureLanes: number;
  during: (name: string) => Promise<void> = async () => {};
  fail: string | null = null;

  constructor(private readonly pool: LanePool) {
    this.captureLanes = pool.lanes.length;
  }

  async build(): Promise<InputFingerprints> {
    return fingerprints;
  }

  async capture(_context: StepContext, item: PlannedCase): Promise<StepOutcome> {
    const held = await this.pool.acquire();
    try {
      await this.during(item.name);
      if (this.fail === item.name) throw new SetupError(`capture ${item.name} exited with 3`);
    } finally {
      await held.release();
    }
    return { case: item.name, status: 0, runFolder: `runs/${item.name}`, key: `k-${item.name}`, reusedFrom: null };
  }

  async compare(_context: StepContext, capture: StepOutcome): Promise<StepOutcome> {
    return capture;
  }

  async triage(input: { plan: readonly PlannedCase[] }) {
    return { path: "triage.json", discrepancies: 0, clusters: 0, newClusters: 0, otherFindings: 0, cases: input.plan.length };
  }

  async inventory(input: InventoryInput) {
    return {
      folder: "inventory", classes: 1, activeClasses: 1, controls: { active: 1, observed: 1 }, interactions: { active: 1, exercised: 1 },
      tuples: { planned: input.plan.length, observed: input.plan.length }, unresolved: 0,
    };
  }
}

/** Concludes a thread with nothing changed and writes its `outcome.json` where the loop reads it. */
class Conclude implements ConcludeSteps {
  constructor(private readonly threadFolder: (threadId: string) => string) {}

  conclude(input: ConcludeInput): Conclusion {
    const document: OutcomeDocument = {
      threadId: input.threadId, outcome: "verified_for_scope", scope: { cases: input.plan.map((item) => item.name), captures: null },
      problems: { cases: [], otherFindings: 0 }, clusters: [], accepted: null, merge: null,
      measures: { clusters: 0, fixed: 0, fixRate: null, attempts: 0, modelMilliseconds: 0, elapsedMilliseconds: null, pausedMilliseconds: 0 }, discovery: null,
      concludedUtc: now().toISOString(),
    };
    const path = join(this.threadFolder(input.threadId), "outcome.json");
    mkdirSync(this.threadFolder(input.threadId), { recursive: true });
    writeFileSync(path, JSON.stringify(document));
    return { document, path };
  }
}

function lock(name: string, path: string): DesktopLane {
  return new DesktopLane({
    name, lockPath: path, pollMilliseconds: 10, unreadableTimeoutMilliseconds: 100, heartbeatMilliseconds: 20, staleAfterMilliseconds: 60_000,
    host: "this-host", processId: 1000, isRunning: () => true, log: () => {},
  });
}

/**
 * The workflow of a loop in `root`: threads of the real workflow graph over cases on the local desktop lanes `lanes`,
 * whose flags the loop's control file sets, without diagnosis or discovery.
 */
function workflowOn(root: string, lanes: readonly string[], cases: readonly string[]) {
  const paths = loopPaths(root);
  const threadFolder = (threadId: string) => join(root, "threads", threadId);
  const definitions: LaneDefinition[] = lanes.map((name) => ({ name, kind: "local" as const }));
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const pool = new LanePool(lanes.map((name) => ({ name, lock: lock(name, join(root, `${name}.lock`)), remote: null })), 10, { host: "this-host", user: "me" },
    controlFilePauses(paths.folder(loopId), definitions, log, now));
  const steps = new LaneSteps(pool);
  const checkpointer = new MemorySaver();
  const graph = buildWorkflowGraph(steps, noDiagnosis, noRepair, noWidening, new Conclude(threadFolder), noDiscovery).compile({ checkpointer, store: new InMemoryStore() });
  const options: RunOptions = {
    caseFile: "cases.json", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: "cache", canonicalCacheSource: "default", noOcr: false, tessdata: null,
    only: null, recapture: false, diagnosis: false, agents: resolveAgentSettings(undefined), unattended: false, certificates: "certificates", repair: null, widening: false,
  };
  const dependencies: RunDependencies = {
    graph, resolveOptions: () => options, prepareThread: (_command, resolved) => resolved, planCases: () => ({ cases: cases.map(plannedCase), excluded: [] }),
    certificateProblems: () => [], head: () => ({ branch: "main", commit: "c0ffee" }), threadTraces: () => [],
    checkpointedThread: (threadId) => (Object.keys(checkpointer.storage).includes(threadId) ? threadId : null), recordPause: () => {},
    readCase: () => ({
      execution: { coverageValid: true, invalidReasons: [], contiguous: true, failures: 0, optionalAbsent: 0, canonicalSource: "live" },
      visual: { passed: 1, failed: 0, report: null },
    }),
    log, now,
  };
  const workflow: ComposedWorkflow = {
    run: (command, request) => runWorkflow(command, dependencies, request), progress: (threadId) => threadProgress(graph, threadId, dependencies.threadTraces), close: () => {},
  };
  return { paths, threadFolder, steps, workflow, lines, log };
}

function startOf(args: string[]) {
  const command = parseLoopArguments(args);
  if (command.kind !== "start") throw new Error(`expected start, got ${command.kind}`);
  return command;
}

/** Loop steps whose threads run on `workflow` and change nothing, and whose tuning is never due. */
function quietSteps(paths: ReturnType<typeof loopPaths>, workflow: ComposedWorkflow, log: (line: string) => void, pause?: (threadId: string) => Partial<PauseGate>) {
  let threads = 0;
  return (id: string): LoopSteps => ({
    newThreadId: () => `wf-${++threads}`,
    threadProgress: (threadId) => workflow.progress(threadId),
    runThread: (threadId, args: Arguments, reason) => workflow.run({ kind: "start", arguments: args }, {
      threadId, loopControl: { folder: paths.folder(id), log, reason, pollMilliseconds: 1, ...pause?.(threadId) },
    }),
    resumeThread: (threadId, reason) => workflow.run({ kind: "resume", threadId }, { loopControl: { folder: paths.folder(id), log, reason, pollMilliseconds: 1 } }),
    threadSummary: () => ({ outcome: "verified_for_scope", fixed: [], merged: [], sourceChanged: false, admitted: [] }),
    tuningStarted: () => false,
    tune: async () => ({ kind: "not_due", count: 0, every: 12 }),
    writeLoop: (document) => writeLoopDocument(paths.document(id), document),
    readLoop: () => readLoopDocument(paths.document(id)),
    stopRequested: () => stopRequested(paths, id),
    now,
    log,
  });
}

type Run = ReturnType<typeof workflowOn>;

/** Runs `npm run loop` as `command` names it on the loop in `run`, whose graph is checkpointed in its `out/loop/`. */
function loopOn(run: Run, command: ReturnType<typeof startOf> | { readonly kind: "resume"; readonly loopId: string }, steps: (id: string) => LoopSteps,
  dependencies: Partial<Pick<LoopDependencies, "newLoopId" | "now" | "lanes" | "statePollMilliseconds">> = {}): Promise<number> {
  return runLoop(command, {
    paths: run.paths, newLoopId: () => loopId, now, log: run.log, lanes: ["desktop"], ...dependencies,
    compose: (id) => {
      const checkpointer = openLoopCheckpointer(run.paths);
      return { checkpointer, steps: steps(id), close: () => checkpointer.db.close() };
    },
  });
}

const brief = (line: ActivityLine) => `${line.graph} ${line.stage}/${line.node} ${line.subject ?? "-"} ${line.lane ?? "-"} ${line.status}`;

test("a loop's thread captures cases a and b on lanes desktop and vm: state.json shows each lane busy with its thread, node and case, and activity.jsonl gets a line for each with its lane", async () => {
  const root = scratch("workflow-loop-activity-");
  const run = workflowOn(root, ["desktop", "vm"], ["a", "b"]);
  const holding = new Set<string>();
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let busy: LoopState | null = null;
  run.steps.during = async (name) => {
    holding.add(name);
    await released;
  };
  const loop = loopOn(run, startOf(["--case", "a"]), quietSteps(run.paths, run.workflow, run.log), { lanes: ["desktop", "vm"] });
  // Both cases hold their lanes at once; the state file says which.
  await until(() => holding.size === 2);
  busy = readLoopState(run.paths.folder(loopId));
  release();
  equal(await loop, 0, run.lines.join("\n"));

  const lanes = busy!.lanes;
  deepStrictEqual(Object.keys(lanes).sort(), ["desktop", "vm"]);
  deepStrictEqual([lanes["desktop"]!.busy?.subject, lanes["vm"]!.busy?.subject].sort(), ["a", "b"]);
  for (const lane of ["desktop", "vm"]) deepStrictEqual({ ...lanes[lane]!, busy: { ...lanes[lane]!.busy!, subject: "case" } }, { paused: false, busy: { thread: "wf-1", node: "capture", subject: "case" } });
  deepStrictEqual([busy!.paused, busy!.pausing], [false, false]);
  // Once the captures ended, both lanes are free again.
  const after = readLoopState(run.paths.folder(loopId))!;
  deepStrictEqual(after.lanes, { desktop: { paused: false, busy: null }, vm: { paused: false, busy: null } });

  const activity = readActivity(run.paths.folder(loopId));
  const captures = activity.filter((line) => line.graph === "workflow" && line.node === "capture" && line.namespace !== "");
  deepStrictEqual(captures.map((line) => `${line.subject} ${line.lane}`).sort(), [`a ${lanes["desktop"]!.busy!.subject === "a" ? "desktop" : "vm"}`, `b ${lanes["desktop"]!.busy!.subject === "b" ? "desktop" : "vm"}`]);
  for (const line of captures) {
    equal(line.thread, "wf-1");
    equal(line.status, "succeeded");
    ok(/^capture:[0-9a-f-]+$/.test(line.namespace), line.namespace);
  }
  // Every task of the thread and of the loop has its line: the workflow's stages at its top, their nodes in their namespaces.
  const top = activity.filter((line) => line.graph === "workflow" && line.namespace === "").map((line) => `${line.node} ${line.status}`);
  deepStrictEqual(top, ["start succeeded", "capture succeeded", "conclude succeeded"]);
  deepStrictEqual(activity.filter((line) => line.graph === "loop").map(brief),
    ["start_thread", "run_thread", "decide_thread", "tune", "decide"].map((node) => `loop ${node}/${node} - - succeeded`));
  ok(activity.every((line) => line.pausedMs === 0 && line.thread === (line.graph === "loop" ? loopId : "wf-1")));
  // The loop's thread is in loop.json with its graph, times and reason.
  deepStrictEqual(readLoopDocument(run.paths.document(loopId)).threads, [{ thread: "wf-1", graph: "workflow", startedUtc: now().toISOString(), endedUtc: now().toISOString(), reason: "the loop started" }]);
});

test("the files a loop writes match their exported schemas, and the four graphs' structure is written when it starts", async () => {
  const root = scratch("workflow-loop-activity-");
  const run = workflowOn(root, ["desktop"], ["a"]);
  equal(await loopOn(run, startOf([]), quietSteps(run.paths, run.workflow, run.log)), 0, run.lines.join("\n"));
  const folder = run.paths.folder(loopId);
  LoopStateSchema.parse(JSON.parse(readFileSync(statePath(folder), "utf8")));
  const lines = readFileSync(activityPath(folder), "utf8").split("\n");
  equal(lines.at(-1), "");
  ok(lines.length > 5);
  for (const line of lines.slice(0, -1)) ActivityLineSchema.parse(JSON.parse(line));
  const document = readLoopDocument(run.paths.document(loopId));
  ok(document.loopId.startsWith("loop-"));
  deepStrictEqual([document.status, document.threads.map((thread) => thread.thread)], ["converged", ["wf-1"]]);

  type Drawn = { nodes: { id: string }[]; edges: { source: string; target: string }[] };
  const drawn = (graph: string) => JSON.parse(readFileSync(join(run.paths.graphs, `${graph}.json`), "utf8")) as Drawn;
  const nodes = (graph: string) => drawn(graph).nodes.map((node) => node.id);
  ok(nodes("workflow").includes("conclude") && nodes("workflow").includes("capture:capture"), nodes("workflow").join(", "));
  ok(drawn("workflow").edges.some((edge) => edge.target === "conclude"));
  deepStrictEqual(nodes("loop"), ["__start__", "start_thread", "run_thread", "decide_thread", "tune", "decide", "__end__"]);
  ok(nodes("discovery").includes("scenario") && nodes("tuning").includes("activate"));
  for (const graph of ["loop", "workflow", "discovery", "tuning"]) ok(readFileSync(join(run.paths.graphs, `${graph}.mmd`), "utf8").includes("graph TD;"), graph);
  // A later start replaces them.
  writeFileSync(join(run.paths.graphs, "loop.json"), "{}");
  const second = workflowOn(root, ["desktop"], ["a"]);
  equal(await loopOn(second, startOf([]), quietSteps(second.paths, second.workflow, second.log), { newLoopId: () => "loop-20261101T110000Z-0000abcd" }), 0, second.lines.join("\n"));
  deepStrictEqual(nodes("loop").length, 7);
});

test("a loop paused while a case captures shows pausing until the capture ends and paused once the thread waits; the interrupted tasks' lines say so, and only the task that ran through the pause has paused time", async () => {
  const root = scratch("workflow-loop-activity-");
  const run = workflowOn(root, ["desktop"], ["a", "b"]);
  const folder = run.paths.folder(loopId);
  const seen: string[] = [];
  const flags = () => {
    const state = readLoopState(folder)!;
    return `paused ${state.paused} pausing ${state.pausing}`;
  };
  run.steps.during = async (name) => {
    if (name !== "a") return;
    setPaused(folder, null, true, now());
    // The poll sees the flag while the capture still runs.
    await until(() => readLoopState(folder)!.pausing);
    seen.push(`${flags()} busy ${readLoopState(folder)!.lanes["desktop"]!.busy?.subject}`);
  };
  // The thread's wait at its pause, 30 minutes on the loop's clock: the state says paused, then the loop is unpaused.
  let at = now().getTime();
  const pause = (): Partial<PauseGate> => ({
    sleep: async () => {
      seen.push(flags());
      at += 30 * 60_000;
      setPaused(folder, null, false, now());
    },
  });
  equal(await loopOn(run, startOf([]), quietSteps(run.paths, run.workflow, run.log, pause), { now: () => new Date(at), statePollMilliseconds: 1 }), 0, run.lines.join("\n"));
  deepStrictEqual(seen, ["paused false pausing true busy a", "paused true pausing false"]);
  const activity = readActivity(folder);
  // The capture of a finished and kept its write; the router after it was interrupted on entry, and so was its stage.
  // After the unpause the stage ran again, without capturing a again. Only the loop's run_thread, which waited for the
  // thread, ran while the loop was paused.
  deepStrictEqual(activity.map((line) => `${brief(line)} ${line.pausedMs} ${line.namespace === "" ? "top" : "in"}`), [
    "loop start_thread/start_thread - - succeeded 0 top",
    "workflow start/build - - succeeded 0 in", "workflow start/start - - succeeded 0 top",
    "workflow capture/route_cases - - succeeded 0 in", "workflow capture/capture a desktop succeeded 0 in",
    "workflow capture/route_cases - - interrupted 0 in", "workflow capture/capture - - interrupted 0 top",
    "workflow capture/route_cases - - succeeded 0 in", "workflow capture/compare a - succeeded 0 in", "workflow capture/capture b desktop succeeded 0 in",
    "workflow capture/route_cases - - succeeded 0 in", "workflow capture/compare b - succeeded 0 in", "workflow capture/route_cases - - succeeded 0 in",
    "workflow capture/triage - - succeeded 0 in", "workflow capture/inventory - - succeeded 0 in", "workflow capture/capture - - succeeded 0 top",
    "workflow conclude/conclude - - succeeded 0 in", "workflow conclude/conclude - - succeeded 0 top",
    `loop run_thread/run_thread - - succeeded ${30 * 60_000} top`,
    "loop decide_thread/decide_thread - - succeeded 0 top", "loop tune/tune - - succeeded 0 top", "loop decide/decide - - succeeded 0 top",
  ]);
  deepStrictEqual(readLoopState(folder)!.paused, false);
});

test("a failed capture gives failed lines for its task, its stage and the loop's run_thread, and the thread stays without an end in loop.json", async () => {
  const root = scratch("workflow-loop-activity-");
  const run = workflowOn(root, ["desktop"], ["a"]);
  run.steps.fail = "a";
  equal(await loopOn(run, startOf([]), quietSteps(run.paths, run.workflow, run.log)), 3, run.lines.join("\n"));
  const activity = readActivity(run.paths.folder(loopId));
  deepStrictEqual(activity.filter((line) => line.status === "failed").map(brief), [
    "workflow capture/capture a desktop failed", "workflow capture/capture - - failed", "loop run_thread/run_thread - - failed",
  ]);
  deepStrictEqual(readLoopDocument(run.paths.document(loopId)).threads.map((thread) => [thread.thread, thread.endedUtc]), [["wf-1", null]]);
  deepStrictEqual(readLoopState(run.paths.folder(loopId))!.lanes, { desktop: { paused: false, busy: null } });
});

test("a resumed loop keeps the threads loop.json holds, records the resumed thread's end, and gives a capture restored from its checkpoint no second line", async () => {
  const root = scratch("workflow-loop-activity-");
  const run = workflowOn(root, ["desktop", "vm"], ["a", "b"]);
  const folder = run.paths.folder(loopId);
  const captures = (thread: string) => readActivity(folder)
    .filter((line) => line.thread === thread && line.node === "capture" && line.namespace !== "").map((line) => `${line.subject} ${line.status}`);
  // The second thread's capture of b fails once its capture of a has ended.
  const times = new Map<string, number>();
  run.steps.during = async (name) => {
    times.set(name, (times.get(name) ?? 0) + 1);
    if (name !== "b" || times.get(name) !== 2) return;
    await until(() => captures("wf-2").includes("a succeeded"));
    throw new SetupError("capture b exited with 3");
  };
  // The first thread merges a fix, so a second one starts.
  const quiet = quietSteps(run.paths, run.workflow, run.log);
  const steps = (id: string): LoopSteps => {
    const loop = quiet(id);
    return { ...loop, threadSummary: (threadId) => (threadId === "wf-1" ? { ...loop.threadSummary(threadId), merged: ["d-1"], sourceChanged: true } : loop.threadSummary(threadId)) };
  };
  const later = new Date("2026-11-01T11:00:00Z");
  equal(await loopOn(run, startOf([]), steps, { lanes: ["desktop", "vm"] }), 3, run.lines.join("\n"));
  equal(await loopOn(run, { kind: "resume", loopId }, steps, { lanes: ["desktop", "vm"], now: () => later }), 0, run.lines.join("\n"));
  deepStrictEqual(readLoopDocument(run.paths.document(loopId)).threads, [
    { thread: "wf-1", graph: "workflow", startedUtc: now().toISOString(), endedUtc: now().toISOString(), reason: "the loop started" },
    { thread: "wf-2", graph: "workflow", startedUtc: now().toISOString(), endedUtc: later.toISOString(), reason: "thread wf-1 merged d-1" },
  ]);
  deepStrictEqual(captures("wf-2"), ["a succeeded", "b failed", "b succeeded"]);
  deepStrictEqual(readLoopState(folder)!.lanes, { desktop: { paused: false, busy: null }, vm: { paused: false, busy: null } });
});

test("a task whose router fails after its node succeeded gets a failed line", async () => {
  const root = scratch("workflow-loop-activity-");
  // With no case planned, the router after the start stage fails the thread.
  const run = workflowOn(root, ["desktop"], []);
  equal(await loopOn(run, startOf([]), quietSteps(run.paths, run.workflow, run.log)), 3, run.lines.join("\n"));
  ok(run.lines.some((line) => line.includes("No case is planned")), run.lines.join("\n"));
  deepStrictEqual(readActivity(run.paths.folder(loopId)).map(brief), [
    "loop start_thread/start_thread - - succeeded", "workflow start/build - - succeeded", "workflow start/start - - failed", "loop run_thread/run_thread - - failed",
  ]);
});

test("a task that finished beside an interrupted one is restored, not run, when its graph resumes: it keeps its one line", () => {
  const folder = scratch("workflow-loop-folder-");
  const monitor = new LoopMonitor({ folder, lanes: [], now, onThreads: () => {} });
  monitor.start();
  try {
    const stage = { id: "s", name: "diagnose", input: null };
    const inner = (id: string) => ({ id, name: "hypothesize", input: { clusterId: `d-${id}` } });
    monitor.threadStarted("workflow", "wf-1", "the loop started");
    // The first run: both tasks run, a finishes and b stops at the pause.
    monitor.taskStarted("workflow", "wf-1", [], stage);
    monitor.taskEntered("wf-1", "diagnose:s");
    for (const id of ["a", "b"]) {
      monitor.taskStarted("workflow", "wf-1", ["diagnose:s"], inner(id));
      monitor.taskEntered("wf-1", `diagnose:s|hypothesize:${id}`);
    }
    monitor.taskFinished("workflow", "wf-1", ["diagnose:s"], { id: "a", name: "hypothesize", interrupts: [] });
    monitor.taskFinished("workflow", "wf-1", ["diagnose:s"], { id: "b", name: "hypothesize", interrupts: [{ value: { paused: true } }] });
    monitor.taskFinished("workflow", "wf-1", [], { id: "s", name: "diagnose", interrupts: [{ value: { paused: true } }] });
    monitor.pauseChanged("workflow", "wf-1", true);
    monitor.pauseChanged("workflow", "wf-1", false);
    // The resumed run restores a from its checkpoint and runs b again.
    monitor.taskStarted("workflow", "wf-1", [], stage);
    monitor.taskEntered("wf-1", "diagnose:s");
    for (const id of ["a", "b"]) monitor.taskStarted("workflow", "wf-1", ["diagnose:s"], inner(id));
    monitor.taskEntered("wf-1", "diagnose:s|hypothesize:b");
    monitor.taskFinished("workflow", "wf-1", ["diagnose:s"], { id: "b", name: "hypothesize", interrupts: [] });
    monitor.taskFinished("workflow", "wf-1", [], { id: "s", name: "diagnose", interrupts: [] });
    monitor.threadStopped("workflow", "wf-1", true);
  } finally {
    monitor.stop();
  }
  deepStrictEqual(readActivity(folder).map(brief), [
    "workflow diagnose/hypothesize d-a - succeeded", "workflow diagnose/hypothesize d-b - interrupted", "workflow diagnose/diagnose - - interrupted",
    "workflow diagnose/hypothesize d-b - succeeded", "workflow diagnose/diagnose - - succeeded",
  ]);
});

test("a lane given back while the control file cannot be read does not fail the command; the next event does, and the task that ran keeps its failed line", () => {
  const folder = scratch("workflow-loop-folder-");
  // Only the release meets the unreadable file: the poll does not run during the test.
  const monitor = new LoopMonitor({ folder, lanes: ["desktop"], now, onThreads: () => {}, pollMilliseconds: 60_000 });
  monitor.start();
  try {
    const task = { id: "s", name: "start", input: null };
    monitor.threadStarted("workflow", "wf-1", "the loop started");
    monitor.taskStarted("workflow", "wf-1", [], task);
    writeFileSync(controlPath(folder), "{");
    monitor.laneHeld("desktop", false);
    rmSync(controlPath(folder));
    // LangChain does not raise what its callback handler throws, so the report that the task ran must not fail.
    monitor.taskEntered("wf-1", "start:s");
    throws(() => monitor.taskFinished("workflow", "wf-1", [], { id: "s", name: "start", interrupts: [] }), (error) => error instanceof SetupError && error.message.includes("control.json"));
    monitor.threadStopped("workflow", "wf-1", false);
  } finally {
    monitor.stop();
  }
  deepStrictEqual(readActivity(folder).map(brief), ["workflow start/start - - failed"]);
});

test("a thread whose record in loop.json cannot be written does not start: the loop's graph stays the innermost and stops as usual", () => {
  const folder = scratch("workflow-loop-folder-");
  const monitor = new LoopMonitor({
    folder, lanes: [], now, onThreads: () => {
      throw new SetupError("loop.json cannot be written");
    },
  });
  monitor.start();
  try {
    monitor.threadStarted("loop", loopId, null);
    throws(() => monitor.threadStarted("workflow", "wf-1", "the loop started"), /loop\.json cannot be written/);
    monitor.threadStopped("loop", loopId, false);
  } finally {
    monitor.stop();
  }
});

const act = (type: string, fields: Record<string, unknown> = {}) => ({ type, name: null, label: null, milliseconds: null, optional: null, ...fields });
const plan: Plan = {
  case: fixtureCase, expect: [],
  actions: [act("capture", { name: "common" }), act("selectTab", { name: "Skills" }), act("waitFor", { label: "Karma" }), act("capture", { name: "skills" })] as Plan["actions"],
};
const discoveryReply = (job: AgentJob<unknown>): Reply => job.kind === "rank"
  ? { answer: { rankings: [
    { targetId: "frmCreate/tabSkills", score: 0.9, feasibility: "feasible", case: fixtureCase, reason: "Selecting the Skills tab shows it." },
    { targetId: "frmCreate.tabCharacterTabs#selection", score: 0.5, feasibility: "uncertain", case: null, reason: "Two captures around a tab change." },
  ] } }
  : { answer: { outcome: "plan", reason: "Select Skills.", plan } };

test("a discovery thread the loop runs gets a line per task, with its target as the scenario's subject, and is recorded with its reason", async () => {
  const harness = await discoveryHarness(discoveryReply);
  const folder = scratch("workflow-loop-folder-");
  const threads: unknown[] = [];
  const monitor = new LoopMonitor({ folder, lanes: ["desktop"], now, onThreads: (next) => threads.splice(0, threads.length, ...next) });
  monitor.start();
  const threadId = `disc-${baselineThread}`;
  const reason = `the discovery of workflow thread ${baselineThread}`;
  try {
    await harness.runner.start(threadId, harness.resolveOptions({
      from: baselineThread, targets: 1, caseFile: null, settingsOverlay: null, threshold: null, canonicalCache: null, liveCanonical: true, unattended: false,
    }), undefined, { folder, log: () => {}, reason });
  } finally {
    monitor.stop();
  }
  const activity = readActivity(folder);
  ok(activity.length > 0 && activity.every((line) => line.graph === "discovery" && line.thread === threadId && line.namespace === "" && line.stage === line.node && line.status === "succeeded"),
    activity.map(brief).join("\n"));
  const nodes = activity.map((line) => line.node);
  for (const node of ["prepare", "rank", "select", "scenario", "validate", "execute", "register", "conclude"]) ok(nodes.includes(node), `${node}: ${nodes.join(", ")}`);
  deepStrictEqual(activity.filter((line) => line.node === "scenario").map((line) => line.subject), ["frmCreate/tabSkills"]);
  deepStrictEqual(threads, [{ thread: threadId, graph: "discovery", startedUtc: now().toISOString(), endedUtc: now().toISOString(), reason }]);
});

test("a loop's tuning gets a line per task of the tuning graph, and loop.json lists the threads and the tuning in order with their reasons", async () => {
  // A tuning due after the first thread activates a configuration, so a second thread starts; the second tuning is not due.
  const { context } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const root = scratch("workflow-loop-activity-");
  const run = workflowOn(root, ["desktop"], ["a"]);
  const status = await loopOn(run, startOf([]),
    (id) => hostLoopSteps(id, { paths: run.paths, workflow: run.workflow, threadFolder: run.threadFolder, evalContext: context, now, log: run.log }));
  equal(status, 0, [...run.lines, ...context.lines].join("\n"));
  const document = readLoopDocument(run.paths.document(loopId));
  const tuning = readAutoTuning(context.paths.evalsFolder).tunings[0]!;
  const [first, second] = document.iterations.map((iteration) => iteration.thread);
  deepStrictEqual(document.threads.map((thread) => [thread.graph, thread.thread, thread.reason, thread.endedUtc !== null]), [
    ["workflow", first, "the loop started", true],
    ["tuning", tuning.tuningId, `the automatic tuning after thread ${first}`, true],
    ["workflow", second, `tuning ${tuning.tuningId} activated a configuration`, true],
  ]);
  const activity = readActivity(run.paths.folder(loopId));
  const tuningLines = activity.filter((line) => line.graph === "tuning");
  ok(tuningLines.every((line) => line.thread === tuning.tuningId && line.status === "succeeded" && line.stage === line.node && line.subject === null), tuningLines.map(brief).join("\n"));
  const nodes = tuningLines.map((line) => line.node);
  for (const node of ["count", "freeze", "baseline", "propose", "holdout", "activate", "conclude"]) ok(nodes.includes(node), `${node}: ${nodes.join(", ")}`);
  // The loop's tune task ran the tuning graph: its line ends after the tuning's lines.
  const tune = activity.findIndex((line) => line.graph === "loop" && line.node === "tune");
  ok(tune > activity.map((line) => line.graph).lastIndexOf("tuning"));
});

test("a task's subject is its case, its cluster with its hypothesis, or its target", () => {
  deepStrictEqual([
    taskSubject({ index: 1, plan: [{ name: "a" }, { name: "b" }] }), taskSubject({ clusterId: "d-1" }), taskSubject({ clusterId: "d-1", variant: 2 }),
    taskSubject({ targetId: "t-1" }), taskSubject({ plan: [] }), taskSubject(null),
  ], ["b", "d-1", "d-1 hypothesis 2", "t-1", null, null]);
});
