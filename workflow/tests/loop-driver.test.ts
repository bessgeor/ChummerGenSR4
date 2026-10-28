import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ComposedWorkflow } from "../src/compose-workflow.js";
import { SetupError } from "../src/host/setup-error.js";
import { parseArguments, type Arguments } from "../src/options/arguments.js";
import { parseLoopArguments } from "../src/loop-driver/loop-arguments.js";
import { loopPaths, readLoopDocument, readThreadSummary, writeLoopDocument, type LoopDocument, type ThreadSummary } from "../src/loop-driver/loop-document.js";
import type { LoopSteps } from "../src/loop-driver/loop-graph.js";
import { hostLoopSteps, openLoopCheckpointer, runLoop } from "../src/loop-driver/run-loop.js";
import { readAutoTuning } from "../src/tuning/auto-tuning.js";
import type { AutoTuningResult } from "../src/tuning/tune-commands.js";
import { scratch } from "./diagnosis-fixtures.js";
import { agents, dueTuning, proposal } from "./tuning-auto-fixtures.js";

const loopId = "loop-20261029T090000Z-0000abcd";
const now = () => new Date("2026-10-29T09:00:00Z");

function startOf(args: string[]) {
  const command = parseLoopArguments(args);
  if (command.kind !== "start") throw new Error(`expected start, got ${command.kind}`);
  return command;
}

function argumentsOf(args: string[]): Arguments {
  const command = parseArguments(args);
  if (command.kind !== "start") throw new Error(`expected start, got ${command.kind}`);
  return command.arguments;
}

type ThreadScript = { readonly status: number; readonly summary?: Partial<ThreadSummary> };
type TuneScript = AutoTuningResult | "setup-error";

const notDue: AutoTuningResult = { kind: "not_due", count: 0, every: 12 };
const tuned = (outcome: "activated" | "no_improvement" | "rejected" | "failed", n = 1): AutoTuningResult => ({
  kind: "tuned", tuningId: `tune-${n}`, cycleId: `tc-${n}`, outcome, status: outcome === "rejected" ? 1 : outcome === "failed" ? 2 : 0,
});

/** A loop over fake threads and tunings that answer from their scripts in order and check what `loop.json` held when they started. */
function fakeLoop(threads: readonly ThreadScript[], tunings: readonly TuneScript[]) {
  const root = scratch("workflow-loop-");
  const paths = loopPaths(root);
  const lines: string[] = [];
  const runs: { threadId: string; args: Arguments; recorded: boolean }[] = [];
  const tuningStarts: { recorded: boolean }[] = [];
  let tuneCalls = 0;
  const steps = (id: string): LoopSteps => ({
    newThreadId: () => `wf-${runs.length + 1}`,
    runThread: async (threadId, args) => {
      const iteration = readLoopDocument(paths.document(id)).iterations.at(-1);
      runs.push({ threadId, args, recorded: iteration?.thread === threadId && iteration.exitStatus === null });
      const script = threads[runs.length - 1];
      if (script === undefined) throw new Error(`thread ${runs.length} was not expected`);
      return script.status;
    },
    threadSummary: (threadId) => {
      const index = runs.findIndex((run) => run.threadId === threadId);
      return { outcome: "findings_remaining", fixed: [], merged: [], admitted: [], ...threads[index]!.summary };
    },
    tune: async (onStart) => {
      const script = tunings[tuneCalls++];
      if (script === undefined) throw new Error(`tuning ${tuneCalls} was not expected`);
      if (script === "setup-error") throw new SetupError("The tuning stopped.");
      if (script.kind === "tuned") {
        onStart({ tuningId: script.tuningId, cycleId: script.cycleId });
        const tuning = readLoopDocument(paths.document(id)).iterations.at(-1)!.tuning;
        tuningStarts.push({ recorded: tuning?.kind === "tuning" && tuning.tuningId === script.tuningId && tuning.outcome === null });
      }
      return script;
    },
    writeLoop: (document) => writeLoopDocument(paths.document(id), document),
    now,
    log: (line) => lines.push(line),
  });
  const run = async (args: string[]) => {
    const checkpointer = openLoopCheckpointer(paths);
    try {
      return await runLoop(startOf(args), { paths, checkpointer, steps, newLoopId: () => loopId, now, log: (line) => lines.push(line) });
    } finally {
      checkpointer.db.close();
    }
  };
  return { root, paths, lines, runs, tuningStarts, tuneCalls: () => tuneCalls, run, document: () => readLoopDocument(paths.document(loopId)) };
}

const decisions = (document: LoopDocument) => document.iterations.map((iteration) => iteration.decision?.next ?? null);

test("a fix, then nothing new: two threads and converged with exit status 0", async () => {
  const loop = fakeLoop([{ status: 1, summary: { fixed: ["d-1"], merged: ["d-1"] } }, { status: 0, summary: { outcome: "verified_for_scope" } }], [notDue, notDue]);
  equal(await loop.run([]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.loopId, document.status, document.options], [loopId, "converged", { arguments: [], maxRuns: null }]);
  deepStrictEqual(document.iterations.map((iteration) => [iteration.thread, iteration.exitStatus, iteration.summary?.merged, iteration.tuning]), [
    ["wf-1", 1, ["d-1"], { kind: "not_due", count: 0, every: 12 }],
    ["wf-2", 0, [], { kind: "not_due", count: 0, every: 12 }],
  ]);
  deepStrictEqual(document.iterations.map((iteration) => iteration.decision), [
    { next: "thread", reasons: ["thread wf-1 merged d-1"] },
    { next: "converged", reasons: ["the thread and the tuning after it changed nothing"] },
  ]);
  equal(loop.tuneCalls(), 2);
  ok(loop.lines.includes(`Loop ${loopId} converged after 2 threads: exit 0.`), loop.lines.join("\n"));
});

test("a thread that exits with 2 ends the loop failed with exit status 2, without a tuning or another thread", async () => {
  const loop = fakeLoop([{ status: 2, summary: { merged: ["d-1"] } }], []);
  equal(await loop.run([]), 2, loop.lines.join("\n"));
  const document = loop.document();
  equal(document.status, "failed");
  deepStrictEqual([document.iterations.length, document.iterations[0]!.exitStatus, document.iterations[0]!.tuning, document.iterations[0]!.summary?.merged], [1, 2, null, ["d-1"]]);
  deepStrictEqual(document.iterations[0]!.decision, { next: "failed", reasons: ["thread wf-1 exited with 2: its execution failures need a person"] });
  equal(loop.tuneCalls(), 0);
  equal(loop.runs.length, 1);
});

test("--max-runs 1 with a merged fix ends limit after the tuning step with exit status 0", async () => {
  const loop = fakeLoop([{ status: 0, summary: { fixed: ["d-1"], merged: ["d-1"] } }], [notDue]);
  equal(await loop.run(["--max-runs", "1"]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, document.options.maxRuns, loop.tuneCalls(), decisions(document)], ["limit", 1, 1, ["limit"]]);
  deepStrictEqual(document.iterations[0]!.decision!.reasons, ["thread wf-1 merged d-1", "1 of --max-runs 1 threads ran"]);
});

test("a thread that changed nothing ends the loop converged, also with --max-runs 1", async () => {
  const loop = fakeLoop([{ status: 1, summary: { fixed: ["d-1"] } }], [tuned("no_improvement")]);
  equal(await loop.run(["--max-runs", "1"]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, decisions(document)], ["converged", ["converged"]]);
  // Fixed but not merged: the next thread would build the same source.
  deepStrictEqual(document.iterations[0]!.summary, { outcome: "findings_remaining", fixed: ["d-1"], merged: [], admitted: [] });
  deepStrictEqual(document.iterations[0]!.tuning, { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: "no_improvement", exitStatus: 0 });
});

test("a merged fix, an admitted scenario and an activated tuning each start the next thread", async () => {
  const loop = fakeLoop([
    { status: 1, summary: { fixed: ["d-1"], merged: ["d-1"] } },
    { status: 0, summary: { admitted: ["build-a@s1"] } },
    { status: 0 },
    { status: 0 },
  ], [notDue, tuned("rejected", 1), tuned("activated", 2), notDue]);
  equal(await loop.run([]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, decisions(document)], ["converged", ["thread", "thread", "thread", "converged"]]);
  deepStrictEqual(document.iterations.slice(0, 3).map((iteration) => iteration.decision!.reasons), [
    ["thread wf-1 merged d-1"], ["thread wf-2 admitted build-a@s1"], ["tuning tune-2 activated a configuration"],
  ]);
  deepStrictEqual(document.iterations.map((iteration) => iteration.tuning?.kind === "tuning" ? [iteration.tuning.outcome, iteration.tuning.exitStatus] : null), [null, ["rejected", 1], ["activated", 0], null]);
});

test("every thread is started with the loop's options under the ID recorded before it starts, and every tuning is recorded before it runs", async () => {
  const options = ["--case", "a,b", "--no-ocr", "--settings-overlay", "o", "--fix-changes"];
  const loop = fakeLoop([{ status: 0, summary: { merged: ["d-1"] } }, { status: 1, summary: { admitted: ["c"] } }, { status: 0 }], [tuned("no_improvement", 1), notDue, tuned("rejected", 2)]);
  equal(await loop.run(["--max-runs", "3", ...options]), 0, loop.lines.join("\n"));
  const expected = argumentsOf(options);
  deepStrictEqual(loop.runs, [
    { threadId: "wf-1", args: expected, recorded: true }, { threadId: "wf-2", args: expected, recorded: true }, { threadId: "wf-3", args: expected, recorded: true },
  ]);
  deepStrictEqual(loop.tuningStarts, [{ recorded: true }, { recorded: true }]);
  deepStrictEqual(loop.document().options, { arguments: options, maxRuns: 3 });
  // The third thread changed nothing: converged before the limit.
  equal(loop.document().status, "converged");
});

test("a setup error in a thread or a tuning ends the process with 3 and leaves the loop running", async () => {
  const thread = fakeLoop([{ status: 3 }], []);
  equal(await thread.run([]), 3);
  deepStrictEqual([thread.document().status, thread.document().iterations.map((iteration) => [iteration.thread, iteration.exitStatus])], ["running", [["wf-1", null]]]);
  ok(thread.lines.some((line) => line.startsWith("Setup error: Thread wf-1 of loop") && line.includes("stopped with exit status 3")), thread.lines.join("\n"));
  ok(thread.lines.includes(`Loop ${loopId} stopped; it stays running.`), thread.lines.join("\n"));

  const tuning = fakeLoop([{ status: 0, summary: { merged: ["d-1"] } }], ["setup-error"]);
  equal(await tuning.run([]), 3);
  deepStrictEqual([tuning.document().status, tuning.document().iterations[0]!.exitStatus, tuning.document().iterations[0]!.tuning], ["running", 0, null]);
  ok(tuning.lines.includes("Setup error: The tuning stopped."), tuning.lines.join("\n"));
});

test("the loop is checkpointed under its ID in out/loop/checkpoints.sqlite and recorded in out/loop/<loop>/loop.json", async () => {
  const loop = fakeLoop([{ status: 0 }], [notDue]);
  equal(await loop.run([]), 0);
  equal(loop.paths.checkpoints, join(loop.root, "out", "loop", "checkpoints.sqlite"));
  equal(loop.paths.document(loopId), join(loop.root, "out", "loop", loopId, "loop.json"));
  const checkpointer = openLoopCheckpointer(loop.paths);
  try {
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: loopId, checkpoint_ns: "" } });
    ok(tuple !== undefined);
    equal((tuple.checkpoint.channel_values["document"] as LoopDocument).status, "converged");
  } finally {
    checkpointer.db.close();
  }
});

test("npm run loop takes npm start's options except --only and --resume, and --max-runs as a positive integer", () => {
  deepStrictEqual(parseLoopArguments(["--case", "a", "--help"]), { kind: "help" });
  const command = startOf(["--case", "a", "--max-runs", "2", "--no-repair"]);
  deepStrictEqual([command.options, command.maxRuns, command.arguments], [["--case", "a", "--no-repair"], 2, argumentsOf(["--case", "a", "--no-repair"])]);
  equal(startOf([]).maxRuns, null);
  for (const args of [["--only", "capture"], ["--resume", "wf-1"], ["--max-runs"], ["--max-runs", "0"], ["--max-runs", "-1"], ["--max-runs", "1.5"], ["--max-runs", "x"],
    ["--max-runs", "--case"], ["--bogus"], ["--case"], ["--canonical-exe", "x"], ["--live-canonical", "--canonical-cache", "c"]]) {
    throws(() => parseLoopArguments(args), SetupError, args.join(" "));
  }
  throws(() => parseLoopArguments(["--bogus"]), (error: Error) => error.message === "Unknown option '--bogus'. See npm run loop -- --help.");
  throws(() => parseLoopArguments(["--only", "capture"]), (error: Error) => error.message === "npm run loop does not take --only: every thread of a loop runs the whole workflow.");
});

function writeOutcome(folder: string, outcome: object) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "outcome.json"), JSON.stringify(outcome));
}

test("a thread's summary reads its outcome.json: merges that made a commit, its fixed clusters and the cases its discovery admitted", () => {
  const folder = join(scratch("workflow-loop-"), "wf-1");
  throws(() => readThreadSummary("wf-1", folder), (error: Error) => error instanceof SetupError && error.message.includes("finished without its outcome.json"));
  writeOutcome(folder, {
    threadId: "wf-1", outcome: "findings_remaining",
    clusters: [{ clusterId: "d-1", disposition: "fixed" }, { clusterId: "d-2", disposition: "fixed" }, { clusterId: "d-3", disposition: "fixed" }, { clusterId: "d-4", disposition: "refuted" }],
    merge: { fixes: [
      { clusterId: "d-1", status: "merged", mergeCommit: "abc" }, { clusterId: "d-2", status: "merged", mergeCommit: null }, { clusterId: "d-3", status: "conflict", mergeCommit: null },
    ] },
    discovery: { threadId: "disc-wf-1", admitted: ["build-a@s1"] },
  });
  deepStrictEqual(readThreadSummary("wf-1", folder), { outcome: "findings_remaining", fixed: ["d-1", "d-2", "d-3"], merged: ["d-1"], admitted: ["build-a@s1"] });
  writeOutcome(folder, { outcome: "verified_for_scope", clusters: [], merge: null, discovery: null });
  deepStrictEqual(readThreadSummary("wf-1", folder), { outcome: "verified_for_scope", fixed: [], merged: [], admitted: [] });
});

test("on this machine's steps, threads start through the composed workflow with a given ID and the automatic tuning runs in process", async () => {
  // A tuning due with the records of two diagnosed threads, whose candidate is activated; the second tuning is not due.
  const { context } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const root = scratch("workflow-loop-");
  const paths = loopPaths(root);
  const threadFolder = (threadId: string) => join(root, "threads", threadId);
  const runs: { command: unknown; request: unknown; outcome: boolean }[] = [];
  const workflow: ComposedWorkflow = {
    run: async (command, request) => {
      const threadId = request!.threadId!;
      // A start given an ID that exists is refused, so the loop's thread is new when it starts.
      runs.push({ command, request, outcome: existsSync(join(threadFolder(threadId), "outcome.json")) });
      writeOutcome(threadFolder(threadId), { outcome: "findings_remaining", clusters: [], merge: null, discovery: null });
      return 1;
    },
    close: () => {},
  };
  const lines: string[] = [];
  const checkpointer = openLoopCheckpointer(paths);
  let status;
  try {
    status = await runLoop(startOf(["--case", "a", "--no-repair"]), {
      paths, checkpointer, now, newLoopId: () => loopId, log: (line) => lines.push(line),
      steps: (id) => hostLoopSteps(id, paths, workflow, threadFolder, context, now, (line) => lines.push(line)),
    });
  } finally {
    checkpointer.db.close();
  }
  equal(status, 0, [...lines, ...context.lines].join("\n"));
  const document = readLoopDocument(paths.document(loopId));
  equal(document.status, "converged");
  equal(runs.length, 2);
  for (const [index, run] of runs.entries()) {
    deepStrictEqual(run, { command: { kind: "start", arguments: argumentsOf(["--case", "a", "--no-repair"]) }, request: { threadId: document.iterations[index]!.thread }, outcome: false });
    ok(/^wf-\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(document.iterations[index]!.thread), document.iterations[index]!.thread);
  }
  const ended = readAutoTuning(context.paths.evalsFolder).tunings[0]!;
  deepStrictEqual(document.iterations.map((iteration) => iteration.tuning), [
    { kind: "tuning", tuningId: ended.tuningId, cycle: ended.cycle, outcome: "activated", exitStatus: 0 },
    { kind: "not_due", count: 0, every: ended.records.length },
  ]);
  deepStrictEqual(decisions(document), ["thread", "converged"]);
});
