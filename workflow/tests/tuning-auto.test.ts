import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { putRecord } from "../src/evals/eval-record.js";
import { SetupError } from "../src/host/setup-error.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { loadProfile } from "../src/options/profile.js";
import { autoTuningPath, checkAutoTuning, newHypothesisRecords, newTuningId, readAutoTuning, resolveAutoTuning, startAutoTuning, type AutoTuningState } from "../src/tuning/auto-tuning.js";
import { writeDocument } from "../src/steps/write-document.js";
import { scratch } from "./diagnosis-fixtures.js";
import { evalContext, record } from "./eval-fixtures.js";

/** An evaluation context with `count` succeeded workflow hypothesis records, and records that never count. */
async function withRecords(count: number, every = 12) {
  const context = evalContext({ autoTuning: () => ({ ...resolveAutoTuning(undefined), every }) });
  await addHypotheses(context, 0, count);
  await putRecord(context.store, record({ recordId: "wf-1/d-1/hypothesis/failed", result: { status: "infra", message: "down" } }));
  await putRecord(context.store, record({ recordId: "er-1/d-1/hypothesis/1", origin: "eval-run" }));
  await putRecord(context.store, record({ recordId: "wf-1/d-1/challenge/1", jobKind: "challenge" }));
  return context;
}

async function addHypotheses(context: ReturnType<typeof evalContext>, from: number, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, index) => `wf-1/d-${String(from + index).padStart(3, "0")}/hypothesis/1`);
  for (const recordId of ids) await putRecord(context.store, record({ recordId }));
  return ids;
}

const dependencies = (context: ReturnType<typeof evalContext>) => ({ store: context.store, evalsFolder: context.paths.evalsFolder, now: context.now, newTuningId });

test("tune auto with fewer new hypothesis records than every prints the count and changes nothing", async () => {
  const context = await withRecords(7);
  equal(await runEvalCommand(["tune", "auto"], context), 0);
  deepStrictEqual(context.lines, ["Automatic tuning: 7 of 12 new hypothesis records; not due."]);
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
  // Not even the folder of the state is created.
  equal(existsSync(dirname(autoTuningPath(context.paths.evalsFolder))), false);
});

test("only succeeded workflow hypothesis records count", async () => {
  const context = await withRecords(3);
  const trigger = await checkAutoTuning(dependencies(context), resolveAutoTuning(undefined), true);
  equal(trigger.kind, "due");
  deepStrictEqual(trigger.kind === "due" ? trigger.records : null, ["wf-1/d-000/hypothesis/1", "wf-1/d-001/hypothesis/1", "wf-1/d-002/hypothesis/1"]);
});

const nothingToFreeze = (error: Error) => error instanceof SetupError && error.message.includes("there is nothing to freeze");

test("a due tuning is recorded as in progress before its freeze; with nothing to freeze it is a setup error and the tuning stays in progress", async () => {
  const context = await withRecords(13);
  await rejects(runEvalCommand(["tune", "auto"], context), nothingToFreeze);
  equal(context.lines[0], "Automatic tuning: 13 of 12 new hypothesis records; due.");
  const state = readAutoTuning(context.paths.evalsFolder);
  equal(state.counted.length, 13);
  deepStrictEqual(state.tunings, []);
  deepStrictEqual([state.current?.records, state.current?.forced, state.current?.dataset, state.current?.cycle, state.current?.outcome], [state.counted, false, null, null, null]);
  equal(existsSync(join(context.paths.evalsFolder, "datasets", "auto-hypothesis")), false);

  // The next call continues the tuning in progress and counts nothing.
  await rejects(runEvalCommand(["tune", "auto"], context), nothingToFreeze);
  ok(context.lines.includes(`Automatic tuning ${state.current?.tuningId}: in progress since ${state.current?.startedUtc}; continued.`), context.lines.join("\n"));
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder), state);
});

test("a due tuning is recorded as in progress with the records it counts, in a file renamed into place", async () => {
  const context = await withRecords(13);
  const trigger = await checkAutoTuning(dependencies(context), resolveAutoTuning(undefined), false);
  equal(trigger.kind, "due");
  if (trigger.kind !== "due") return;
  deepStrictEqual([trigger.records.length, trigger.every, trigger.forced], [13, 12, false]);
  const tuning = startAutoTuning(dependencies(context), trigger);
  ok(/^tune-20261002T090000Z-[0-9a-f]{8}$/.test(tuning.tuningId), tuning.tuningId);
  deepStrictEqual([tuning.startedUtc, tuning.forced, tuning.records, tuning.dataset, tuning.cycle, tuning.outcome], ["2026-10-02T09:00:00.000Z", false, trigger.records, null, null, null]);
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder), { schemaVersion: 1, counted: trigger.records, tunings: [], current: tuning });
  deepStrictEqual(readdirSync(dirname(autoTuningPath(context.paths.evalsFolder))), ["auto.json"]);
  // A second start while one is in progress is refused, and nothing changes.
  throws(() => startAutoTuning(dependencies(context), trigger), /is in progress/);
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder).counted, trigger.records);
});

test("--force makes a tuning due whatever the count; unknown options are refused", async () => {
  const context = await withRecords(4, 100);
  const settings = context.autoTuning();
  deepStrictEqual(await checkAutoTuning(dependencies(context), settings, false), { kind: "not_due", count: 4, every: 100 });
  const forced = await checkAutoTuning(dependencies(context), settings, true);
  deepStrictEqual([forced.kind, forced.kind === "due" ? forced.records.length : null, forced.kind === "due" ? forced.forced : null], ["due", 4, true]);

  await rejects(runEvalCommand(["tune", "auto", "--every", "3"], context), SetupError);
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);

  await rejects(runEvalCommand(["tune", "auto", "--force"], context), nothingToFreeze);
  equal(context.lines[0], "Automatic tuning: 4 of 100 new hypothesis records, forced; due.");
  const state = readAutoTuning(context.paths.evalsFolder);
  deepStrictEqual([state.counted.length, state.current?.forced, state.current?.records], [4, true, state.counted]);
});

test("every hypothesis record is counted from one search, whatever the store's page size", async () => {
  const context = await withRecords(0);
  const ids = await addHypotheses(context, 0, 450);
  let searches = 0;
  const counting = { search: (...args: Parameters<typeof context.store.search>) => (searches += 1, context.store.search(...args)) } as unknown as BaseStore;
  deepStrictEqual(await newHypothesisRecords(counting, new Set()), ids);
  equal(searches, 1);

  const folder = scratch("workflow-auto-sqlite-");
  const sqlite = new SqliteStore(join(folder, "store.sqlite"));
  for (const recordId of ids) await putRecord(sqlite, record({ recordId }));
  deepStrictEqual(await newHypothesisRecords(sqlite, new Set(ids.slice(0, 5))), ids.slice(5));
});

test("of two overlapping starts one records its tuning and the other is refused, whatever the lock file shows", async () => {
  const context = await withRecords(13);
  const first = await checkAutoTuning(dependencies(context), resolveAutoTuning(undefined), false);
  if (first.kind !== "due") throw new Error("expected due");
  const path = autoTuningPath(context.paths.evalsFolder);

  // Another process holds the lock: nothing is written and the lock stays.
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.lock`, "1\n");
  throws(() => startAutoTuning(dependencies(context), first), (error: Error) => error instanceof SetupError && error.message.includes("auto.json.lock"));
  equal(existsSync(path), false);
  equal(existsSync(`${path}.lock`), true);
  rmSync(`${path}.lock`);

  // The lock is released after a start, and a second start from the same trigger is refused: its records are counted.
  const tuning = startAutoTuning(dependencies(context), first);
  equal(existsSync(`${path}.lock`), false);
  throws(() => startAutoTuning(dependencies(context), first), (error: Error) => error instanceof SetupError && error.message.includes(tuning.tuningId));
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder).current, tuning);

  // A start from a trigger that was computed before another tuning finished would count its records again.
  writeDocument(path, { ...readAutoTuning(context.paths.evalsFolder), tunings: [{ ...tuning, outcome: "activated", finishedUtc: "2026-10-02T10:00:00.000Z" }], current: null });
  throws(() => startAutoTuning(dependencies(context), first), (error: Error) => error instanceof SetupError && error.message.includes("counted some of these"));
  equal(readAutoTuning(context.paths.evalsFolder).current, null);
});

test("records added during a tuning are not counted by it, nothing is counted while it is in progress, and they count toward the next one", async () => {
  const context = await withRecords(13);
  const settings = context.autoTuning();
  const first = await checkAutoTuning(dependencies(context), settings, false);
  if (first.kind !== "due") throw new Error("expected due");
  const tuning = startAutoTuning(dependencies(context), first);

  const added = await addHypotheses(context, 100, 5);
  const during = await checkAutoTuning(dependencies(context), settings, false);
  deepStrictEqual(during, { kind: "in_progress", tuning });
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder).counted, first.records);
  await rejects(runEvalCommand(["tune", "auto"], context), nothingToFreeze);
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder).counted, first.records);
  deepStrictEqual(readAutoTuning(context.paths.evalsFolder).current, tuning);

  // The tuning ends: the records it did not count are the next tuning's.
  const state = readAutoTuning(context.paths.evalsFolder);
  const finished: AutoTuningState = { ...state, tunings: [{ ...tuning, outcome: "activated", finishedUtc: "2026-10-02T10:00:00.000Z" }], current: null };
  writeDocument(autoTuningPath(context.paths.evalsFolder), finished);
  deepStrictEqual(await checkAutoTuning(dependencies(context), settings, false), { kind: "not_due", count: 5, every: 12 });
  const next = await checkAutoTuning(dependencies(context), settings, true);
  deepStrictEqual(next.kind === "due" ? next.records : null, added);
});

test("an invalid autoTuning in the profile is a setup error naming the profile, and tune auto counts nothing", async () => {
  const folder = scratch("workflow-auto-profile-");
  const path = join(folder, "profile.json");
  const write = (autoTuning: unknown) => writeFileSync(path, JSON.stringify({ autoTuning }));
  write({ every: 5, dataset: "auto-next", minPass: 0.4, candidates: 3 });
  deepStrictEqual(resolveAutoTuning(loadProfile({ PARITY_WORKFLOW_PROFILE: path }).autoTuning), { every: 5, dataset: "auto-next", minPass: 0.4, candidates: 3 });
  write({});
  deepStrictEqual(resolveAutoTuning(loadProfile({ PARITY_WORKFLOW_PROFILE: path }).autoTuning), { every: 12, dataset: "auto-hypothesis", minPass: 0.5, candidates: 1 });
  for (const autoTuning of [{ every: 0 }, { every: 2.5 }, { every: "12" }, { dataset: "Auto Hypothesis" }, { minPass: 1.5 }, { candidates: 4 }, { candidates: 0 }, { cadence: 3 }]) {
    write(autoTuning);
    throws(() => loadProfile({ PARITY_WORKFLOW_PROFILE: path }), (error: Error) => error instanceof SetupError && error.message.includes(path), JSON.stringify(autoTuning));
  }

  write({ every: 0 });
  const context = await withRecords(13);
  const invalid = { ...context, autoTuning: () => resolveAutoTuning(loadProfile({ PARITY_WORKFLOW_PROFILE: path }).autoTuning) };
  await rejects(runEvalCommand(["tune", "auto"], invalid), (error: Error) => error instanceof SetupError && error.message.includes("every"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
});