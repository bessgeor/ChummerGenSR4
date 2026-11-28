import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ComposedWorkflow } from "../src/compose-workflow.js";
import { acquireExclusiveLock } from "../src/host/exclusive-lock.js";
import { SetupError } from "../src/host/setup-error.js";
import type { ClusterEnd } from "../src/loop/disposition.js";
import type { MergeDocument, MergedFix, OutcomeDocument } from "../src/loop/outcome.js";
import { parseArguments, type Arguments } from "../src/options/arguments.js";
import { parseLoopArguments } from "../src/loop-driver/loop-arguments.js";
import { loopPaths, readLoopDocument, readThreadSummary, stopRequested, writeLoopDocument, type LoopDocument, type ThreadSummary } from "../src/loop-driver/loop-document.js";
import type { LoopSteps } from "../src/loop-driver/loop-graph.js";
import { endedAutoTuning, hostLoopSteps, openLoopCheckpointer, runLoop, startedAutoTuning, stopLoop, type LoopDependencies } from "../src/loop-driver/run-loop.js";
import { setPaused } from "../src/loop/loop-control.js";
import { autoTuningPath, readAutoTuning } from "../src/tuning/auto-tuning.js";
import { writeDocument } from "../src/steps/write-document.js";
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

/**
 * A thread answers its start with `status`. Started with 3 it stays checkpointed and unfinished, unless `finished` gives
 * the status it ended with before its step was stopped, or `unchecked` stops it before its first checkpoint, leaving its
 * folder; a resume answers `resumed` and finishes it. `during` runs while the thread runs.
 */
type ThreadScript = {
  readonly status: number; readonly summary?: Partial<ThreadSummary>; readonly resumed?: number; readonly finished?: number; readonly unchecked?: boolean;
  readonly during?: () => void;
};
/**
 * A tuning's result; `setup-error` before it starts; `unstarted` is announced and stops before the automatic tuning holds
 * it; `interrupted` starts the tuning and stops with a setup error, `ended` once it ended.
 */
type TuneScript = AutoTuningResult | "setup-error" | { readonly interrupted: Extract<AutoTuningResult, { kind: "tuned" }>; readonly ended?: boolean; readonly during?: () => void }
  | { readonly unstarted: Extract<AutoTuningResult, { kind: "tuned" }> } | { readonly result: AutoTuningResult; readonly during: () => void };

const notDue: AutoTuningResult = { kind: "not_due", count: 0, every: 12 };
const tuned = (outcome: "activated" | "no_improvement" | "rejected" | "failed", n = 1): Extract<AutoTuningResult, { kind: "tuned" }> => ({
  kind: "tuned", tuningId: `tune-${n}`, cycleId: `tc-${n}`, outcome, status: outcome === "rejected" ? 1 : outcome === "failed" ? 2 : 0,
});

type ThreadRun = { threadId: string; kind: "start" | "resume"; args: Arguments | null; recorded: boolean };

/**
 * A loop over fake threads and tunings that answer from their scripts in order and check what `loop.json` held when they
 * started. The threads' checkpoints and the tunings in progress outlive a run, as the workflow's and the tuning's do, so
 * a resume in a new process finds them. `compositions` counts the runs that composed what a loop runs on and those that
 * closed it.
 */
function fakeLoop(threads: readonly ThreadScript[], tunings: readonly TuneScript[], hooks: { firstWrite?: () => void } = {}) {
  const root = scratch("workflow-loop-");
  const paths = loopPaths(root);
  const lines: string[] = [];
  const runs: ThreadRun[] = [];
  const tuningStarts: { recorded: boolean }[] = [];
  const tuneCalls: (string | null)[] = [];
  const checkpointed = new Map<string, { script: ThreadScript; finished: number | null }>();
  // Threads whose start stopped before their first checkpoint: their folder is left.
  const traced = new Set<string>();
  let ids = 0;
  let inProgress: Extract<TuneScript, { interrupted: unknown }> | null = null;
  const ended = new Map<string, AutoTuningResult>();
  let started = 0;
  let consumed = 0;
  let writes = 0;
  let composed = 0;
  let closed = 0;
  const steps = (id: string): LoopSteps => {
    const recordedThread = (threadId: string) => {
      const iteration = readLoopDocument(paths.document(id)).iterations.at(-1);
      return iteration?.thread === threadId && iteration.exitStatus === null;
    };
    const recordTuningStart = (tuningId: string) => {
      const tuning = readLoopDocument(paths.document(id)).iterations.at(-1)!.tuning;
      tuningStarts.push({ recorded: tuning?.kind === "tuning" && tuning.tuningId === tuningId && tuning.outcome === null });
    };
    return {
      newThreadId: () => `wf-${++ids}`,
      threadProgress: async (threadId) => {
        const thread = checkpointed.get(threadId);
        if (thread === undefined) return { kind: "new", traces: traced.has(threadId) ? [`its folder threads/${threadId}`] : [] };
        return thread.finished === null ? { kind: "unfinished" } : { kind: "finished", exitStatus: thread.finished };
      },
      runThread: async (threadId, args) => {
        if (checkpointed.has(threadId) || traced.has(threadId)) throw new Error(`thread ${threadId} started twice`);
        runs.push({ threadId, kind: "start", args, recorded: recordedThread(threadId) });
        const script = threads[started++];
        if (script === undefined) throw new Error(`thread ${started} was not expected`);
        if (script.unchecked === true) traced.add(threadId);
        else checkpointed.set(threadId, { script, finished: script.status === 3 ? script.finished ?? null : script.status });
        script.during?.();
        return script.status;
      },
      resumeThread: async (threadId) => {
        const thread = checkpointed.get(threadId);
        if (thread === undefined || thread.finished !== null) throw new Error(`thread ${threadId} cannot be resumed`);
        runs.push({ threadId, kind: "resume", args: null, recorded: recordedThread(threadId) });
        if (thread.script.resumed === undefined) throw new Error(`thread ${threadId} was not expected to resume`);
        thread.finished = thread.script.resumed;
        return thread.script.resumed;
      },
      threadSummary: (threadId) => {
        const script = checkpointed.get(threadId)!.script;
        return { outcome: "findings_remaining", fixed: [], merged: [], sourceChanged: false, admitted: [], ...script.summary };
      },
      tuningStarted: (tuningId) => ended.has(tuningId) || inProgress?.interrupted.tuningId === tuningId,
      tune: async (onStart, recorded) => {
        tuneCalls.push(recorded);
        const done = recorded === null ? undefined : ended.get(recorded);
        if (done !== undefined) return done;
        if (inProgress !== null) {
          // tune auto continues the tuning in progress before it counts anything.
          const result = inProgress.interrupted;
          inProgress = null;
          onStart({ tuningId: result.tuningId, cycleId: result.cycleId });
          recordTuningStart(result.tuningId);
          ended.set(result.tuningId, result);
          return result;
        }
        const script = tunings[consumed++];
        if (script === undefined) throw new Error(`tuning ${consumed} was not expected`);
        if (script === "setup-error") throw new SetupError("The tuning stopped.");
        if ("unstarted" in script) {
          onStart({ tuningId: script.unstarted.tuningId, cycleId: script.unstarted.cycleId });
          recordTuningStart(script.unstarted.tuningId);
          throw new SetupError("The tuning stopped.");
        }
        const result = "interrupted" in script ? script.interrupted : "result" in script ? script.result : script;
        if (result.kind === "tuned") {
          onStart({ tuningId: result.tuningId, cycleId: result.cycleId });
          recordTuningStart(result.tuningId);
        }
        if ("during" in script) script.during?.();
        if ("interrupted" in script) {
          if (script.ended === true) ended.set(script.interrupted.tuningId, script.interrupted);
          else inProgress = script;
          throw new SetupError("The tuning stopped.");
        }
        if (result.kind === "tuned") ended.set(result.tuningId, result);
        return result;
      },
      writeLoop: (document) => {
        writeLoopDocument(paths.document(id), document);
        if (writes++ === 0) hooks.firstWrite?.();
      },
      readLoop: () => readLoopDocument(paths.document(id)),
      stopRequested: () => stopRequested(paths, id),
      now,
      log: (line) => lines.push(line),
    };
  };
  const run = async (args: string[], pausing: Pick<LoopDependencies, "pause" | "signal"> = {}) => {
    const command = parseLoopArguments(args);
    if (command.kind !== "start" && command.kind !== "resume") throw new Error(`expected start or resume, got ${command.kind}`);
    const compose = (id: string) => {
      composed++;
      const checkpointer = openLoopCheckpointer(paths);
      return { checkpointer, steps: steps(id), close: () => { closed++; checkpointer.db.close(); } };
    };
    return runLoop(command, { paths, compose, newLoopId: () => loopId, now, log: (line) => lines.push(line), ...pausing });
  };
  const stop = () => equal(stopLoop(loopId, paths, now, (line) => lines.push(line)), 0);
  const compositions = () => ({ composed, closed });
  return { root, paths, lines, runs, tuningStarts, tuneCalls, compositions, run, stop, document: () => readLoopDocument(paths.document(loopId)) };
}

const decisions = (document: LoopDocument) => document.iterations.map((iteration) => iteration.decision?.next ?? null);

test("a fix, then nothing new: two threads and converged with exit status 0", async () => {
  const loop = fakeLoop([{ status: 1, summary: { fixed: ["d-1"], merged: ["d-1"], sourceChanged: true } }, { status: 0, summary: { outcome: "verified_for_scope" } }], [notDue, notDue]);
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
  equal(loop.tuneCalls.length, 2);
  ok(loop.lines.includes(`Loop ${loopId} converged after 2 threads: exit 0.`), loop.lines.join("\n"));
});

test("a thread that exits with 2 ends the loop failed with exit status 2, without a tuning or another thread", async () => {
  const loop = fakeLoop([{ status: 2, summary: { merged: ["d-1"], sourceChanged: true } }], []);
  equal(await loop.run([]), 2, loop.lines.join("\n"));
  const document = loop.document();
  equal(document.status, "failed");
  deepStrictEqual([document.iterations.length, document.iterations[0]!.exitStatus, document.iterations[0]!.tuning, document.iterations[0]!.summary?.merged], [1, 2, null, ["d-1"]]);
  deepStrictEqual(document.iterations[0]!.decision, { next: "failed", reasons: ["thread wf-1 exited with 2: its execution failures need a person"] });
  equal(loop.tuneCalls.length, 0);
  equal(loop.runs.length, 1);
});

test("--max-runs 1 with a merged fix ends limit after the tuning step with exit status 0", async () => {
  const loop = fakeLoop([{ status: 0, summary: { fixed: ["d-1"], merged: ["d-1"], sourceChanged: true } }], [notDue]);
  equal(await loop.run(["--max-runs", "1"]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, document.options.maxRuns, loop.tuneCalls.length, decisions(document)], ["limit", 1, 1, ["limit"]]);
  deepStrictEqual(document.iterations[0]!.decision!.reasons, ["thread wf-1 merged d-1", "1 of --max-runs 1 threads ran"]);
});

test("a thread that changed nothing ends the loop converged, also with --max-runs 1", async () => {
  const loop = fakeLoop([{ status: 1, summary: { fixed: ["d-1"] } }], [tuned("no_improvement")]);
  equal(await loop.run(["--max-runs", "1"]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, decisions(document)], ["converged", ["converged"]]);
  // Fixed but not merged: the next thread would build the same source.
  deepStrictEqual(document.iterations[0]!.summary, { outcome: "findings_remaining", fixed: ["d-1"], merged: [], sourceChanged: false, admitted: [] });
  deepStrictEqual(document.iterations[0]!.tuning, { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: "no_improvement", exitStatus: 0 });
});

test("a failed tuning ends the loop failed with exit status 2, also when the thread changed nothing", async () => {
  const loop = fakeLoop([{ status: 0, summary: { fixed: ["d-1"], merged: ["d-1"], sourceChanged: false } }], [tuned("failed")]);
  equal(await loop.run([]), 2, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, loop.runs.length], ["failed", 1]);
  deepStrictEqual(document.iterations[0]!.tuning, { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: "failed", exitStatus: 2 });
  deepStrictEqual(document.iterations[0]!.decision, { next: "failed", reasons: ["tuning tune-1 failed with exit status 2: its execution failures need a person"] });
});

test("a failed tuning ends the loop failed after a thread that merged a fix, without another thread", async () => {
  const loop = fakeLoop([{ status: 0, summary: { fixed: ["d-1"], merged: ["d-1"], sourceChanged: true } }], [tuned("failed")]);
  equal(await loop.run(["--max-runs", "3"]), 2, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, loop.runs.length, decisions(document)], ["failed", 1, ["failed"]]);
});

test("a rejected tuning is not an execution failure: the loop goes on only when something changed", async () => {
  const loop = fakeLoop([{ status: 0, summary: { fixed: ["d-1"], merged: ["d-1"], sourceChanged: false } }], [tuned("rejected")]);
  equal(await loop.run([]), 0, loop.lines.join("\n"));
  deepStrictEqual([loop.document().status, loop.runs.length], ["converged", 1]);
});

test("a merged fix, an admitted scenario and an activated tuning each start the next thread", async () => {
  const loop = fakeLoop([
    { status: 1, summary: { fixed: ["d-1"], merged: ["d-1"], sourceChanged: true } },
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
  const loop = fakeLoop([{ status: 0, summary: { merged: ["d-1"], sourceChanged: true } }, { status: 1, summary: { admitted: ["c"] } }, { status: 0 }], [tuned("no_improvement", 1), notDue, tuned("rejected", 2)]);
  equal(await loop.run(["--max-runs", "3", ...options]), 0, loop.lines.join("\n"));
  const expected = argumentsOf(options);
  deepStrictEqual(loop.runs, [
    { threadId: "wf-1", kind: "start", args: expected, recorded: true }, { threadId: "wf-2", kind: "start", args: expected, recorded: true },
    { threadId: "wf-3", kind: "start", args: expected, recorded: true },
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
  ok(thread.lines.includes(`Loop ${loopId} stopped; it stays running. Resume it with: npm run loop -- --resume ${loopId}`), thread.lines.join("\n"));

  const tuning = fakeLoop([{ status: 0, summary: { merged: ["d-1"], sourceChanged: true } }], ["setup-error"]);
  equal(await tuning.run([]), 3);
  deepStrictEqual([tuning.document().status, tuning.document().iterations[0]!.exitStatus, tuning.document().iterations[0]!.tuning], ["running", 0, null]);
  ok(tuning.lines.includes("Setup error: The tuning stopped."), tuning.lines.join("\n"));
});

test("a stop requested while a thread runs lets the thread end and starts no tuning or further thread: stopped with exit status 0", async () => {
  let loop: ReturnType<typeof fakeLoop>;
  loop = fakeLoop([{ status: 1, summary: { merged: ["d-1"], sourceChanged: true }, during: () => loop.stop() }], []);
  equal(await loop.run([]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, loop.runs.length, loop.tuneCalls.length], ["stopped", 1, 0]);
  deepStrictEqual([document.iterations[0]!.exitStatus, document.iterations[0]!.summary?.merged, document.iterations[0]!.tuning], [1, ["d-1"], null]);
  deepStrictEqual(document.iterations[0]!.decision, { next: "stopped", reasons: ["a stop was requested before the tuning"] });
  ok(loop.lines.includes(`Loop ${loopId} stopped after 1 threads: exit 0.`), loop.lines.join("\n"));
  ok(existsSync(loop.paths.stopRequest(loopId)));
});

test("a stop requested while a tuning runs lets the tuning end and starts no further thread", async () => {
  let loop: ReturnType<typeof fakeLoop>;
  loop = fakeLoop([{ status: 0, summary: { merged: ["d-1"], sourceChanged: true } }], [{ result: tuned("activated"), during: () => loop.stop() }]);
  equal(await loop.run([]), 0, loop.lines.join("\n"));
  const document = loop.document();
  deepStrictEqual([document.status, loop.runs.length, loop.tuneCalls.length], ["stopped", 1, 1]);
  deepStrictEqual(document.iterations[0]!.tuning, { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: "activated", exitStatus: 0 });
  deepStrictEqual(document.iterations[0]!.decision, {
    next: "stopped", reasons: ["thread wf-1 merged d-1", "tuning tune-1 activated a configuration", "a stop was requested before the next thread"],
  });
});

test("a stop requested before the first thread starts no thread; a loop that ends on its own ends so despite a stop request", async () => {
  let first: ReturnType<typeof fakeLoop>;
  first = fakeLoop([], [], { firstWrite: () => first.stop() });
  equal(await first.run([]), 0, first.lines.join("\n"));
  deepStrictEqual([first.document().status, first.document().iterations, first.runs.length], ["stopped", [], 0]);
  ok(first.lines.includes(`Loop ${loopId}: stopped; a stop was requested before the first thread.`), first.lines.join("\n"));

  let converged: ReturnType<typeof fakeLoop>;
  converged = fakeLoop([{ status: 0 }], [{ result: notDue, during: () => converged.stop() }]);
  equal(await converged.run([]), 0);
  deepStrictEqual([converged.document().status, decisions(converged.document())], ["converged", ["converged"]]);

  let failed: ReturnType<typeof fakeLoop>;
  failed = fakeLoop([{ status: 2, during: () => failed.stop() }], []);
  equal(await failed.run([]), 2);
  equal(failed.document().status, "failed");
});

test("--stop names a loop that exists: an unknown loop or an invalid ID is a setup error that writes nothing", () => {
  const root = scratch("workflow-loop-");
  const paths = loopPaths(root);
  const lines: string[] = [];
  equal(stopLoop(loopId, paths, now, (line) => lines.push(line)), 3);
  ok(lines.includes(`Setup error: There is no loop ${loopId} (${paths.document(loopId)}).`), lines.join("\n"));
  equal(stopLoop("loop-../x", paths, now, (line) => lines.push(line)), 3);
  ok(lines.includes("Setup error: 'loop-../x' is not a loop ID (loop-<time>-<suffix>)."), lines.join("\n"));
  equal(existsSync(paths.root), false);
  writeLoopDocument(paths.document(loopId), {
    schemaVersion: 1, loopId, startedUtc: now().toISOString(), options: { arguments: [], maxRuns: null }, status: "running", iterations: [],
  });
  equal(stopLoop(loopId, paths, now, (line) => lines.push(line)), 0);
  equal(stopRequested(paths, loopId), true);
  ok(lines.includes(`Loop ${loopId}: stop requested (${paths.stopRequest(loopId)}); it ends stopped before its next thread or tuning. `
    + "A loop stopped by a setup error or Ctrl+C ends so when it is resumed, after the step it was running."), lines.join("\n"));
});

test("a loop resumed after a setup error in its second thread resumes that thread, starts no other in its place, and goes on", async () => {
  const loop = fakeLoop([
    { status: 0, summary: { merged: ["d-1"], sourceChanged: true } },
    { status: 3, resumed: 1, summary: { admitted: ["build-a@s1"] } },
    { status: 0 },
  ], [notDue, notDue, notDue]);
  equal(await loop.run([]), 3, loop.lines.join("\n"));
  deepStrictEqual([loop.document().status, loop.document().iterations.map((iteration) => [iteration.thread, iteration.exitStatus])], ["running", [["wf-1", 0], ["wf-2", null]]]);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind, run.recorded]), [["wf-1", "start", true], ["wf-2", "start", true], ["wf-2", "resume", true], ["wf-3", "start", true]]);
  const document = loop.document();
  deepStrictEqual([document.status, document.iterations.map((iteration) => [iteration.thread, iteration.exitStatus])], ["converged", [["wf-1", 0], ["wf-2", 1], ["wf-3", 0]]]);
  deepStrictEqual(document.iterations[1]!.decision, { next: "thread", reasons: ["thread wf-2 admitted build-a@s1"] });
  ok(loop.lines.some((line) => line.startsWith(`Resuming loop ${loopId} at run_thread:`)), loop.lines.join("\n"));
  ok(loop.lines.includes(`Loop ${loopId}: resuming thread wf-2.`), loop.lines.join("\n"));
});

test("a resumed loop whose thread had finished before its step was stopped takes the thread's exit status and runs it again in no way", async () => {
  const loop = fakeLoop([{ status: 3, finished: 1, summary: { merged: ["d-1"], sourceChanged: true } }, { status: 0 }], [notDue, notDue]);
  equal(await loop.run([]), 3);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind]), [["wf-1", "start"], ["wf-2", "start"]]);
  deepStrictEqual(loop.document().iterations.map((iteration) => iteration.exitStatus), [1, 0]);
  ok(loop.lines.includes(`Loop ${loopId}: thread wf-1 had finished with exit status 1.`), loop.lines.join("\n"));
});

test("a thread resumed into execution failures ends the loop failed", async () => {
  const loop = fakeLoop([{ status: 3, resumed: 2 }], []);
  equal(await loop.run([]), 3);
  equal(await loop.run(["--resume", loopId]), 2);
  deepStrictEqual([loop.document().status, loop.tuneCalls.length, decisions(loop.document())], ["failed", 0, ["failed"]]);
});

test("a loop resumed after a setup error in its tuning continues the tuning in progress, and the next thread starts only after it", async () => {
  const loop = fakeLoop([{ status: 0 }, { status: 0 }], [{ interrupted: tuned("activated", 1) }, notDue]);
  equal(await loop.run([]), 3, loop.lines.join("\n"));
  // The tuning was recorded before it ran; the checkpoint is at the tune node.
  deepStrictEqual([loop.document().status, loop.document().iterations[0]!.tuning], ["running", { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: null, exitStatus: null }]);
  equal(loop.runs.length, 1);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  ok(loop.lines.some((line) => line.startsWith(`Resuming loop ${loopId} at tune:`)), loop.lines.join("\n"));
  // The resumed tune step names the recorded tuning, which tune auto continues; then the second thread.
  deepStrictEqual(loop.tuneCalls, [null, "tune-1", null]);
  deepStrictEqual(loop.runs.map((run) => run.threadId), ["wf-1", "wf-2"]);
  const document = loop.document();
  deepStrictEqual([document.status, document.iterations.map((iteration) => iteration.tuning)], ["converged", [
    { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: "activated", exitStatus: 0 }, { kind: "not_due", count: 0, every: 12 },
  ]]);
  deepStrictEqual(document.iterations[0]!.decision, { next: "thread", reasons: ["tuning tune-1 activated a configuration"] });
});

test("a resumed tune step whose recorded tuning had ended takes its result and starts no other tuning", async () => {
  const loop = fakeLoop([{ status: 0 }], [{ interrupted: tuned("no_improvement", 1), ended: true }]);
  equal(await loop.run([]), 3);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.tuneCalls, [null, "tune-1"]);
  deepStrictEqual(loop.document().iterations[0]!.tuning, { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: "no_improvement", exitStatus: 0 });
  equal(loop.document().status, "converged");
});

test("a stop requested while a loop was stopped by a setup error takes effect after the resumed thread ends", async () => {
  const loop = fakeLoop([{ status: 3, resumed: 0, summary: { merged: ["d-1"], sourceChanged: true } }], []);
  equal(await loop.run([]), 3);
  loop.stop();
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind]), [["wf-1", "start"], ["wf-1", "resume"]]);
  deepStrictEqual([loop.document().status, loop.tuneCalls.length, decisions(loop.document())], ["stopped", 0, ["stopped"]]);
});

test("a stop requested while a loop was stopped before its thread's or its tuning's start keeps that step from starting when the loop is resumed", async () => {
  const thread = fakeLoop([{ status: 3, unchecked: true }], []);
  equal(await thread.run([]), 3);
  thread.stop();
  equal(await thread.run(["--resume", loopId]), 0, thread.lines.join("\n"));
  deepStrictEqual([thread.document().status, thread.runs.length, thread.document().iterations.map((iteration) => [iteration.thread, iteration.exitStatus])], ["stopped", 1, [["wf-1", null]]]);
  deepStrictEqual(thread.document().iterations[0]!.decision, { next: "stopped", reasons: ["a stop was requested before the thread wf-1"] });

  const tuning = fakeLoop([{ status: 0, summary: { merged: ["d-1"], sourceChanged: true } }], ["setup-error"]);
  equal(await tuning.run([]), 3);
  tuning.stop();
  equal(await tuning.run(["--resume", loopId]), 0, tuning.lines.join("\n"));
  deepStrictEqual([tuning.document().status, tuning.tuneCalls.length, tuning.document().iterations[0]!.tuning], ["stopped", 1, null]);
  deepStrictEqual(tuning.document().iterations[0]!.decision, { next: "stopped", reasons: ["a stop was requested before the tuning"] });
});

test("a resumed thread that stopped before its first checkpoint, leaving its ID in use, starts under a new ID recorded before it starts", async () => {
  const loop = fakeLoop([{ status: 3, unchecked: true }, { status: 0 }], [notDue]);
  equal(await loop.run([]), 3);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind, run.recorded]), [["wf-1", "start", true], ["wf-2", "start", true]]);
  deepStrictEqual([loop.document().status, loop.document().iterations.map((iteration) => [iteration.thread, iteration.exitStatus])], ["converged", [["wf-2", 0]]]);
  ok(loop.lines.includes(`Loop ${loopId}: thread wf-1 stopped before it started and its ID is in use (its folder threads/wf-1); the thread starts as wf-2.`), loop.lines.join("\n"));
});

test("a replacement thread that stops with a setup error is the thread the next resume resumes", async () => {
  const loop = fakeLoop([{ status: 3, unchecked: true }, { status: 3, resumed: 0 }], [notDue]);
  equal(await loop.run([]), 3);
  equal(await loop.run(["--resume", loopId]), 3, loop.lines.join("\n"));
  deepStrictEqual([loop.document().status, loop.document().iterations.map((iteration) => iteration.thread)], ["running", ["wf-2"]]);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind, run.recorded]), [["wf-1", "start", true], ["wf-2", "start", true], ["wf-2", "resume", true]]);
  deepStrictEqual([loop.document().status, loop.document().iterations.map((iteration) => [iteration.thread, iteration.exitStatus])], ["converged", [["wf-2", 0]]]);
});

test("a stop requested after a replacement thread stopped takes effect after that thread is resumed to its end", async () => {
  const loop = fakeLoop([{ status: 3, unchecked: true }, { status: 3, resumed: 1 }], []);
  equal(await loop.run([]), 3);
  equal(await loop.run(["--resume", loopId]), 3);
  loop.stop();
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind]), [["wf-1", "start"], ["wf-2", "start"], ["wf-2", "resume"]]);
  deepStrictEqual([loop.document().status, loop.tuneCalls.length, loop.document().iterations.map((iteration) => [iteration.thread, iteration.exitStatus])],
    ["stopped", 0, [["wf-2", 1]]]);
});

test("a recorded tuning that stopped before the automatic tuning held it has not started: a stop request keeps it from starting", async () => {
  const stopped = fakeLoop([{ status: 0 }], [{ unstarted: tuned("activated", 1) }]);
  equal(await stopped.run([]), 3);
  deepStrictEqual(stopped.document().iterations[0]!.tuning, { kind: "tuning", tuningId: "tune-1", cycle: "tc-1", outcome: null, exitStatus: null });
  stopped.stop();
  equal(await stopped.run(["--resume", loopId]), 0, stopped.lines.join("\n"));
  deepStrictEqual([stopped.document().status, stopped.tuneCalls, stopped.document().iterations[0]!.tuning], ["stopped", [null], null]);
  deepStrictEqual(stopped.document().iterations[0]!.decision, { next: "stopped", reasons: ["a stop was requested before the tuning"] });

  // Without a stop request the step runs the automatic tuning anew.
  const resumed = fakeLoop([{ status: 0 }], [{ unstarted: tuned("activated", 1) }, notDue]);
  equal(await resumed.run([]), 3);
  equal(await resumed.run(["--resume", loopId]), 0, resumed.lines.join("\n"));
  deepStrictEqual([resumed.document().status, resumed.document().iterations[0]!.tuning], ["converged", { kind: "not_due", count: 0, every: 12 }]);
});

test("a resumed loop that is paused starts nothing until it is unpaused, and a stop requested meanwhile takes effect then", async () => {
  const loop = fakeLoop([{ status: 3, resumed: 0, summary: { merged: ["d-1"], sourceChanged: true } }], []);
  equal(await loop.run([]), 3);
  setPaused(loop.paths.folder(loopId), null, true, now());
  const seen: unknown[] = [];
  equal(await loop.run(["--resume", loopId], {
    pause: {
      pollMilliseconds: 1,
      sleep: async () => {
        seen.push([loop.runs.length, loop.document().status]);
        loop.stop();
        setPaused(loop.paths.folder(loopId), null, false, now());
      },
    },
  }), 0, loop.lines.join("\n"));
  deepStrictEqual(seen, [[1, "running"]]);
  deepStrictEqual(loop.runs.map((run) => [run.threadId, run.kind]), [["wf-1", "start"], ["wf-1", "resume"]]);
  deepStrictEqual([loop.document().status, loop.tuneCalls.length, decisions(loop.document())], ["stopped", 0, ["stopped"]]);
});

test("a loop interrupted while it is paused stays running, and its resume waits for the unpause before it starts the thread", async () => {
  const loop = fakeLoop([{ status: 0 }], [notDue]);
  setPaused(loop.paths.folder(loopId), null, true, now());
  const interrupt = new AbortController();
  equal(await loop.run([], {
    signal: interrupt.signal,
    pause: {
      pollMilliseconds: 1,
      sleep: async () => {
        interrupt.abort();
        throw new Error("interrupted");
      },
    },
  }), 3, loop.lines.join("\n"));
  ok(loop.lines.includes("Interrupted: the running step was stopped."), loop.lines.join("\n"));
  deepStrictEqual([loop.document().status, loop.runs.length], ["running", 0]);
  let waited = 0;
  equal(await loop.run(["--resume", loopId], {
    pause: {
      pollMilliseconds: 1,
      sleep: async () => {
        waited++;
        equal(loop.runs.length, 0);
        setPaused(loop.paths.folder(loopId), null, false, now());
      },
    },
  }), 0, loop.lines.join("\n"));
  deepStrictEqual([waited, loop.runs.map((run) => run.kind), loop.document().status], [1, ["start"], "converged"]);
});

test("a loop whose resumed step failed, then was paused again and interrupted, still resumes", async () => {
  const loop = fakeLoop([{ status: 0 }], ["setup-error", "setup-error", notDue]);
  equal(await loop.run([]), 3);
  const pause = () => setPaused(loop.paths.folder(loopId), null, true, now());
  const unpause = () => setPaused(loop.paths.folder(loopId), null, false, now());
  // Resumed while paused and unpaused, the step runs and fails again: its checkpoint keeps the value it was resumed with.
  pause();
  equal(await loop.run(["--resume", loopId], { pause: { pollMilliseconds: 1, sleep: async () => { unpause(); } } }), 3, loop.lines.join("\n"));
  // Paused again, the step is interrupted again, and the process is interrupted while it waits.
  pause();
  const interrupt = new AbortController();
  equal(await loop.run(["--resume", loopId], {
    signal: interrupt.signal,
    pause: {
      pollMilliseconds: 1,
      sleep: async () => {
        interrupt.abort();
        throw new Error("interrupted");
      },
    },
  }), 3, loop.lines.join("\n"));
  unpause();
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual([loop.document().status, loop.runs.length, loop.tuneCalls.length], ["converged", 1, 3]);
});

test("a loop run by another process does not resume, and nothing runs", async () => {
  const loop = fakeLoop([{ status: 3, resumed: 0 }], [notDue]);
  equal(await loop.run([]), 3);
  const release = acquireExclusiveLock(loop.paths.lock(loopId), "test");
  try {
    equal(await loop.run(["--resume", loopId]), 3);
  } finally {
    release();
  }
  ok(loop.lines.includes(`Setup error: Loop ${loopId} is running in another process: another process holds ${loop.paths.lock(loopId)}.`), loop.lines.join("\n"));
  // The refused resume composed nothing: only the start did.
  deepStrictEqual([loop.runs.length, loop.document().status, loop.compositions()], [1, "running", { composed: 1, closed: 1 }]);
  equal(await loop.run(["--resume", loopId]), 0, loop.lines.join("\n"));
  deepStrictEqual(loop.runs.map((run) => run.kind), ["start", "resume"]);
  deepStrictEqual(loop.compositions(), { composed: 2, closed: 2 });
});

test("a loop that ended, does not exist or has no checkpoint does not resume, and nothing runs", async () => {
  const loop = fakeLoop([{ status: 0 }], [notDue]);
  equal(await loop.run([]), 0);
  const before = loop.document();
  equal(await loop.run(["--resume", loopId]), 3);
  ok(loop.lines.includes(`Setup error: Loop ${loopId} has ended converged; only a running loop resumes.`), loop.lines.join("\n"));
  deepStrictEqual([loop.document(), loop.runs.length, loop.tuneCalls.length, loop.compositions()], [before, 1, 1, { composed: 1, closed: 1 }]);
  ok(!loop.lines.some((line) => line.includes("it stays running")), loop.lines.join("\n"));

  const stopped = fakeLoop([{ status: 0, summary: { merged: ["d-1"], sourceChanged: true } }], [{ result: notDue, during: () => stopped.stop() }]);
  equal(await stopped.run([]), 0);
  equal(await stopped.run(["--resume", loopId]), 3);
  ok(stopped.lines.includes(`Setup error: Loop ${loopId} has ended stopped; only a running loop resumes.`), stopped.lines.join("\n"));

  const unknown = fakeLoop([], []);
  equal(await unknown.run(["--resume", loopId]), 3);
  ok(unknown.lines.includes(`Setup error: There is no loop ${loopId} (${unknown.paths.document(loopId)}).`), unknown.lines.join("\n"));
  deepStrictEqual([unknown.compositions(), existsSync(unknown.paths.root)], [{ composed: 0, closed: 0 }, false]);

  // loop.json without the loop's checkpoint.
  writeLoopDocument(unknown.paths.document(loopId), { ...before, status: "running" });
  equal(await unknown.run(["--resume", loopId]), 3);
  ok(unknown.lines.includes(`Setup error: Loop ${loopId} has no checkpoint in ${unknown.paths.checkpoints}.`), unknown.lines.join("\n"));
  // Reading the checkpoint needs the composition, which is closed again.
  deepStrictEqual([unknown.runs.length, unknown.compositions()], [0, { composed: 1, closed: 1 }]);
});

test("the automatic tuning a loop recorded has started when the automatic tuning's state holds it, and ended with its outcome", () => {
  const evalsFolder = scratch("workflow-loop-");
  const entry = {
    tuningId: "tune-a", startedUtc: "2026-10-29T09:00:00.000Z", forced: false, records: ["r1"], dataset: "auto-hypothesis/v1", cycle: "tc-a",
    branch: null, commit: null, merge: null, outcome: null, finishedUtc: null,
  };
  deepStrictEqual(startedAutoTuning(evalsFolder, "tune-a"), false);
  writeDocument(autoTuningPath(evalsFolder), { schemaVersion: 1, counted: ["r1"], tunings: [], current: entry });
  equal(endedAutoTuning(evalsFolder, "tune-a"), null);
  deepStrictEqual([startedAutoTuning(evalsFolder, "tune-a"), startedAutoTuning(evalsFolder, "tune-b")], [true, false]);
  for (const [outcome, status] of [["activated", 0], ["no_improvement", 0], ["rejected", 1], ["failed", 2]] as const) {
    writeDocument(autoTuningPath(evalsFolder), { schemaVersion: 1, counted: ["r1"], tunings: [{ ...entry, outcome, finishedUtc: "2026-10-29T10:00:00.000Z" }], current: null });
    deepStrictEqual(endedAutoTuning(evalsFolder, "tune-a"), { kind: "tuned", tuningId: "tune-a", cycleId: "tc-a", outcome, status });
    equal(startedAutoTuning(evalsFolder, "tune-a"), true);
    equal(endedAutoTuning(evalsFolder, "tune-b"), null);
  }
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

test("npm run loop takes npm start's options except --only, and --max-runs as a positive integer, or --resume or --stop with a loop ID alone", () => {
  deepStrictEqual(parseLoopArguments(["--case", "a", "--help"]), { kind: "help" });
  deepStrictEqual(parseLoopArguments(["--resume", loopId]), { kind: "resume", loopId });
  deepStrictEqual(parseLoopArguments(["--stop", loopId]), { kind: "stop", loopId });
  throws(() => parseLoopArguments(["--resume", loopId, "--no-ocr"]), (error: Error) => error.message === "--resume takes no other options: a loop keeps the options it was started with.");
  const command = startOf(["--case", "a", "--max-runs", "2", "--no-repair"]);
  deepStrictEqual([command.options, command.maxRuns, command.arguments], [["--case", "a", "--no-repair"], 2, argumentsOf(["--case", "a", "--no-repair"])]);
  equal(startOf([]).maxRuns, null);
  deepStrictEqual(startOf(["--case", "constructor,toString"]).arguments.cases, ["constructor", "toString"]);
  for (const args of [["--only", "capture"], ["--resume", "wf-1"], ["--resume"], ["--resume", "--case"], ["--resume", loopId, "--case", "a"], ["--stop", "loop-../x"],
    ["--stop", loopId, "--max-runs", "2"], ["--max-runs"], ["--max-runs", "0"], ["--max-runs", "-1"], ["--max-runs", "1.5"], ["--max-runs", "x"],
    ["--max-runs", "--case"], ["--bogus"], ["--case"], ["--canonical-exe", "x"], ["--live-canonical", "--canonical-cache", "c"]]) {
    throws(() => parseLoopArguments(args), SetupError, args.join(" "));
  }
  throws(() => parseLoopArguments(["--bogus"]), (error: Error) => error.message === "Unknown option '--bogus'. See npm run loop -- --help.");
  throws(() => parseLoopArguments(["--only", "capture"]), (error: Error) => error.message === "npm run loop does not take --only: every thread of a loop runs the whole workflow.");
});

function writeOutcome(folder: string, outcome: OutcomeDocument) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "outcome.json"), JSON.stringify(outcome));
}

const end = (clusterId: string, disposition: ClusterEnd["disposition"]): ClusterEnd => ({ clusterId, disposition, attempts: 1, stage: null, reason: null, commit: null, mergeCommit: null });
const fix = (clusterId: string, status: MergedFix["status"], mergeCommit: string | null): MergedFix => ({
  clusterId, commit: `c-${clusterId}`, fixBranch: `workflow/wf-1/fix/${clusterId}`, status, mergeCommit, reason: null, files: [],
});

/** A thread's `outcome.json` as the workflow writes it, with these clusters, merges and discovery. */
function outcomeDocument(threadId: string, clusters: ClusterEnd[], merge: Pick<MergeDocument, "before" | "after" | "fixes"> | null, admitted: string[] | null): OutcomeDocument {
  return {
    threadId, outcome: clusters.every((cluster) => cluster.disposition === "fixed") ? "verified_for_scope" : "findings_remaining",
    scope: { cases: ["build-a"], captures: null }, problems: { cases: [], otherFindings: 0 }, clusters, accepted: null,
    merge: merge === null ? null : { branch: "master", integrationBranch: null, skipped: null, ...merge },
    measures: { clusters: clusters.length, fixed: 0, fixRate: null, attempts: 0, modelMilliseconds: 0, elapsedMilliseconds: null, pausedMilliseconds: 0 },
    discovery: admitted === null ? null : { threadId: `disc-${threadId}`, exitStatus: 0, admitted, differing: [], documentPath: "discovery.json" },
    concludedUtc: "2026-10-29T09:00:00.000Z",
  };
}

test("a thread's summary reads its outcome.json: its fixed and merged clusters, whether the merges changed the branch's tree, and the cases its discovery admitted", () => {
  const folder = join(scratch("workflow-loop-"), "wf-1");
  const trees: Record<string, string> = { b0: "t0", b1: "t1", b2: "t0" };
  const treeOf = (commit: string) => trees[commit]!;
  throws(() => readThreadSummary("wf-1", folder, treeOf), (error: Error) => error instanceof SetupError && error.message.includes("finished without its outcome.json"));
  const clusters = [end("d-1", "fixed"), end("d-2", "fixed"), end("d-3", "fixed"), end("d-4", "refuted")];
  const fixes = [fix("d-1", "merged", "m1"), fix("d-2", "merged", "m2"), fix("d-3", "conflict", null)];
  writeOutcome(folder, outcomeDocument("wf-1", clusters, { before: "b0", after: "b1", fixes }, ["build-a@s1"]));
  deepStrictEqual(readThreadSummary("wf-1", folder, treeOf), {
    outcome: "findings_remaining", fixed: ["d-1", "d-2", "d-3"], merged: ["d-1", "d-2"], sourceChanged: true, admitted: ["build-a@s1"],
  });
  // Merge commits that left the tree as it was (the branch had the changes already) changed nothing.
  writeOutcome(folder, outcomeDocument("wf-1", clusters, { before: "b0", after: "b2", fixes }, []));
  deepStrictEqual(readThreadSummary("wf-1", folder, treeOf), { outcome: "findings_remaining", fixed: ["d-1", "d-2", "d-3"], merged: ["d-1", "d-2"], sourceChanged: false, admitted: [] });
  writeOutcome(folder, outcomeDocument("wf-1", [], null, null));
  deepStrictEqual(readThreadSummary("wf-1", folder, treeOf), { outcome: "verified_for_scope", fixed: [], merged: [], sourceChanged: false, admitted: [] });
});

test("on this machine's steps, threads start through the composed workflow with a given ID and the automatic tuning runs in process", async () => {
  // A tuning due with the records of two diagnosed threads, whose candidate is activated; the second tuning is not due.
  const { context } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const root = scratch("workflow-loop-");
  const paths = loopPaths(root);
  const threadFolder = (threadId: string) => join(root, "threads", threadId);
  const runs: { command: unknown; request: unknown; loopFolder: string | undefined; outcome: boolean }[] = [];
  const workflow: ComposedWorkflow = {
    progress: async (threadId) => (existsSync(join(threadFolder(threadId), "outcome.json")) ? { kind: "finished", exitStatus: 1 } : { kind: "new", traces: [] }),
    run: async (command, request) => {
      const threadId = request!.threadId!;
      // A start given an ID that exists is refused, so the loop's thread is new when it starts; it pauses with the loop.
      runs.push({ command, request: { threadId: request!.threadId }, loopFolder: request!.loopControl?.folder, outcome: existsSync(join(threadFolder(threadId), "outcome.json")) });
      writeOutcome(threadFolder(threadId), outcomeDocument(threadId, [end("d-1", "refuted")], null, null));
      return 1;
    },
    close: () => {},
  };
  const lines: string[] = [];
  const status = await runLoop(startOf(["--case", "a", "--no-repair"]), {
    paths, now, newLoopId: () => loopId, log: (line) => lines.push(line),
    compose: (id) => {
      const checkpointer = openLoopCheckpointer(paths);
      return {
        checkpointer, close: () => checkpointer.db.close(),
        steps: hostLoopSteps(id, { paths, workflow, threadFolder, evalContext: context, now, log: (line) => lines.push(line) }),
      };
    },
  });
  equal(status, 0, [...lines, ...context.lines].join("\n"));
  const document = readLoopDocument(paths.document(loopId));
  equal(document.status, "converged");
  equal(runs.length, 2);
  for (const [index, run] of runs.entries()) {
    deepStrictEqual(run, { command: { kind: "start", arguments: argumentsOf(["--case", "a", "--no-repair"]) }, request: { threadId: document.iterations[index]!.thread }, loopFolder: paths.folder(loopId), outcome: false });
    ok(/^wf-\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(document.iterations[index]!.thread), document.iterations[index]!.thread);
  }
  const ended = readAutoTuning(context.paths.evalsFolder).tunings[0]!;
  const requests: unknown[] = [];
  const resuming: ComposedWorkflow = {
    ...workflow, run: async (command, request) => {
      requests.push({ command, loopFolder: request?.loopControl?.folder });
      return 0;
    },
  };
  const host = hostLoopSteps(loopId, { paths, workflow: resuming, threadFolder, evalContext: context, now, log: () => {} });
  deepStrictEqual([host.tuningStarted(ended.tuningId), host.tuningStarted("tune-never")], [true, false]);
  // A resumed thread pauses with the loop too.
  equal(await host.resumeThread("wf-1"), 0);
  deepStrictEqual(requests, [{ command: { kind: "resume", threadId: "wf-1" }, loopFolder: paths.folder(loopId) }]);
  deepStrictEqual(document.iterations.map((iteration) => iteration.tuning), [
    { kind: "tuning", tuningId: ended.tuningId, cycle: ended.cycle, outcome: "activated", exitStatus: 0 },
    { kind: "not_due", count: 0, every: ended.records.length },
  ]);
  deepStrictEqual(decisions(document), ["thread", "converged"]);
});
