import { deepStrictEqual, equal, match, ok, rejects } from "node:assert/strict";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { noLabels, putRecord, type EvalRecord } from "../src/evals/eval-record.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { bundleClient } from "../src/dashboard/bundle.js";
import { applyControl } from "../src/dashboard/controls.js";
import { loopStatus, takeSnapshot, type DashboardSources } from "../src/dashboard/dashboard-data.js";
import { createDashboardServer } from "../src/dashboard/dashboard-server.js";
import { markRunning } from "../src/dashboard/drawing.js";
import { graphSources } from "../src/dashboard/graph-sources.js";
import { GraphReader, sendSubject, type GraphSource } from "../src/dashboard/graphs.js";
import { loopFiles, type LoopControl, type LoopDocument, type LoopState } from "../src/dashboard/loop-documents.js";
import { p80, stageStats, type StatsInput } from "../src/dashboard/stage-stats.js";
import { stageIds as workflowStageIds } from "../src/graph/workflow-graph.js";
import { drawnIds, frameNodes, taskStage } from "../src/dashboard/stages.js";
import { stageIds } from "../src/dashboard/snapshot.js";
import { scratch } from "./diagnosis-fixtures.js";
import { record } from "./eval-fixtures.js";

const minute = 60_000;

test("every node of every compiled graph belongs to a stage, and the workflow's stage subgraphs are the dashboard's stages", async () => {
  for (const stage of workflowStageIds) ok((stageIds as readonly string[]).includes(stage), `the dashboard has no stage ${stage}`);
  for (const source of graphSources(scratch("dashboard-graphs-"))) {
    const reader = new GraphReader(source);
    const nodes = await reader.nodes();
    ok(nodes.length > 0, `${source.kind} has nodes`);
    for (const node of nodes) ok(taskStage(source.kind, [], node) !== null, `${source.kind} node ${node} has no stage`);
    ok(!nodes.some((node) => frameNodes.includes(node)));
    const members = await reader.stageNodes();
    if (source.kind === "workflow") {
      deepStrictEqual(Object.keys(members), [...workflowStageIds]);
      deepStrictEqual(members.start, ["workflow:build"]);
      ok(members.diagnose?.includes("workflow:hypothesize"));
    } else {
      deepStrictEqual(members.discovery, nodes.map((node) => `discovery:${node}`));
    }
    match(await reader.drawing(), /graph TD;/);
    deepStrictEqual(reader.recentThreads(5), [], "a graph without a checkpoint file has no threads, and none is created");
    reader.close();
  }
});

test("a send's subject is its cluster, its target or its planned case", () => {
  equal(sendSubject({ clusterId: "d-1" }), "d-1");
  equal(sendSubject({ targetId: "t-2" }), "t-2");
  equal(sendSubject({ index: 1, plan: [{ name: "a" }, { name: "b" }] }), "b");
  equal(sendSubject({ index: 3, plan: [] }), null);
  equal(sendSubject(null), null);
});

/** A graph whose `repair` stage subgraph sends a capture and a repair, like the workflow's stages; `release` lets the slow task finish. */
function testGraph() {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const State = Annotation.Root({
    plan: Annotation<{ name: string }[]>(), done: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] }),
  });
  const stage = () => new StateGraph(State)
    .addNode("prepare_repair", () => ({}))
    .addNode("capture", async (state: { index: number; plan: { name: string }[] }) => ({ done: [state.plan[state.index]!.name] }))
    .addNode("repair", async (state: { clusterId: string }) => { await held; return { done: [state.clusterId] }; })
    .addEdge(START, "prepare_repair")
    .addConditionalEdges("prepare_repair", (state) => [new Send("capture", { ...state, index: 1 }), new Send("repair", { ...state, clusterId: "d-0000000000000100" })], ["capture", "repair"])
    .addEdge("capture", END)
    .addEdge("repair", END)
    .compile();
  const build = () => new StateGraph(State)
    .addNode("build", () => ({}))
    .addNode("repair", stage())
    .addEdge(START, "build")
    .addEdge("build", "repair")
    .addEdge("repair", END);
  return { build, release: () => release() };
}

test("running tasks and their subjects come from the checkpoint of a thread another process runs", async () => {
  const root = scratch("dashboard-live-");
  const checkpoints = join(root, "checkpoints.sqlite");
  const graph = testGraph();
  const runner = graph.build().compile({ checkpointer: SqliteSaver.fromConnString(checkpoints) });
  const config = { configurable: { thread_id: "wf-live" } };
  const running = runner.invoke({ plan: [{ name: "case-a" }, { name: "case-b" }] }, config);
  const source: GraphSource = { kind: "workflow", checkpoints, compile: (checkpointer) => graph.build().compile(checkpointer === undefined ? {} : { checkpointer }) };
  // The capture finishes at once and the repair waits, so the stage's checkpoint in its namespace holds one finished and one open task.
  let tasks: Awaited<ReturnType<GraphReader["openTasks"]>> = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const reader = new GraphReader(source);
    tasks = await reader.openTasks("wf-live");
    const threads = reader.recentThreads(5);
    reader.close();
    if (tasks.length === 1) {
      deepStrictEqual(threads, ["wf-live"]);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  deepStrictEqual(tasks.map(({ graph: kind, path, node, stage, subject, state }) => ({ kind, path, node, stage, subject, state })),
    [{ kind: "workflow", path: ["repair"], node: "repair", stage: "repair", subject: "d-0000000000000100", state: "running" }]);
  graph.release();
  await running;
  const reader = new GraphReader(source);
  deepStrictEqual(await reader.openTasks("wf-live"), [], "a finished thread has no open task");
  reader.close();
});

test("p80 is the nearest-rank 80th percentile", () => {
  equal(p80([]), null);
  equal(p80([5]), 5);
  equal(p80([4, 6, 8, 8, 30]), 8);
  equal(p80([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 8);
});

function statsInput(overrides: Partial<StatsInput> = {}): StatsInput {
  return { threads: [], unreadableThreads: 0, records: [], activity: null, tunings: null, ...overrides };
}

function activity(node: string, minutes: number, pausedMinutes = 0) {
  return {
    thread: "wf-1", graph: "workflow" as const, node, subject: null, lane: null, status: "succeeded",
    startedUtc: "2026-10-25T10:00:00.000Z", finishedUtc: new Date(Date.parse("2026-10-25T10:00:00.000Z") + minutes * minute).toISOString(), pausedMs: pausedMinutes * minute,
  };
}

function repairRecord(thread: string, cluster: string, attempt: number, repair: "passed" | "rejected", widening: "promoted" | "rejected" | null = null): EvalRecord {
  return record({
    recordId: `${thread}/${cluster}/repair/${attempt}`, jobKind: "repair", threadId: thread, subject: { kind: "discrepancy-cluster", id: cluster }, output: null,
    labels: {
      ...noLabels,
      repair: { outcome: repair, stage: repair === "rejected" ? "check" : null, reason: null, labelledUtc: "2026-10-25T10:00:00.000Z" },
      widening: widening === null ? null : { outcome: widening, stage: widening === "rejected" ? "character" : null, reason: null, commit: null, labelledUtc: "2026-10-25T10:00:00.000Z" },
    },
  });
}

test("p80 comes from the activity log less paused time, and routing nodes are left out", () => {
  const stats = stageStats(statsInput({
    activity: [activity("repair", 4), activity("repair", 6), activity("repair", 8), activity("repair", 10, 2), activity("repair", 30), activity("route_repair", 90)],
  }));
  deepStrictEqual(stats.repair.duration, { p80Ms: 8 * minute, samples: 5, source: "activity" });
  deepStrictEqual(stats.capture.duration, { p80Ms: null, samples: 0, source: null });
});

test("a stage without logged tasks falls back to the workflow's eval records", () => {
  const stats = stageStats(statsInput({
    activity: [],
    records: [
      record({ durationMs: 2 * minute }), record({ recordId: "wf-1/d-0000000000000100/challenge/1", jobKind: "challenge", durationMs: 3 * minute }),
      record({ recordId: "run-1/x/hypothesis/1", origin: "eval-run", durationMs: 99 * minute }),
    ],
  }));
  deepStrictEqual(stats.diagnose.duration, { p80Ms: 3 * minute, samples: 2, source: "records" });
});

test("rejections per hypothesis and widenings before rejection group repair records by thread and cluster", () => {
  const stats = stageStats(statsInput({
    records: [
      repairRecord("wf-1", "d-a", 1, "rejected"), repairRecord("wf-1", "d-a", 2, "passed", "rejected"), repairRecord("wf-1", "d-a", 3, "rejected"),
      repairRecord("wf-1", "d-b", 1, "passed", "promoted"),
    ],
  }));
  deepStrictEqual(stats.repair.counts, [{ name: "rejections per hypothesis", value: 1, detail: "max 2 · 2 rejected of 4 tries" }]);
  deepStrictEqual(stats.widen.counts, [{ name: "widenings before rejection", value: 1, detail: "2 widenings · 1 promoted" }]);
});

test("counts without data are missing, never zero", () => {
  const stats = stageStats(statsInput());
  for (const stage of Object.values(stats)) {
    for (const item of stage.counts) if (item.name !== "threads") equal(item.value, null, item.name);
  }
  const counted = stageStats(statsInput({
    threads: [
      { thread: "wf-1", triage: { discrepancies: 7, clusters: 3, newClusters: 1 }, dispositions: ["fixed", "merge_failed", "refuted"] },
      { thread: "wf-2", triage: null, dispositions: null },
    ],
    unreadableThreads: 1, tunings: 2,
    records: [
      record({ labels: { ...noLabels, check: "confirmed" } }), record({ recordId: "wf-1/d-2/hypothesis/1", labels: { ...noLabels, check: "refuted" } }),
      record({ recordId: "disc-1/t-1/scenario/1", jobKind: "scenario", threadId: "disc-1", labels: { ...noLabels, discovery: { outcome: "proven", differing: 0, labelledUtc: "2026-10-25T10:00:00.000Z" } } }),
      record({ recordId: "disc-1/t-2/scenario/1", jobKind: "scenario", threadId: "disc-1", labels: { ...noLabels, discovery: { outcome: "not-proven", differing: 0, labelledUtc: "2026-10-25T10:00:00.000Z" } } }),
    ],
  }));
  deepStrictEqual(counted.capture.counts, [
    { name: "discrepancies", value: 7, detail: "leaves out 1 unreadable thread" }, { name: "clusters", value: 3, detail: "1 new" },
  ]);
  deepStrictEqual(counted.diagnose.counts, [{ name: "hypotheses", value: 2, detail: "1 confirmed · 1 refuted" }]);
  deepStrictEqual(counted.discovery.counts, [{ name: "discoveries", value: 1, detail: "of 2 scenarios" }]);
  deepStrictEqual(counted.conclude.counts, [{ name: "fixes merged", value: 1, detail: "1 merges failed · 1 threads concluded" }]);
  deepStrictEqual(counted.tune.counts, [{ name: "tunings run", value: 2, detail: null }]);
});

const loopDocument = (endedUtc: string | null = null): LoopDocument => ({
  loopId: "loop-20261025T100000Z-0001", startedUtc: "2026-10-25T10:00:00.000Z", endedUtc,
  threads: [{ thread: "wf-1", graph: "workflow", startedUtc: "2026-10-25T10:00:00.000Z", endedUtc: null, reason: "first thread" }],
});
const loopState = (paused: boolean, pausing: boolean): LoopState => ({
  paused, pausing, updatedUtc: "2026-10-25T10:05:00.000Z",
  lanes: { desktop: { paused: false, busy: { thread: "wf-1", node: "capture", subject: "case-a" } }, vm: { paused: true, busy: null } },
});

test("the loop status follows its documents", () => {
  equal(loopStatus(loopDocument("2026-10-25T11:00:00.000Z"), loopState(false, false), null, 1000, 0), "ended");
  equal(loopStatus(loopDocument(), null, null, null, 0), "stale");
  equal(loopStatus(loopDocument(), loopState(false, false), null, 31_000, 0), "stale");
  equal(loopStatus(loopDocument(), loopState(false, false), null, 1000, 2), "running");
  const paused: LoopControl = { paused: true, lanes: {}, updatedUtc: "2026-10-25T10:05:00.000Z" };
  equal(loopStatus(loopDocument(), loopState(false, false), paused, 1000, 2), "pausing");
  equal(loopStatus(loopDocument(), loopState(true, false), paused, 1000, 0), "paused");
});

/** A repository's `out/` with one loop, its state written now, and a workflow thread's documents. */
function fixtureRoot(ended: string | null = null) {
  const root = scratch("dashboard-loop-");
  const loopRoot = join(root, "out", "loop");
  const files = loopFiles(loopRoot, "loop-20261025T100000Z-0001");
  mkdirSync(files.folder, { recursive: true });
  writeFileSync(files.loop, JSON.stringify(loopDocument(ended)));
  writeFileSync(files.state, JSON.stringify(loopState(false, false)));
  // The loop driver also keeps the graphs' drawings in `out/loop/graphs/`, which is not a loop.
  mkdirSync(join(loopRoot, "graphs"), { recursive: true });
  writeFileSync(join(loopRoot, "graphs", "loop.json"), "{}");
  writeFileSync(files.activity, `${JSON.stringify(activity("capture", 3))}\n${JSON.stringify(activity("capture", 5))}\n`);
  const threadFolder = (thread: string) => join(root, "out", "workflow", "threads", thread);
  mkdirSync(threadFolder("wf-1"), { recursive: true });
  writeFileSync(join(threadFolder("wf-1"), "triage.json"), JSON.stringify({ totals: { discrepancies: 4, clusters: 2, newClusters: 2 } }));
  const store = new SqliteStore(":memory:");
  const sources: DashboardSources = {
    loopRoot, threadFolder, threadsRoot: join(root, "out", "workflow", "threads"), tuningCycles: join(root, "out", "evals", "tuning", "cycles"),
    store, graphs: [], now: () => new Date(),
  };
  return { root, loopRoot, files, sources, store };
}

test("the snapshot shows the newest loop, its lanes, its stats and an unreadable document as a problem", async () => {
  const fixture = fixtureRoot();
  await putRecord(fixture.store, record());
  writeFileSync(join(fixture.sources.threadFolder("wf-1"), "outcome.json"), "{ not json");
  const snapshot = await takeSnapshot(fixture.sources, null);
  deepStrictEqual(snapshot.loops, ["loop-20261025T100000Z-0001"]);
  equal(snapshot.loop?.id, "loop-20261025T100000Z-0001");
  equal(snapshot.loop?.status, "running");
  equal(snapshot.live, true);
  deepStrictEqual(snapshot.loop?.lanes, [
    { name: "desktop", paused: false, busy: { thread: "wf-1", node: "capture", subject: "case-a" } }, { name: "vm", paused: true, busy: null },
  ]);
  const capture = snapshot.stages.find((stage) => stage.id === "capture")!;
  deepStrictEqual(capture.stats.duration, { p80Ms: 5 * minute, samples: 2, source: "activity" });
  equal(capture.stats.counts[0]!.value, 4);
  equal(snapshot.stages.find((stage) => stage.id === "diagnose")!.stats.counts[0]!.value, 1);
  equal(snapshot.problems.length, 1);
  match(snapshot.problems[0]!.source, /outcome\.json$/);
  // A state older than 30 seconds makes the loop stale, and the page stops calling its tasks live.
  const old = new Date(Date.now() - 60_000);
  utimesSync(fixture.files.state, old, old);
  const stale = await takeSnapshot(fixture.sources, null);
  equal(stale.loop?.status, "stale");
  equal(stale.live, false);
  const missing = await takeSnapshot(fixture.sources, "loop-unknown");
  equal(missing.loop, null);
  match(missing.problems.map((problem) => problem.message).join("\n"), /There is no loop loop-unknown/);
});

test("the snapshot has a stage box for every stage subgraph of the workflow, listing that subgraph's nodes", async () => {
  const fixture = fixtureRoot();
  const readers = graphSources(fixture.root).map((source) => new GraphReader(source));
  try {
    const snapshot = await takeSnapshot({ ...fixture.sources, graphs: readers }, null);
    for (const id of workflowStageIds) ok(snapshot.stages.some((stage) => stage.id === id), `no box for stage ${id}`);
    deepStrictEqual(snapshot.stages.find((stage) => stage.id === "start")!.nodes, ["workflow:build"]);
    ok(snapshot.stages.find((stage) => stage.id === "capture")!.nodes.includes("workflow:route_cases"));
    ok(snapshot.stages.find((stage) => stage.id === "discovery")!.nodes.includes("discovery:conclude"));
    deepStrictEqual(snapshot.stages.find((stage) => stage.id === "conclude")!.nodes, ["workflow:conclude"]);
  } finally {
    for (const reader of readers) reader.close();
  }
});

test("a control writes the loop's control file and keeps the other flags; an ended loop and an unknown lane are refused", async () => {
  const fixture = fixtureRoot();
  const now = new Date("2026-10-25T10:06:00.000Z");
  applyControl(fixture.loopRoot, { loop: "loop-20261025T100000Z-0001", lane: "vm", paused: false }, now);
  applyControl(fixture.loopRoot, { loop: "loop-20261025T100000Z-0001", lane: null, paused: true }, now);
  deepStrictEqual(JSON.parse(readFileSync(fixture.files.control, "utf8")), { paused: true, lanes: { vm: { paused: false } }, updatedUtc: now.toISOString() });
  await rejects(async () => applyControl(fixture.loopRoot, { loop: "loop-20261025T100000Z-0001", lane: "nowhere", paused: true }, now), /has no lane nowhere/);
  const ended = fixtureRoot("2026-10-25T11:00:00.000Z");
  await rejects(async () => applyControl(ended.loopRoot, { loop: "loop-20261025T100000Z-0001", lane: null, paused: true }, now), /ended/);
});

test("the server serves the page, the snapshot and the controls only to its own page with its token", async () => {
  const fixture = fixtureRoot();
  const lines: string[] = [];
  const server = createDashboardServer({ ...fixture.sources, bundle: "console.log('bundle')", log: (line) => lines.push(line) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await (await fetch(`${base}/`)).text();
    const token = /name="dashboard-token" content="([0-9a-f]+)"/.exec(page)![1]!;
    equal(await (await fetch(`${base}/app.js`)).text(), "console.log('bundle')");
    equal(((await (await fetch(`${base}/api/snapshot`)).json()) as { loop: { id: string } }).loop.id, "loop-20261025T100000Z-0001");
    const control = (body: unknown, headers: Record<string, string>) => fetch(`${base}/api/control`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
    const body = { loop: "loop-20261025T100000Z-0001", lane: "desktop", paused: true };
    equal((await control(body, {})).status, 403);
    equal((await control(body, { "x-dashboard-token": token, origin: "http://evil.example" })).status, 403);
    equal((await control({ ...body, lane: "nowhere" }, { "x-dashboard-token": token })).status, 404);
    equal((await control({ loop: "../escape", lane: null, paused: true }, { "x-dashboard-token": token })).status, 400);
    equal((await control(body, { "x-dashboard-token": token, origin: base })).status, 200);
    deepStrictEqual(JSON.parse(readFileSync(fixture.files.control, "utf8")).lanes, { desktop: { paused: true } });
    deepStrictEqual(lines, ["Dashboard: paused lane desktop of loop loop-20261025T100000Z-0001."]);
    equal((await fetch(`${base}/nothing`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("running nodes are marked in LangGraph's drawing without changing it", () => {
  const drawing = "graph TD;\n\tstart(start)\n\tcapture_capture(capture)\n\trepair_repair(repair)\n";
  equal(markRunning(drawing, []), drawing);
  equal(markRunning(drawing, [["missing"]]), drawing);
  deepStrictEqual(drawnIds(["capture"], "capture"), ["capture_capture", "capture"]);
  deepStrictEqual(drawnIds([], "rank"), ["rank"]);
  // A stage of one node is drawn as the stage itself, so its node is marked by the stage's ID.
  match(markRunning(drawing, [drawnIds(["capture"], "capture"), drawnIds(["capture"], "capture"), drawnIds(["repair"], "repair"), drawnIds(["start"], "build")]),
    /^graph TD;\n(\t.*\n){3}\tclassDef running .*\n\tclass capture_capture,repair_repair,start running;\n$/);
});

test("the React client bundles", async () => {
  const bundle = await bundleClient();
  ok(bundle.length > 1000);
  match(bundle, /api\/snapshot/);
});

test("LangGraph draws each stage subgraph of the workflow inside its drawing", async () => {
  const reader = new GraphReader(graphSources(scratch("dashboard-drawing-"))[0]!);
  const drawing = await reader.drawing();
  reader.close();
  for (const stage of ["capture", "diagnose", "repair", "widen"]) match(drawing, new RegExp(`\\tsubgraph ${stage}\\n`));
  match(drawing, new RegExp(`\\t${drawnIds(["diagnose"], "hypothesize")[0]}\\(hypothesize\\)`));
  // LangGraph draws a stage of a single node as that node.
  match(drawing, /\t__start__ --> start;/);
});
