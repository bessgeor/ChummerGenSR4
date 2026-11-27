import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { SetupError } from "../src/host/setup-error.js";
import {
  controlLockPath, controlPath, invokePausable, LoopControlSchema, nothingPaused, pausable, readControl, setPaused, writeControl, type PauseGate,
} from "../src/loop/loop-control.js";
import { parseLoopArguments } from "../src/loop-driver/loop-arguments.js";
import { loopPaths, readLoopDocument, writeLoopDocument } from "../src/loop-driver/loop-document.js";
import type { LoopSteps } from "../src/loop-driver/loop-graph.js";
import { openLoopCheckpointer, runLoop } from "../src/loop-driver/run-loop.js";
import { scratch } from "./diagnosis-fixtures.js";

const now = () => new Date("2026-11-01T10:00:00Z");

test("the control file: a missing file pauses nothing, a written one is read back, and setting a flag keeps the others", () => {
  const folder = scratch("workflow-loop-control-");
  deepStrictEqual(readControl(folder), nothingPaused);
  const control = setPaused(folder, null, true, now());
  deepStrictEqual(control, { paused: true, lanes: {}, updatedUtc: "2026-11-01T10:00:00.000Z" });
  deepStrictEqual(readControl(folder), control);
  setPaused(folder, "vm", true, now());
  setPaused(folder, "desktop", false, now());
  deepStrictEqual(readControl(folder), { paused: true, lanes: { vm: { paused: true }, desktop: { paused: false } }, updatedUtc: "2026-11-01T10:00:00.000Z" });
  setPaused(folder, null, false, now());
  deepStrictEqual(readControl(folder), { paused: false, lanes: { vm: { paused: true }, desktop: { paused: false } }, updatedUtc: "2026-11-01T10:00:00.000Z" });
  // Written through a temporary file renamed into place, which does not stay behind.
  deepStrictEqual(readdirSync(folder), ["control.json"]);
  LoopControlSchema.parse(JSON.parse(readFileSync(controlPath(folder), "utf8")));
});

test("a change of a flag waits while another writer holds the lock and then keeps that writer's flag", async () => {
  const folder = scratch("workflow-loop-control-");
  setPaused(folder, null, false, now());
  const lock = controlLockPath(folder);
  writeFileSync(lock, "another writer");
  // The other writer, on its own thread: it sets a lane's flag and releases the lock while this thread waits for it.
  const other = new Worker(`
    const { rmSync, writeFileSync } = require("node:fs");
    const { workerData } = require("node:worker_threads");
    setTimeout(() => {
      writeFileSync(workerData.control, JSON.stringify({ paused: false, lanes: { vm: { paused: true } }, updatedUtc: "2026-11-01T09:00:00.000Z" }));
      rmSync(workerData.lock);
    }, 200);
  `, { eval: true, workerData: { control: controlPath(folder), lock } });
  const exited = new Promise((resolve, reject) => other.once("exit", resolve).once("error", reject));
  const control = setPaused(folder, "desktop", true, now());
  deepStrictEqual(control.lanes, { vm: { paused: true }, desktop: { paused: true } });
  deepStrictEqual(readControl(folder), control);
  equal(await exited, 0);
  deepStrictEqual(readdirSync(folder), ["control.json"]);
});

test("a lock that is not released is a setup error that names it, and the control file stays as it was", () => {
  const folder = scratch("workflow-loop-control-");
  const control = setPaused(folder, null, true, now());
  const lock = controlLockPath(folder);
  writeFileSync(lock, "a writer that was stopped");
  throws(() => setPaused(folder, null, false, now()), (error: Error) => error instanceof SetupError && error.message.includes(lock));
  deepStrictEqual(readControl(folder), control);
  ok(existsSync(lock));
});

test("an invalid control file is a setup error that names it, when it is read and when a paused node reads it", async () => {
  const folder = scratch("workflow-loop-control-");
  const path = controlPath(folder);
  writeFileSync(path, "{ paused: tru");
  throws(() => readControl(folder), (error: Error) => error instanceof SetupError && error.message.includes(path) && error.message.includes("is not JSON"));
  writeFileSync(path, JSON.stringify({ paused: "yes", lanes: {}, updatedUtc: "2026-11-01T10:00:00Z" }));
  throws(() => readControl(folder), (error: Error) => error instanceof SetupError && error.message.includes(path) && error.message.includes("does not match its schema"));
  writeFileSync(path, JSON.stringify({ paused: false, lanes: {}, updatedUtc: "2026-11-01T10:00:00Z", stop: true }));
  throws(() => readControl(folder), (error: Error) => error instanceof SetupError && error.message.includes(path));
  throws(() => writeControl(folder, { paused: false, lanes: { "": { paused: true } }, updatedUtc: "2026-11-01T10:00:00Z" }));
  const ran: string[] = [];
  await rejects(invokePausable(oneNode(ran), { log: [] }, { configurable: { thread_id: "t-invalid" } }, { folder, log: () => {} }, "Thread t-invalid"),
    (error: Error) => error instanceof SetupError && error.message.includes(path));
  deepStrictEqual(ran, []);
});

const State = Annotation.Root({ log: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }) });

function oneNode(ran: string[]) {
  return new StateGraph(State)
    .addNode("a", pausable(() => {
      ran.push("a");
      return { log: ["a"] };
    }))
    .addEdge(START, "a")
    .addEdge("a", END)
    .compile({ checkpointer: new MemorySaver() });
}

test("a pausable node of a graph run without a loop reads no control file and never pauses", async () => {
  const ran: string[] = [];
  const result = await invokePausable(oneNode(ran), { log: [] }, { configurable: { thread_id: "t-1" } }, null, "Thread t-1");
  deepStrictEqual([result.log, ran], [["a"], ["a"]]);
});

test("a graph invoked by another graph's node keeps its own checkpointer and pauses on its own: the node waits and resumes it", async () => {
  const folder = scratch("workflow-loop-control-");
  const innerSaver = new MemorySaver();
  const outerSaver = new MemorySaver();
  const ran: string[] = [];
  const inner = new StateGraph(State)
    .addNode("first", pausable(() => {
      ran.push("first");
      // The loop is paused while this node runs: it finishes, and the next node is interrupted on entry.
      setPaused(folder, null, true, now());
      return { log: ["first"] };
    }))
    .addNode("second", pausable(() => {
      ran.push("second");
      return { log: ["second"] };
    }))
    .addEdge(START, "first")
    .addEdge("first", "second")
    .addEdge("second", END)
    .compile({ checkpointer: innerSaver });
  const seen: { next: string[]; interrupted: boolean }[] = [];
  const gate: PauseGate = {
    folder, log: () => {}, pollMilliseconds: 1,
    sleep: async () => {
      const snapshot = await inner.getState({ configurable: { thread_id: "inner-1" } });
      seen.push({ next: [...snapshot.next], interrupted: snapshot.tasks.some((task) => task.interrupts.length > 0) });
      setPaused(folder, null, false, now());
    },
  };
  const pauses: number[] = [];
  const outer = new StateGraph(State)
    .addNode("run", async () => {
      const result = await invokePausable(inner, { log: [] }, { configurable: { thread_id: "inner-1" } }, gate, "Inner", (pause) => pauses.push(pause.milliseconds));
      return { log: result.log.map((line: string) => `inner ${line}`) };
    })
    .addEdge(START, "run")
    .addEdge("run", END)
    .compile({ checkpointer: outerSaver });
  const result = await outer.invoke({ log: [] }, { configurable: { thread_id: "outer-1" } });
  deepStrictEqual(result.log, ["inner first", "inner second"]);
  deepStrictEqual(ran, ["first", "second"]);
  deepStrictEqual(seen, [{ next: ["second"], interrupted: true }]);
  equal(pauses.length, 1);
  // The inner graph's checkpoints are in its own checkpointer, under its own thread at the root namespace.
  const innerThread = await inner.getState({ configurable: { thread_id: "inner-1" } });
  deepStrictEqual([innerThread.next, innerThread.values.log], [[], ["first", "second"]]);
  const outerTuples = [];
  for await (const tuple of outerSaver.list({ configurable: { thread_id: "inner-1" } })) outerTuples.push(tuple);
  deepStrictEqual(outerTuples, []);
});

test("a task running when the pause is set finishes and keeps its write; the next node is interrupted on entry and runs after the unpause", async () => {
  const folder = scratch("workflow-loop-control-");
  const ran: string[] = [];
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ordered = new StateGraph(State)
    .addNode("route", pausable(() => ({})))
    .addNode("slow", pausable(async () => {
      ran.push("slow start");
      setPaused(folder, null, true, now());
      setTimeout(release, 30);
      await blocked;
      ran.push("slow end");
      return { log: ["slow"] };
    }))
    .addNode("next", pausable(() => {
      ran.push("next");
      return { log: ["next"] };
    }))
    .addEdge(START, "route")
    .addEdge("route", "slow")
    .addEdge("slow", "next")
    .addEdge("next", END)
    .compile({ checkpointer: new MemorySaver() });
  const states: { next: string[]; log: string[] }[] = [];
  const gate: PauseGate = {
    folder, log: () => {}, pollMilliseconds: 1,
    sleep: async () => {
      const snapshot = await ordered.getState({ configurable: { thread_id: "p-1" } });
      states.push({ next: [...snapshot.next], log: [...snapshot.values.log] });
      setPaused(folder, null, false, now());
    },
  };
  const result = await invokePausable(ordered, { log: [] }, { configurable: { thread_id: "p-1" } }, gate, "Thread p-1");
  // The running task kept its write while the next was interrupted, and no finished task ran again.
  deepStrictEqual(states, [{ next: ["next"], log: ["slow"] }]);
  deepStrictEqual(ran, ["slow start", "slow end", "next"]);
  deepStrictEqual(result.log, ["slow", "next"]);
});

test("a paused loop starts no thread: its graph is interrupted on entry, and after the unpause it runs its threads and converges", async () => {
  const root = scratch("workflow-loop-");
  const paths = loopPaths(root);
  const loopId = "loop-20261101T100000Z-0000abcd";
  const lines: string[] = [];
  const runs: string[] = [];
  const steps = (id: string): LoopSteps => ({
    newThreadId: () => `wf-${runs.length + 1}`,
    runThread: async (threadId) => {
      runs.push(threadId);
      return 0;
    },
    threadSummary: () => ({ outcome: "verified_for_scope", fixed: [], merged: [], sourceChanged: false, admitted: [] }),
    tune: async () => ({ kind: "not_due", count: 0, every: 12 }),
    writeLoop: (document) => writeLoopDocument(paths.document(id), document),
    now,
    log: (line) => lines.push(line),
  });
  setPaused(paths.folder(loopId), null, true, now());
  const checkpointer = openLoopCheckpointer(paths);
  const seen: { runs: number; interrupted: boolean; status: string }[] = [];
  let status;
  try {
    status = await runLoop({ kind: "start", options: [], arguments: parseStart(), maxRuns: null }, {
      paths, checkpointer, steps, newLoopId: () => loopId, now, log: (line) => lines.push(line),
      pause: {
        pollMilliseconds: 1,
        sleep: async () => {
          const snapshot = await checkpointer.getTuple({ configurable: { thread_id: loopId, checkpoint_ns: "" } });
          const pending = snapshot?.pendingWrites?.filter(([, channel]) => channel === "__interrupt__") ?? [];
          seen.push({ runs: runs.length, interrupted: pending.length > 0, status: readLoopDocument(paths.document(loopId)).status });
          setPaused(paths.folder(loopId), null, false, now());
        },
      },
    });
  } finally {
    checkpointer.db.close();
  }
  equal(status, 0, lines.join("\n"));
  deepStrictEqual(seen, [{ runs: 0, interrupted: true, status: "running" }]);
  deepStrictEqual(runs, ["wf-1"]);
  equal(readLoopDocument(paths.document(loopId)).status, "converged");
  ok(lines.includes(`Loop ${loopId} is paused; it goes on once the loop is unpaused (npm run loop -- --unpause).`), lines.join("\n"));
  ok(lines.includes(`Loop ${loopId} goes on: the loop is unpaused.`), lines.join("\n"));
});

function parseStart() {
  const command = parseLoopArguments([]);
  if (command.kind !== "start") throw new Error("expected a start");
  return command.arguments;
}
