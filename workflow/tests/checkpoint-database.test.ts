import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { checkpointBusyTimeoutMs, openCheckpointSaver } from "../src/graph/checkpoint-database.js";
import { SetupError } from "../src/host/setup-error.js";

const reader = fileURLToPath(new URL("./checkpoint-reader.ts", import.meta.url));

function scratch(): { folder: string; path: string } {
  const folder = mkdtempSync(join(tmpdir(), "workflow-checkpoints-"));
  return { folder, path: join(folder, "checkpoints.sqlite") };
}

type ReaderLine = { ready?: true; seen?: number; done?: true; reads?: number; distinct?: number; history?: number; error?: string };

/** Starts the reader process on `path`; `lines` yields what it prints and `exit` its exit code. */
function startReader(path: string, threadId: string, final: number) {
  const child = spawn(process.execPath, ["--import", "tsx", reader, path, threadId, String(final)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exit = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
  const lines: ReaderLine[] = [];
  const waiters: Array<() => void> = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    lines.push(JSON.parse(line) as ReaderLine);
    for (const wake of waiters.splice(0)) wake();
  });
  /** Resolves once the reader printed a line that satisfies `predicate`; rejects when it exits first. */
  const until = (predicate: (line: ReaderLine) => boolean) => new Promise<void>((resolve, reject) => {
    const check = () => {
      if (lines.some(predicate)) resolve();
      else waiters.push(check);
    };
    void exit.then(({ code, stderr: text }) => {
      if (!lines.some(predicate)) reject(new Error(`The reader exited with ${code} first: ${JSON.stringify(lines)} ${text}`));
    }).catch(reject);
    check();
  });
  /** Ends the reader if it still runs, and waits for its exit. */
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exit;
  };
  return { lines, until, exit, stop };
}

const Counter = Annotation.Root({ count: Annotation<number>() });

test("a checkpoint database is in WAL mode with a busy timeout", () => {
  const { folder, path } = scratch();
  try {
    const saver = openCheckpointSaver(path);
    try {
      equal(saver.db.pragma("journal_mode", { simple: true }), "wal");
      equal(saver.db.pragma("busy_timeout", { simple: true }), checkpointBusyTimeoutMs);
    } finally {
      saver.db.close();
    }
    // WAL mode is a property of the file: a plain connection opened later finds it.
    const plain = new Database(path);
    try {
      equal(plain.pragma("journal_mode", { simple: true }), "wal");
    } finally {
      plain.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a database that cannot be put in WAL mode is a setup error, and its connection is closed", (context) => {
  const close = context.mock.method(Database.prototype, "close");
  // SQLite keeps a temporary database, which the empty path names, in its rollback journal mode.
  throws(
    () => openCheckpointSaver(""),
    (error: unknown) => error instanceof SetupError && error.message.includes("cannot be put in WAL mode: its journal mode stays delete."),
  );
  equal(close.mock.callCount(), 1);
  equal((close.mock.calls[0]!.this as Database.Database).open, false);
});

test("a second saver waits for a writer's lock instead of failing", async () => {
  const { folder, path } = scratch();
  try {
    const first = openCheckpointSaver(path);
    const second = openCheckpointSaver(path);
    let exited: Promise<number | null> = Promise.resolve(null);
    try {
      second.db.exec("CREATE TABLE marks (value INTEGER)");
      // A process of its own holds the write lock for half a second with an uncommitted row, then commits.
      const holder = spawn(process.execPath, ["-e", `
const Database = require("better-sqlite3");
const database = new Database(process.argv[1]);
database.exec("BEGIN IMMEDIATE");
database.prepare("INSERT INTO marks VALUES (1)").run();
console.log("locked");
setTimeout(() => { database.exec("COMMIT"); database.close(); }, 500);
`, path], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
      exited = new Promise<number | null>((resolve) => holder.once("exit", resolve));
      await new Promise<void>((resolve, reject) => {
        holder.once("error", reject);
        void exited.then((code) => reject(new Error(`The lock holder exited with ${code} before it held the lock.`)));
        holder.stdout.once("data", () => resolve());
      });
      // The holder's write is not committed yet: a reader sees the database as it was, without waiting.
      equal((first.db.prepare("SELECT COUNT(*) AS n FROM marks").get() as { n: number }).n, 0);
      // A write while the holder has the lock waits for its commit, then succeeds (with a busy timeout of 0 it fails at once).
      first.db.prepare("INSERT INTO marks VALUES (2)").run();
      equal(await exited, 0);
      deepEqual((second.db.prepare("SELECT value FROM marks ORDER BY rowid").all() as Array<{ value: number }>).map((row) => row.value), [1, 2]);
    } finally {
      await exited;
      first.db.close();
      second.db.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a reader with a second saver reads a checkpoint database while a graph writes it, without an error and with every write committed", async () => {
  const { folder, path } = scratch();
  const threadId = "wf-concurrent";
  const steps = 120;
  const started = startReader(path, threadId, steps);
  try {
    await started.until((line) => line.ready === true);
    const writer = openCheckpointSaver(path);
    try {
      const graph = new StateGraph(Counter)
        .addNode("step", async (state) => {
          // Halfway, the graph waits until the reader has seen a checkpoint it wrote, so the reads overlap the writes.
          if (state.count === steps / 2) await started.until((line) => line.seen !== undefined && line.seen > 0);
          return { count: state.count + 1 };
        })
        .addEdge(START, "step")
        .addConditionalEdges("step", (state) => (state.count < steps ? "step" : END), ["step", END])
        .compile({ checkpointer: writer });
      const result = await graph.invoke({ count: 0 }, { configurable: { thread_id: threadId }, recursionLimit: steps + 10 });
      equal(result.count, steps);

      const { code, stderr } = await started.exit;
      const errors = started.lines.filter((line) => line.error !== undefined);
      deepEqual(errors, [], `the reader failed: ${stderr}`);
      equal(code, 0, stderr);
      const done = started.lines.find((line) => line.done === true);
      ok(done !== undefined, "the reader did not finish");
      const seen = started.lines.filter((line) => line.seen !== undefined).map((line) => line.seen!);
      ok(seen.some((count) => count > 0 && count < steps), `the reader saw no checkpoint written while the graph ran: ${JSON.stringify(seen)}`);
      equal(seen[seen.length - 1], steps);
    } finally {
      writer.db.close();
    }

    // Every write is committed: a fresh saver finds every checkpoint of the run, the input's and one per step.
    const fresh = openCheckpointSaver(path);
    try {
      const counts: number[] = [];
      for await (const tuple of fresh.list({ configurable: { thread_id: threadId } })) {
        if (tuple.config.configurable?.checkpoint_ns !== "") continue;
        const count = (tuple.checkpoint.channel_values as { count?: number }).count;
        if (count !== undefined) counts.push(count);
      }
      const ascending = [...counts].sort((a, b) => a - b);
      deepEqual(ascending, [0, ...Array.from({ length: steps }, (_, index) => index + 1)]);
      const latest = await fresh.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: "" } });
      equal((latest?.checkpoint.channel_values as { count: number }).count, steps);
    } finally {
      fresh.db.close();
    }
  } finally {
    await started.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});
