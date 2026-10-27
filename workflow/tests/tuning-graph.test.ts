import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { DatasetSchema, freezeDataset, type Dataset } from "../src/evals/dataset.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { listRecords, putRecord } from "../src/evals/eval-record.js";
import { SetupError } from "../src/host/setup-error.js";
import { workflowPaths } from "../src/paths.js";
import { readDocument } from "../src/steps/read-document.js";
import { readActiveFile } from "../src/tuning/active-configuration.js";
import { autoTuningPath, newHypothesisRecords, readAutoTuning, recordAutoTuning, resolveAutoTuning, startAutoTuning, withAutoTuningRun } from "../src/tuning/auto-tuning.js";
import { readCycle } from "../src/tuning/cycle.js";
import { readLedger } from "../src/tuning/holdout.js";
import type { TuningSteps } from "../src/tuning/tuning-graph.js";
import { compileTuningGraph, tuningCheckpoints, tuningThread } from "../src/tuning/tuning-runner.js";
import { autoCycleId } from "../src/tuning/tuning-steps.js";
import { tuningId } from "../src/tuning/tuning.js";
import { FakeAgents, hypothesisAnswer, type JobCall, type Reply } from "./diagnosis-harness.js";
import { scratch } from "./diagnosis-fixtures.js";
import { holdLocks } from "./lock-holder.js";
import { evalContext, record } from "./eval-fixtures.js";
import { twoThreads } from "./eval-threads.js";
import { tuning } from "./tuning-fixtures.js";

// With the automatic dataset's seed `auto` and a 50 % test share, the cluster at x 100 lies in test and the one at x 600 in development.
const testCluster = "d-0000000000000100";
const developmentCluster = "d-0000000000000600";
const spots = [{ case: "build-alpha", capture: "skills", x: 100 }, { case: "career-beta", capture: "common", x: 600 }];

const proposal = (guidance: string) => ({ outcome: "candidate", reason: `Try: ${guidance}`, guidance: [guidance], context: "inline" });
const idOf = (guidance: string) => tuningId(tuning({ jobKind: "hypothesis", guidance: [guidance], context: "inline" }));

const readDataset = (folder: string): Dataset => readDocument(join(folder, "dataset.json"), DatasetSchema);

type Behaviour = "all" | "development" | "test" | "none";

/**
 * Agents whose tune job answers the next of `proposals`, and whose hypothesis jobs answer right on the clusters a
 * configuration's behaviour names: the code's prompt by `base`, a guidance line by `behaviours`.
 */
function agents(proposals: unknown[], base: Behaviour, behaviours: Readonly<Record<string, Behaviour>>, hang?: (call: JobCall) => boolean) {
  let next = 0;
  return new FakeAgents((call): Reply => {
    if (call.kind === "tune") return { answer: proposals[next++] ?? { outcome: "abstain", reason: "Nothing left.", guidance: null, context: null } };
    if (hang?.(call) === true) return { hang: true };
    const configuration = /^PROMPT_VERSION=\S+?(?:\+(tuned-[0-9a-f]{12}))?\n/.exec(call.prompt)![1];
    const behaviour = configuration === undefined ? base : Object.entries(behaviours).find(([guidance]) => idOf(guidance) === configuration)?.[1] ?? "none";
    const development = call.prompt.includes(developmentCluster);
    const right = behaviour === "all" || (behaviour === "development" && development) || (behaviour === "test" && !development);
    return right ? { answer: hypothesisAnswer() } : { answer: { outcome: "abstain", reason: "No idea.", explanation: null } };
  });
}

/** Two diagnosed threads' records in a store, and an evaluation context over them whose tuning is due with exactly those records. */
async function dueTuning(fake: FakeAgents) {
  const threads = await twoThreads({ spots });
  const records = await newHypothesisRecords(threads.store, new Set());
  const paths = { ...workflowPaths(scratch("workflow-auto-")), threadFolder: (id: string) => join(threads.root, "threads", id) };
  const context = evalContext({
    store: threads.store, paths, agents: () => fake, autoTuning: () => ({ ...resolveAutoTuning(undefined), every: records.length, minPass: 0.3 }),
  });
  return { context, records };
}

/** The finished tuning of `auto.json`, its dataset version and its cycle. */
function finishedTuning(evalsFolder: string) {
  const state = readAutoTuning(evalsFolder);
  equal(state.current, null);
  equal(state.tunings.length, 1);
  const entry = state.tunings[0]!;
  return { state, entry, dataset: readDataset(entry.dataset!), cycle: readCycle(evalsFolder, entry.cycle!) };
}

function checkDataset(dataset: Dataset, tuningIdValue: string, records: readonly string[], version = 1) {
  deepStrictEqual([dataset.name, dataset.version, dataset.seed, dataset.testPercent, dataset.reason], ["auto-hypothesis", version, "auto", 50, `automatic tuning ${tuningIdValue} after ${records.length} new hypothesis records`]);
  deepStrictEqual([...new Set(dataset.items.map((item) => `${item.clusterId}:${item.partition}`))].sort(), [`${testCluster}:test`, `${developmentCluster}:development`]);
}

test("a due automatic tuning freezes the next version of its dataset, activates a better candidate and ends with exit status 0", async () => {
  const { context, records } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const { state, entry, dataset, cycle } = finishedTuning(context.paths.evalsFolder);
  deepStrictEqual(state.counted, records);
  deepStrictEqual([entry.records, entry.forced, entry.outcome, entry.cycle, entry.branch, entry.commit, entry.merge], [records, false, "activated", autoCycleId(entry.tuningId), null, null, null]);
  equal(entry.dataset, join(context.paths.evalsFolder, "datasets", "auto-hypothesis", "v1"));
  checkDataset(dataset, entry.tuningId, records);
  deepStrictEqual([cycle.outcome, cycle.options.dataset, cycle.options.metric, cycle.options.minPass, cycle.options.candidates], ["activated", entry.dataset, "prediction", 0.3, 1]);
  equal(readActiveFile(context.tuningFolder(), "hypothesis")!.active.tuning?.guidance[0], "Cite the capture.");
  equal(await tuningThread(compileTuningGraph(refusingSteps(), context.tuningCheckpointer()), entry.tuningId), "finished");
  ok(context.lines.includes(`Automatic tuning ${entry.tuningId}: activated; dataset ${entry.dataset}; state ${autoTuningPath(context.paths.evalsFolder)}`), context.lines.join("\n"));
  ok(context.lines.some((line) => /proposal 1: candidate tuned-[0-9a-f]{12}, run er-.*pairs, mean difference 1.000, 95% t interval/.test(line)), context.lines.join("\n"));
  // Its cycle is the tuning's: tune cycle does not resume it.
  await rejects(runEvalCommand(["tune", "cycle", "--resume", entry.cycle!], context), (error: Error) => error instanceof SetupError && error.message.includes("tune auto continues it"));

  // Not due again until new records come; the next tuning freezes the next version.
  equal(await runEvalCommand(["tune", "auto"], context), 0);
  equal(context.lines.at(-1), `Automatic tuning: 0 of ${records.length} new hypothesis records; not due.`);
  equal(await runEvalCommand(["tune", "auto", "--force"], context), 0, context.lines.join("\n"));
  const second = readAutoTuning(context.paths.evalsFolder).tunings[1]!;
  deepStrictEqual([second.records, second.forced, second.dataset, second.outcome], [[], true, join(context.paths.evalsFolder, "datasets", "auto-hypothesis", "v2"), "no_improvement"]);
  checkDataset(readDataset(second.dataset!), second.tuningId, [], 2);
});

test("an automatic tuning without a better candidate ends no_improvement with exit status 0 and activates nothing", async () => {
  const { context } = await dueTuning(agents([proposal("Same as before.")], "all", { "Same as before.": "all" }));
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const { entry, cycle } = finishedTuning(context.paths.evalsFolder);
  deepStrictEqual([entry.outcome, cycle.outcome, cycle.holdout, cycle.testBaseline], ["no_improvement", "no_improvement", null, null]);
  deepStrictEqual(readLedger(context.tuningFolder()).exposures, []);
  equal(readActiveFile(context.tuningFolder(), "hypothesis"), null);
});

test("an automatic tuning whose candidate is worse on the holdout ends rejected with exit status 1 and keeps the ledger's exposure", async () => {
  const { context } = await dueTuning(agents([proposal("Overfit.")], "test", { "Overfit.": "development" }));
  equal(await runEvalCommand(["tune", "auto"], context), 1, context.lines.join("\n"));
  const { entry, cycle } = finishedTuning(context.paths.evalsFolder);
  deepStrictEqual([entry.outcome, cycle.outcome], ["rejected", "rejected"]);
  ok(cycle.reasons.some((reason) => reason.includes("worse than the active configuration on the test partition")), cycle.reasons.join("\n"));
  equal(readActiveFile(context.tuningFolder(), "hypothesis"), null);
  deepStrictEqual(readLedger(context.tuningFolder()).exposures.map((exposure) => exposure.testRun), [cycle.holdout!.run]);
});

test("an automatic tuning whose tune job fails ends failed with exit status 2", async () => {
  const { context } = await dueTuning(agents([{ outcome: "candidate", reason: "r", guidance: ["x".repeat(500)], context: "inline" }], "test", {}));
  equal(await runEvalCommand(["tune", "auto"], context), 2, context.lines.join("\n"));
  deepStrictEqual(finishedTuning(context.paths.evalsFolder).entry.outcome, "failed");
});

/** Steps that refuse to run: a graph compiled from them only reads its checkpoints. */
function refusingSteps(): TuningSteps {
  const refuse = () => {
    throw new Error("a step ran");
  };
  return { count: refuse, freeze: refuse, baseline: refuse, propose: refuse, holdout: refuse, testBaseline: refuse, activate: refuse, conclude: refuse };
}

/**
 * Starts a due tuning on SQLite checkpoints whose hypothesis jobs hang where `stop` says, and stops it there; returns
 * the context, the stopped tuning and the checkpoints' path.
 */
async function stoppedTuning(stop: (call: JobCall) => boolean) {
  const controller = new AbortController();
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }, (call) => {
    if (!stop(call)) return false;
    setTimeout(() => controller.abort(), 50);
    return true;
  });
  const { context: base, records } = await dueTuning(fake);
  const path = tuningCheckpoints(base.paths.evalsFolder);
  mkdirSync(join(base.paths.evalsFolder, "tuning"), { recursive: true });
  const first = SqliteSaver.fromConnString(path);
  const context = { ...base, signal: controller.signal, tuningCheckpointer: () => first };
  try {
    await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("resume it with npm run eval -- tune auto"));
  } finally {
    first.db.close();
  }
  const stopped = readAutoTuning(context.paths.evalsFolder).current!;
  return { context, records, stopped, path };
}

/** The node the stopped tuning thread waits at, read from fresh checkpoints as a new process would. */
async function nextNodes(path: string, tuningIdValue: string): Promise<string[]> {
  const saver = SqliteSaver.fromConnString(path);
  try {
    const graph = compileTuningGraph(refusingSteps(), saver);
    return [...(await graph.getState({ configurable: { thread_id: tuningIdValue } })).next];
  } finally {
    saver.db.close();
  }
}

/** Resumes the stopped tuning in a fresh process: new checkpointer, new agents. */
async function resume(context: Awaited<ReturnType<typeof stoppedTuning>>["context"], path: string) {
  const fake = agents([], "test", { "Cite the capture.": "all" });
  const saver = SqliteSaver.fromConnString(path);
  try {
    const resumed = { ...context, agents: () => fake, signal: new AbortController().signal, tuningCheckpointer: () => saver };
    const status = await runEvalCommand(["tune", "auto"], resumed);
    return { status, fake };
  } finally {
    saver.db.close();
  }
}

test("tune auto stopped while its candidate's development run runs resumes that cycle without freezing or counting again", async () => {
  const { context, records, stopped, path } = await stoppedTuning((call) => call.prompt.includes("+tuned-"));
  const cycleId = autoCycleId(stopped.tuningId);
  deepStrictEqual([stopped.records, stopped.dataset, stopped.cycle, stopped.outcome], [records, join(context.paths.evalsFolder, "datasets", "auto-hypothesis", "v1"), cycleId, null]);
  const cycle = readCycle(context.paths.evalsFolder, cycleId);
  deepStrictEqual([cycle.outcome, cycle.proposals.length, cycle.proposals[0]!.run !== null, cycle.proposals[0]!.development], ["running", 1, true, null]);
  deepStrictEqual(await nextNodes(path, stopped.tuningId), ["propose"]);

  // Records added while it is stopped are not counted by it.
  await putRecord(context.store, record({ recordId: "wf-9/d-9/hypothesis/1" }));
  const { status, fake } = await resume(context, path);
  equal(status, 0, context.lines.join("\n"));
  ok(context.lines.includes(`Automatic tuning ${stopped.tuningId}: in progress since ${stopped.startedUtc}; continued.`), context.lines.join("\n"));
  equal(fake.calls.some((call) => call.kind === "tune"), false);
  // The baseline's development samples are not run again.
  equal(fake.calls.some((call) => !call.prompt.includes("+tuned-") && call.prompt.includes(developmentCluster)), false);
  deepStrictEqual(readdirSync(join(context.paths.evalsFolder, "datasets", "auto-hypothesis")), ["v1"]);
  const { state, entry } = finishedTuning(context.paths.evalsFolder);
  deepStrictEqual([state.counted, entry.tuningId, entry.outcome], [records, stopped.tuningId, "activated"]);
  equal(readCycle(context.paths.evalsFolder, cycleId).proposals.length, 1);
});

test("tune auto killed during its holdout run resumes at its holdout node: freeze, baseline and proposals do not run again", async () => {
  const { context, stopped, path } = await stoppedTuning((call) => call.prompt.includes("+tuned-") && call.prompt.includes(testCluster));
  deepStrictEqual(await nextNodes(path, stopped.tuningId), ["holdout"]);
  const cycle = readCycle(context.paths.evalsFolder, stopped.cycle!);
  deepStrictEqual([cycle.outcome, cycle.selected !== null, cycle.holdout?.refused, cycle.testBaseline], ["running", true, null, null]);
  const runs = readdirSync(join(context.paths.evalsFolder, "runs"));

  const { status, fake } = await resume(context, path);
  equal(status, 0, context.lines.join("\n"));
  equal(fake.calls.some((call) => call.kind === "tune"), false);
  equal(fake.calls.some((call) => call.prompt.includes(developmentCluster)), false);
  deepStrictEqual(readdirSync(join(context.paths.evalsFolder, "datasets", "auto-hypothesis")), ["v1"]);
  // The holdout run resumed under its ID; only the test baseline is a new run.
  const done = readCycle(context.paths.evalsFolder, stopped.cycle!);
  deepStrictEqual(readdirSync(join(context.paths.evalsFolder, "runs")).filter((run) => !runs.includes(run)), [done.testBaseline]);
  ok(runs.includes(done.holdout!.run));
  equal(finishedTuning(context.paths.evalsFolder).entry.outcome, "activated");
});

test("tune cycle runs as a tuning thread under its cycle ID, from the baseline", async () => {
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" });
  const { context } = await dueTuning(fake);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const dataset = readAutoTuning(context.paths.evalsFolder).tunings[0]!.dataset!;
  const before = new Set(readdirSync(join(context.paths.evalsFolder, "tuning", "cycles")));
  equal(await runEvalCommand(["tune", "cycle", "--dataset", dataset, "--min-pass", "0.3"], { ...context, agents: () => agents([proposal("Same as before.")], "all", { "Same as before.": "all" }) }), 0);
  const cycleId = readdirSync(join(context.paths.evalsFolder, "tuning", "cycles")).find((name) => !before.has(name))!;
  equal(await tuningThread(compileTuningGraph(refusingSteps(), context.tuningCheckpointer()), cycleId), "finished");
  // A cycle thread neither counts nor freezes.
  deepStrictEqual([readAutoTuning(context.paths.evalsFolder).tunings.length, readdirSync(join(context.paths.evalsFolder, "datasets", "auto-hypothesis"))], [1, ["v1"]]);
});

test("a tuning whose freeze stopped after it put its version in place continues on that version", async () => {
  const { context, records } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const evalsFolder = context.paths.evalsFolder;
  // As if tune auto had recorded the tuning and its version, frozen it and stopped before its checkpoint.
  const tuning = recordedTuning(context, records);
  const target = join(evalsFolder, "datasets", "auto-hypothesis", "v1");
  recordAutoTuning(evalsFolder, tuning.tuningId, { dataset: target });
  const { folder } = await freezeAs(context, `automatic tuning ${tuning.tuningId} after ${records.length} new hypothesis records`);
  equal(folder, target);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  deepStrictEqual(readdirSync(join(evalsFolder, "datasets", "auto-hypothesis")), ["v1"]);
  const { entry, cycle } = finishedTuning(evalsFolder);
  deepStrictEqual([entry.tuningId, entry.dataset, cycle.options.dataset, entry.outcome], [tuning.tuningId, target, target, "activated"]);
});

/** As if tune auto had recorded the tuning and stopped before its checkpoint. */
function recordedTuning(context: Awaited<ReturnType<typeof dueTuning>>["context"], records: readonly string[]) {
  return startAutoTuning({ store: context.store, evalsFolder: context.paths.evalsFolder, now: context.now, newTuningId: () => "tune-20261002T090000Z-0000abcd" },
    { kind: "due", records, every: records.length, forced: false, settings: context.autoTuning() });
}

/** A freeze of the automatic dataset's next version by another command, with `reason`. */
async function freezeAs(context: Awaited<ReturnType<typeof dueTuning>>["context"], reason: string) {
  return freezeDataset({
    name: "auto-hypothesis", jobKind: "hypothesis", seed: "auto", testPercent: 50, reason, datasetsFolder: join(context.paths.evalsFolder, "datasets"),
    threadFolder: context.paths.threadFolder, records: await listRecords(context.store), benchmark: [], snapshotBase: () => null, now: context.now, log: () => undefined,
  });
}

test("a tuning whose recorded version another command froze meanwhile freezes the next version and does not run on the other's", async () => {
  const { context, records } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const evalsFolder = context.paths.evalsFolder;
  const tuning = recordedTuning(context, records);
  const target = join(evalsFolder, "datasets", "auto-hypothesis", "v1");
  recordAutoTuning(evalsFolder, tuning.tuningId, { dataset: target });
  equal((await freezeAs(context, "a manual freeze")).folder, target);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  deepStrictEqual(readdirSync(join(evalsFolder, "datasets", "auto-hypothesis")), ["v1", "v2"]);
  const { entry, dataset, cycle } = finishedTuning(evalsFolder);
  deepStrictEqual([entry.dataset, cycle.options.dataset, entry.outcome], [join(evalsFolder, "datasets", "auto-hypothesis", "v2"), entry.dataset, "activated"]);
  checkDataset(dataset, tuning.tuningId, records, 2);
});

test("a tuning whose thread concluded before the tuning ended is ended by the next tune auto with its cycle's outcome, without running again", async () => {
  const { context, records } = await dueTuning(agents([proposal("Overfit.")], "test", { "Overfit.": "development" }));
  const evalsFolder = context.paths.evalsFolder;
  equal(await runEvalCommand(["tune", "auto"], context), 1, context.lines.join("\n"));
  const { entry } = finishedTuning(evalsFolder);
  // As if the process had stopped after the thread's conclusion was checkpointed, before the tuning moved to `tunings`.
  const path = autoTuningPath(evalsFolder);
  const state = readAutoTuning(evalsFolder);
  writeFileSync(path, JSON.stringify({ ...state, tunings: [], current: { ...entry, outcome: null, finishedUtc: null } }));
  const runs = readdirSync(join(evalsFolder, "runs"));
  const fake = agents([], "test", {});
  context.lines.length = 0;
  equal(await runEvalCommand(["tune", "auto"], { ...context, agents: () => fake }), 1, context.lines.join("\n"));
  deepStrictEqual(fake.calls, []);
  deepStrictEqual(readdirSync(join(evalsFolder, "runs")), runs);
  const ended = finishedTuning(evalsFolder);
  deepStrictEqual([ended.entry.tuningId, ended.entry.outcome, ended.state.counted], [entry.tuningId, "rejected", records]);
  ok(context.lines.some((line) => line.includes(`Automatic tuning ${entry.tuningId}: rejected`)), context.lines.join("\n"));
});

test("a tuning continued after the profile changed keeps the settings it started with", async () => {
  const { context, records } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const tuning = recordedTuning(context, records);
  const changed = { ...context, autoTuning: () => ({ every: 1, dataset: "auto-other", minPass: 0.9, candidates: 3 }) };
  equal(await runEvalCommand(["tune", "auto"], changed), 0, context.lines.join("\n"));
  const { entry, dataset, cycle } = finishedTuning(context.paths.evalsFolder);
  deepStrictEqual([entry.tuningId, entry.settings, dataset.name, cycle.options.minPass, cycle.options.candidates], [tuning.tuningId, tuning.settings, "auto-hypothesis", 0.3, 1]);
  equal(existsSync(join(context.paths.evalsFolder, "datasets", "auto-other")), false);
});

test("a tune auto after a killed one continues the tuning: the locks end with the process that held them", async () => {
  const { context, stopped, path } = await stoppedTuning((call) => call.prompt.includes("+tuned-") && call.prompt.includes(testCluster));
  const state = autoTuningPath(context.paths.evalsFolder);
  // A process that holds both locks is killed while it holds them, as a crashed tune auto would be.
  const holder = await holdLocks(`${state}.run.lock`, `${state}.lock`);
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("Another tune auto runs an automatic tuning"));
  await holder.kill();
  const { status } = await resume(context, path);
  equal(status, 0, context.lines.join("\n"));
  equal(finishedTuning(context.paths.evalsFolder).entry.tuningId, stopped.tuningId);
});

test("an auto.json lock is held by one process at a time, also against the same process, and is free again after its release", async () => {
  const folder = scratch("workflow-auto-lock-");
  const lock = `${autoTuningPath(folder)}.run.lock`;
  await withAutoTuningRun(folder, async () => {
    await rejects(withAutoTuningRun(folder, async () => undefined), (error: Error) => error instanceof SetupError && error.message.includes(lock));
  });
  equal(await withAutoTuningRun(folder, async () => "again"), "again");
  const holder = await holdLocks(lock);
  await rejects(withAutoTuningRun(folder, async () => undefined), (error: Error) => error instanceof SetupError && error.message.includes(lock));
  await holder.kill();
  equal(await withAutoTuningRun(folder, async () => "after the kill"), "after the kill");
});

test("an auto.json recorded before tunings kept their settings is read, and its tuning in progress continues with the profile's settings, which it then keeps", async () => {
  const { context, records } = await dueTuning(agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }));
  const tuning = recordedTuning(context, records);
  const path = autoTuningPath(context.paths.evalsFolder);
  const old = JSON.parse(readFileSync(path, "utf8")) as { current: Record<string, unknown> };
  delete old.current["settings"];
  writeFileSync(path, JSON.stringify(old));
  equal(readAutoTuning(context.paths.evalsFolder).current?.settings, undefined);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const { entry } = finishedTuning(context.paths.evalsFolder);
  deepStrictEqual([entry.tuningId, entry.settings, entry.outcome], [tuning.tuningId, context.autoTuning(), "activated"]);
});

test("a run whose samples are all written but whose summary is not is finished when its tuning continues", async () => {
  const { context, stopped, path } = await stoppedTuning((call) => call.prompt.includes("+tuned-"));
  const cycle = readCycle(context.paths.evalsFolder, stopped.cycle!);
  const runs = join(context.paths.evalsFolder, "runs");
  // The candidate's development run stopped after its samples were written, before its summary: the baseline's samples have the same keys.
  mkdirSync(join(runs, cycle.proposals[0]!.run!, "samples"), { recursive: true });
  for (const sample of readdirSync(join(runs, cycle.baseline!, "samples"))) {
    copyFileSync(join(runs, cycle.baseline!, "samples", sample), join(runs, cycle.proposals[0]!.run!, "samples", sample));
  }
  equal(existsSync(join(runs, cycle.proposals[0]!.run!, "summary.json")), false);
  const { status, fake } = await resume(context, path);
  equal(status, 0, context.lines.join("\n"));
  equal(existsSync(join(runs, cycle.proposals[0]!.run!, "summary.json")), true);
  equal(fake.calls.some((call) => call.prompt.includes("+tuned-") && call.prompt.includes(developmentCluster)), false);
});

test("a tune auto while another runs a tuning is a setup error that counts nothing", async () => {
  const { context } = await dueTuning(agents([], "test", {}));
  const holder = await holdLocks(`${autoTuningPath(context.paths.evalsFolder)}.run.lock`);
  try {
    await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("Another tune auto runs an automatic tuning"));
  } finally {
    await holder.kill();
  }
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
});

test("the tuning graph compiles from steps that do nothing until a node runs", async () => {
  const graph = compileTuningGraph(refusingSteps(), SqliteSaver.fromConnString(":memory:"));
  const drawn = await graph.getGraphAsync();
  deepStrictEqual(Object.keys(drawn.nodes).filter((node) => !node.startsWith("__")).sort(),
    ["activate", "baseline", "conclude", "count", "freeze", "holdout", "propose", "test_baseline"]);
  equal(await tuningThread(graph, "tune-none"), "absent");
});

test("a due automatic tuning whose tuning or certificates folder lies inside the repository is a setup error that counts nothing", async () => {
  const { context } = await dueTuning(agents([], "test", {}));
  const inside = { ...context, tuningFolder: () => join(context.paths.repositoryRoot, "workflow", "evals", "tuning") };
  await rejects(runEvalCommand(["tune", "auto"], inside), (error: Error) => error instanceof SetupError && error.message.includes(join("workflow", "evals", "tuning")) && error.message.includes("outside the repository"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
  equal(existsSync(join(context.paths.evalsFolder, "datasets")), false);
  const certificates = join(context.paths.repositoryRoot, "workflow", "evals", "certificates");
  await rejects(runEvalCommand(["tune", "auto"], { ...context, certificatesFolder: () => certificates }), (error: Error) => error instanceof SetupError && error.message.includes(certificates) && !error.message.includes(join("workflow", "evals", "tuning")) && error.message.includes("outside the repository"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
});
