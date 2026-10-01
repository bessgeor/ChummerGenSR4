// Runs start.mjs against fake-npm.mjs, so the order of the steps, the arguments each one receives and
// the exit status can be checked without building or capturing anything.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const start = join(here, "..", "start.mjs");
const fakeNpm = join(here, "fake-npm.mjs");

function runStart(args, plan, env = () => ({})) {
  const scratch = mkdtempSync(join(tmpdir(), "start-test-"));
  try {
    const log = join(scratch, "calls.jsonl");
    const runFolder = join(scratch, "run");
    const result = spawnSync(process.execPath, [start, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_execpath: fakeNpm,
        FAKE_NPM: JSON.stringify({ runFolder, ...plan }),
        FAKE_NPM_LOG: log,
        ...env(scratch),
      },
    });
    let calls = [];
    try {
      calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { status: result.status, stderr: result.stderr, calls, runFolder };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const captured = (status) => ({ status, writeRunFolder: true });

test("compare runs on capture's run folder and the higher status wins", () => {
  const run = runStart(["--case", "a"], { parity: captured(2), compare: { status: 1, reportStatus: "differences" } });

  assert.equal(run.status, 2);
  assert.deepEqual(run.calls.map((call) => call.script), ["build:candidate", "parity", "compare"]);
  assert.deepEqual(run.calls[2].args, ["--run", run.runFolder]);
});

test("the comparer's options go to the comparer and the rest to capture", () => {
  const run = runStart(["--no-ocr", "--case", "a", "--tessdata", "data"], {
    parity: captured(1),
    compare: { status: 1, reportStatus: "differences" },
  });

  assert.equal(run.status, 1);
  assert.deepEqual(run.calls[1].args.slice(0, 2), ["--case", "a"]);
  assert.equal(run.calls[1].args[2], "--run-folder-file");
  assert.equal(run.calls[1].args.length, 4);
  assert.deepEqual(run.calls[2].args, ["--run", run.runFolder, "--no-ocr", "--tessdata", "data"]);
});

test("--tessdata without a value is a setup error before anything runs", () => {
  const run = runStart(["--tessdata", "--no-ocr"], {});

  assert.equal(run.status, 3);
  assert.deepEqual(run.calls, []);
});

test("a comparer that exits with 1 without a report, as when it cannot be built, is a setup error", () => {
  const run = runStart([], { parity: captured(0), compare: { status: 1 } });

  assert.equal(run.status, 3);
  assert.match(run.stderr, /wrote no .*report\.json/);
});

test("a comparer status outside 0 to 2 is a setup error", () => {
  const run = runStart([], { parity: captured(1), compare: { status: 134, reportStatus: "differences" } });

  assert.equal(run.status, 3);
});

test("a report whose status disagrees with the comparer's exit status is a setup error", () => {
  const run = runStart([], { parity: captured(0), compare: { status: 0, reportStatus: "differences" } });

  assert.equal(run.status, 3);
  assert.match(run.stderr, /has status 'differences'/);
});

test("a capture setup error skips the comparer", () => {
  const run = runStart([], { parity: captured(3) });

  assert.equal(run.status, 3);
  assert.deepEqual(run.calls.map((call) => call.script), ["build:candidate", "parity"]);
});

test("a run folder file that cannot be read is a setup error and skips the comparer", () => {
  const run = runStart([], { parity: { status: 1, runFolderFileIsFolder: true } });

  assert.equal(run.status, 3);
  assert.match(run.stderr, /run folder that capture reported cannot be read/);
  assert.deepEqual(run.calls.map((call) => call.script), ["build:candidate", "parity"]);
});

test("a temporary folder that cannot be created is a setup error before capture", () => {
  const missing = (scratch) => join(scratch, "missing");
  const run = runStart([], {}, (scratch) => ({ TEMP: missing(scratch), TMP: missing(scratch), TMPDIR: missing(scratch) }));

  assert.equal(run.status, 3);
  assert.match(run.stderr, /cannot be created/);
  assert.deepEqual(run.calls.map((call) => call.script), ["build:candidate"]);
});

test("a failed candidate build skips capture and compare", () => {
  const run = runStart([], { "build:candidate": { status: 1 } });

  assert.equal(run.status, 3);
  assert.deepEqual(run.calls.map((call) => call.script), ["build:candidate"]);
});
