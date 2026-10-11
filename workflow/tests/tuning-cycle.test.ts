import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { freezeDataset, partitionOf } from "../src/evals/dataset.js";
import { runEvalCommand, type EvalContext } from "../src/evals/eval-commands.js";
import { readRun } from "../src/evals/eval-run.js";
import { SetupError } from "../src/host/setup-error.js";
import { readActiveFile, tuningFiles } from "../src/tuning/active-configuration.js";
import { readCycle } from "../src/tuning/cycle.js";
import { readLedger } from "../src/tuning/holdout.js";
import { tuningId } from "../src/tuning/tuning.js";
import { FakeAgents, hypothesisAnswer, type JobCall, type Reply } from "./diagnosis-harness.js";
import { tuningFixture } from "./tuning-eval-fixtures.js";
import { tuning } from "./tuning-fixtures.js";

const ids = ["d-0000000000000100", "d-0000000000000400"];
const seed = Array.from({ length: 100 }, (_, index) => `seed-${index}`).find((value) => partitionOf(value, ids[0]!, 50) !== partitionOf(value, ids[1]!, 50))!;
const developmentCluster = ids.find((id) => partitionOf(seed, id, 50) === "development")!;

const proposal = (guidance: string) => ({ outcome: "candidate", reason: `Try: ${guidance}`, guidance: [guidance], context: "inline" });
const idOf = (guidance: string) => tuningId(tuning({ jobKind: "hypothesis", guidance: [guidance], context: "inline" }));

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

async function cycle(fake: FakeAgents, extra: string[] = [], context?: EvalContext & { lines: string[] }) {
  const fixture = context === undefined ? await tuningFixture(50, seed) : null;
  const used = context ?? { ...fixture!.context, agents: () => fake };
  const dataset = fixture?.dataset ?? "";
  const status = await runEvalCommand(["tune", "cycle", "--dataset", dataset, "--min-pass", "0.3", ...extra], used);
  const cycles = readdirSync(join(used.paths.evalsFolder, "tuning", "cycles"));
  return { status, context: used, cycle: readCycle(used.paths.evalsFolder, cycles[0]!) };
}

test("a cycle activates a candidate that beat the active configuration on development and is not worse on the holdout", async () => {
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" });
  const { status, context, cycle: done } = await cycle(fake);
  equal(status, 0, context.lines.join("\n"));
  deepStrictEqual([done.outcome, done.proposals.length, done.selected, done.activation?.comparison?.verdict], ["activated", 1, idOf("Cite the capture."), "no-difference"]);
  deepStrictEqual(done.proposals[0]!.development?.verdict, "improved");
  equal(readActiveFile(context.tuningFolder(), "hypothesis")!.active.tuning?.guidance[0], "Cite the capture.");
  deepStrictEqual(readLedger(context.tuningFolder()).exposures.map((exposure) => exposure.testRun), [done.holdout!.run]);
  ok(context.lines.some((line) => line.startsWith(`Tuning cycle ${done.cycleId} (hypothesis, metric prediction): activated`)));
  ok(context.lines.some((line) => /proposal 1: candidate tuned-[0-9a-f]{12}, run er-.*2 pairs, mean difference 1.000, 95% t interval/.test(line)), context.lines.join("\n"));
});

test("a cycle stopped after its activation and resumed after a rollback does not activate again", async () => {
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" });
  const { context, cycle: done } = await cycle(fake);
  equal(await runEvalCommand(["tune", "rollback", "--job", "hypothesis", "--reason", "regressed"], context), 0);
  // As if the cycle had been stopped after the activation, before it recorded it.
  const path = join(context.paths.evalsFolder, "tuning", "cycles", done.cycleId, "cycle.json");
  writeFileSync(path, JSON.stringify({ ...done, outcome: "running", activation: null, reasons: [], finishedUtc: null }));
  equal(await runEvalCommand(["tune", "cycle", "--resume", done.cycleId], context), 0);
  deepStrictEqual([readCycle(context.paths.evalsFolder, done.cycleId).outcome, readCycle(context.paths.evalsFolder, done.cycleId).reasons], ["activated", ["it has been rolled back since"]]);
  equal(readActiveFile(context.tuningFolder(), "hypothesis")!.active.tuning, null);
});

test("a cycle stopped after its activation and resumed after another activation replaced it says so", async () => {
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" });
  const { context, cycle: done } = await cycle(fake);
  // As if another activation had replaced the cycle's: its entry is in the history, not among the rolled-back ones.
  const activePath = tuningFiles(context.tuningFolder()).active("hypothesis");
  const file = JSON.parse(readFileSync(activePath, "utf8"));
  writeFileSync(activePath, JSON.stringify({ ...file, active: file.history[0], history: [...file.history, file.active] }));
  writeFileSync(join(context.paths.evalsFolder, "tuning", "cycles", done.cycleId, "cycle.json"), JSON.stringify({ ...done, outcome: "running", activation: null, reasons: [], finishedUtc: null }));
  equal(await runEvalCommand(["tune", "cycle", "--resume", done.cycleId], context), 0);
  deepStrictEqual(readCycle(context.paths.evalsFolder, done.cycleId).reasons, ["it has been replaced since"]);
});

test("a cycle resumed after a holdout stopped before its run was created follows the exposure the ledger holds", async () => {
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" });
  const { context, cycle: done } = await cycle(fake);
  const exposure = readLedger(context.tuningFolder()).exposures[0]!;
  equal(exposure.testRun, done.holdout!.run);
  // As if an earlier `tune holdout` had recorded the exposure and stopped before it created the run, and the cycle had chosen another run ID.
  equal(await runEvalCommand(["tune", "rollback", "--job", "hypothesis", "--reason", "regressed"], context), 0);
  rmSync(join(context.paths.evalsFolder, "runs", exposure.testRun), { recursive: true });
  const path = join(context.paths.evalsFolder, "tuning", "cycles", done.cycleId, "cycle.json");
  writeFileSync(path, JSON.stringify({ ...done, outcome: "running", holdout: { run: "er-never-created", refused: null }, testBaseline: null, activation: null, reasons: [], finishedUtc: null }));
  equal(await runEvalCommand(["tune", "cycle", "--resume", done.cycleId], context), 0, context.lines.join("\n"));
  const resumed = readCycle(context.paths.evalsFolder, done.cycleId);
  deepStrictEqual([resumed.outcome, resumed.holdout?.run, readLedger(context.tuningFolder()).exposures.length], ["activated", exposure.testRun, 1]);
  ok(existsSync(join(context.paths.evalsFolder, "runs", exposure.testRun)));
  equal(readActiveFile(context.tuningFolder(), "hypothesis")!.active.tuning?.guidance[0], "Cite the capture.");
});

test("a cycle that meets an unstarted exposure on another version of its dataset runs both test runs on that version and with that exposure's agent choice", async () => {
  const fixture = await tuningFixture(50, seed);
  const context = { ...fixture.context, agents: () => agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }) };
  equal(await runEvalCommand(["tune", "cycle", "--dataset", fixture.dataset, "--min-pass", "0.3"], context), 0, context.lines.join("\n"));
  const exposure = readLedger(context.tuningFolder()).exposures[0]!;
  // As if that holdout had stopped before its run was created, and the candidate had been rolled back since.
  equal(await runEvalCommand(["tune", "rollback", "--job", "hypothesis", "--reason", "regressed"], context), 0);
  rmSync(join(context.paths.evalsFolder, "runs", exposure.testRun), { recursive: true });

  // A new version of the dataset holds the same test items: the candidate's exposure counts, and its run starts on the first version.
  const { folder: next } = await freezeDataset(await fixture.threads.input({ name: "tune", testPercent: 50, seed }));
  const before = new Set(readdirSync(join(context.paths.evalsFolder, "tuning", "cycles")));
  // The cycle itself runs on another agent choice (more effort) than the exposure's development runs did.
  const higher = { ...context, agentSettings: () => resolveAgentSettings({ jobs: { hypothesis: { provider: "claude", effort: "high" } } }) };
  equal(await runEvalCommand(["tune", "cycle", "--dataset", next, "--min-pass", "0.3"], higher), 0, context.lines.join("\n"));
  const id = readdirSync(join(context.paths.evalsFolder, "tuning", "cycles")).find((name) => !before.has(name))!;
  const done = readCycle(context.paths.evalsFolder, id);
  deepStrictEqual([done.outcome, done.holdout?.run, readLedger(context.tuningFolder()).exposures.length], ["activated", exposure.testRun, 1]);
  const settings = (run: string) => readRun(join(context.paths.evalsFolder, "runs", run)).settings;
  deepStrictEqual([settings(done.holdout!.run).dataset.folder, settings(done.testBaseline!).dataset.folder], [fixture.dataset, fixture.dataset]);
  deepStrictEqual([settings(done.baseline!).choice.effort, settings(done.holdout!.run).choice.effort, settings(done.testBaseline!).choice.effort], ["high", "medium", "medium"]);
});

test("a cycle without a better candidate ends no_improvement and changes nothing; an abstention ends the proposals", async () => {
  const fake = agents([proposal("Same as before.")], "all", { "Same as before.": "all" });
  const { status, context, cycle: done } = await cycle(fake, ["--candidates", "2"]);
  equal(status, 0);
  deepStrictEqual([done.outcome, done.proposals.map((item) => item.outcome), done.holdout, done.testBaseline], ["no_improvement", ["candidate", "abstain"], null, null]);
  deepStrictEqual(readLedger(context.tuningFolder()).exposures, []);
  equal(readActiveFile(context.tuningFolder(), "hypothesis"), null);
});

test("a candidate worse on the holdout is rejected with exit status 1 and stays inactive", async () => {
  const fake = agents([proposal("Overfit.")], "test", { "Overfit.": "development" });
  const { status, cycle: done, context } = await cycle(fake);
  equal(status, 1);
  equal(done.outcome, "rejected");
  ok(done.reasons.some((reason) => reason.includes("worse than the active configuration on the test partition")), done.reasons.join("\n"));
  equal(readActiveFile(context.tuningFolder(), "hypothesis"), null);
  equal(readLedger(context.tuningFolder()).exposures.length, 1);
});

test("a failed tune job ends the cycle with exit status 2", async () => {
  const fake = agents([{ outcome: "candidate", reason: "r", guidance: ["x".repeat(500)], context: "inline" }], "test", {});
  const { status, cycle: done } = await cycle(fake);
  equal(status, 2);
  deepStrictEqual([done.outcome, done.proposals[0]!.outcome], ["failed", "failed"]);
});

test("a cycle killed during a candidate's development run resumes without repeating the baseline or the proposal", async () => {
  const fixture = await tuningFixture(50, seed);
  const controller = new AbortController();
  const killing = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }, (call) => {
    if (!call.prompt.includes("+tuned-")) return false;
    setTimeout(() => controller.abort(), 50);
    return true;
  });
  const context = { ...fixture.context, agents: () => killing, signal: controller.signal };
  await rejects(runEvalCommand(["tune", "cycle", "--dataset", fixture.dataset, "--min-pass", "0.3"], context), SetupError);
  const cycleId = readdirSync(join(context.paths.evalsFolder, "tuning", "cycles"))[0]!;
  const stopped = readCycle(context.paths.evalsFolder, cycleId);
  deepStrictEqual([stopped.outcome, stopped.proposals.length, stopped.proposals[0]!.run !== null, stopped.proposals[0]!.development], ["running", 1, true, null]);

  const resuming = agents([], "test", { "Cite the capture.": "all" });
  const resumed = { ...context, agents: () => resuming, signal: new AbortController().signal };
  await rejects(runEvalCommand(["tune", "cycle", "--resume", cycleId, "--candidates", "2"], resumed), /--resume takes no --candidates/);
  equal(await runEvalCommand(["tune", "cycle", "--resume", cycleId], resumed), 0, resumed.lines.join("\n"));
  equal(resuming.calls.some((call) => call.kind === "tune"), false);
  // The baseline's development samples are not run again; the code's prompt runs only on the test partition.
  equal(resuming.calls.some((call) => !call.prompt.includes("+tuned-") && call.prompt.includes(developmentCluster)), false);
  equal(readCycle(context.paths.evalsFolder, cycleId).outcome, "activated");
  equal(await runEvalCommand(["tune", "cycle", "--resume", cycleId], resumed), 0);
});
