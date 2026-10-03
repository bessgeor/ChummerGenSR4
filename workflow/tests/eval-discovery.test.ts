import { deepStrictEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentJob } from "../src/agents/agent-job.js";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { discoveryPaths } from "../src/discovery/discovery-paths.js";
import type { ScenarioContext } from "../src/discovery/discovery-context.js";
import { certificatePath, certificateProblems, certify } from "../src/evals/certificate.js";
import { compareRuns } from "../src/evals/comparison.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { freezeDiscoveryDataset, loadDiscoveryDataset, type DiscoveryDatasetItem } from "../src/evals/discovery-dataset.js";
import { failedDiscoveryScores, scoreRank, scoreScenario } from "../src/evals/discovery-scoring.js";
import { listRecords } from "../src/evals/eval-record.js";
import { startEvalRun, summaryLines } from "../src/evals/eval-run.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import { discoveryHarness, FakeAgents, fixtureCase, threadOf, type Harness, type Reply } from "./discovery-harness.js";
import { evalContext } from "./eval-fixtures.js";
import { writeRun } from "./eval-threads.js";

const act = (type: string, fields: Record<string, unknown> = {}) => ({ type, name: null, label: null, milliseconds: null, optional: null, ...fields });
const plan = (tab = "Skills") => ({
  case: fixtureCase, expect: [], actions: [act("capture", { name: "common" }), act("selectTab", { name: tab }), act("waitFor", { label: "Karma" }), act("capture", { name: "skills" })],
});
const rankAnswer = { rankings: [
  { targetId: "frmCreate/tabSkills", score: 0.9, feasibility: "feasible", case: fixtureCase, reason: "r" },
  { targetId: "frmCreate.tabCharacterTabs#selection", score: 0.5, feasibility: "uncertain", case: null, reason: "r" },
] };
const reply = (scenario: unknown = { outcome: "plan", reason: "r", plan: plan() }) => (job: AgentJob<unknown>): Reply => ({ answer: job.kind === "rank" ? rankAnswer : scenario });

/** A finished discovery thread whose one scenario was proven, and its records in the harness store. */
async function provenThread(): Promise<Harness> {
  const harness = await discoveryHarness(reply());
  equal(await harness.run({ targets: 1 }), 0, harness.lines.join("\n"));
  return harness;
}

async function freeze(harness: Harness, jobKind: "rank" | "scenario", name = jobKind) {
  return freezeDiscoveryDataset({
    name, jobKind, seed: "s", testPercent: 50, reason: null, datasetsFolder: join(harness.out, "datasets"),
    threadFolder: (id) => discoveryPaths(harness.out).thread(id).root, records: await listRecords(harness.store), now: () => new Date("2026-10-03T13:00:00Z"), log: () => undefined,
  });
}

test("frozen scenario and rank items carry copies of their contexts and gold from the thread's labels", async () => {
  const harness = await provenThread();
  const scenario = await freeze(harness, "scenario");
  deepStrictEqual(scenario.dataset.items.map((item) => [item.key, item.gold]), [["frmCreate/tabSkills", { kind: "scenario", case: fixtureCase, selectedTabs: ["Skills"] }]]);
  const rank = await freeze(harness, "rank");
  deepStrictEqual(rank.dataset.items[0]!.gold, { kind: "rank", proven: ["frmCreate/tabSkills"], notProven: [] });
  equal(rank.dataset.items[0]!.key, rank.dataset.items[0]!.contextHash);
  const loaded = await loadDiscoveryDataset(scenario.folder);
  equal(loaded.contexts.get(scenario.dataset.items[0]!.itemId)!.kind, "scenario");
  const labels = join(scenario.folder, "contexts", scenario.dataset.items[0]!.contextHash, "labels.json");
  writeFileSync(labels, "[\"tampered\"]");
  await rejects(loadDiscoveryDataset(scenario.folder), (error: Error) => error instanceof SetupError && /labels\.json of a sealed context is missing or changed/.test(error.message));
  await rejects(freeze(harness, "rank", "scenario"), (error: Error) => error instanceof SetupError && /keep them/.test(error.message));
});

test("a scenario that did not execute gives its rank no gold about its target", async () => {
  const probe = await provenThread();
  const caseName = JSON.parse(readFileSync(join(probe.out, "out", "discovery", "threads", threadOf(probe.lines), "discovery.json"), "utf8")).scenarios[0].case as string;
  const harness = await discoveryHarness(reply(), undefined, { capture: { failed: caseName } });
  equal(await harness.run({ targets: 1 }), 2);
  const rank = await freeze(harness, "rank");
  deepStrictEqual(rank.dataset.items[0]!.gold, { kind: "rank", proven: [], notProven: [] });
});

test("a context that is not JSON stops the freeze with a setup error naming it", async () => {
  const harness = await provenThread();
  const context = join(discoveryPaths(harness.out).thread(threadOf(harness.lines)).root, "rank", "context.json");
  writeFileSync(context, readFileSync(context, "utf8").slice(0, 40));
  await rejects(freeze(harness, "rank"), (error: Error) => error instanceof SetupError && error.message.includes(context) && /cannot be read/.test(error.message));
});

test("only labelled, succeeded workflow records are frozen, and nothing to freeze is a setup error", async () => {
  // A thread whose rank answer fails validation has a failed, unlabelled rank record and no scenario record.
  const harness = await discoveryHarness((job) => ({ answer: job.kind === "rank" ? { rankings: [] } : null }));
  equal(await harness.run(), 2);
  equal((await listRecords(harness.store)).filter((record) => record.jobKind === "rank").length, 1);
  await rejects(freeze(harness, "rank"), (error: Error) => error instanceof SetupError && /nothing to freeze/.test(error.message));
  await rejects(freeze(harness, "scenario"), (error: Error) => error instanceof SetupError && /nothing to freeze/.test(error.message));
});

const item = (gold: DiscoveryDatasetItem["gold"]): DiscoveryDatasetItem => ({ itemId: "i", key: "k", contextHash: "0".repeat(64), sourceIdentity: "0".repeat(64), records: ["r"], gold, partition: "test" });

test("rank answers reach when their best feasible target was proven and fail when it ran without proof", () => {
  const proven = item({ kind: "rank", proven: ["a"], notProven: ["b"] });
  const ranking = (targetId: string, score: number, feasibility = "feasible") => ({ targetId, score, feasibility: feasibility as "feasible", case: null, reason: "r" });
  deepStrictEqual(scoreRank({ rankings: [ranking("b", 0.4), ranking("a", 0.9)] }, proven), { valid: true, reached: true });
  deepStrictEqual(scoreRank({ rankings: [ranking("a", 0.9, "infeasible"), ranking("b", 0.4)] }, proven), { valid: true, reached: false });
  deepStrictEqual(scoreRank({ rankings: [ranking("c", 0.9), ranking("a", 0.4)] }, proven), { valid: true, reached: null });
  deepStrictEqual(scoreRank({ rankings: [ranking("a", 0.9)] }, item(null)), { valid: true, reached: null });
  deepStrictEqual([failedDiscoveryScores(proven), failedDiscoveryScores(item({ kind: "rank", proven: [], notProven: [] }))], [{ valid: false, reached: false }, { valid: false, reached: null }]);
});

test("scenario answers are valid when the plan passes the validator and reach when they select the proven plan's tabs", () => {
  const context = {
    fixtures: [{ case: fixtureCase, mode: "build", form: "frmCreate", file: "Alpha.chum", selectedTabs: [], captures: ["common"] }], tabTexts: { frmCreate: ["Skills", "Common"] },
  } as unknown as ScenarioContext;
  const gold = item({ kind: "scenario", case: fixtureCase, selectedTabs: ["Skills"] });
  const answer = (tab: string) => ({ outcome: "plan" as const, reason: "r", plan: plan(tab) as never });
  deepStrictEqual(scoreScenario(answer("Skills"), gold, context, ["Karma"]), { valid: true, reached: true });
  deepStrictEqual(scoreScenario(answer("Common"), gold, context, ["Karma"]), { valid: true, reached: false });
  deepStrictEqual(scoreScenario(answer("Skills"), gold, context, []), { valid: false, reached: false });
  deepStrictEqual(scoreScenario({ outcome: "abstain", reason: "r", plan: null }, item(null), context, []), { valid: null, reached: null });
  deepStrictEqual(scoreScenario({ outcome: "abstain", reason: "r", plan: null }, gold, context, []), { valid: null, reached: false });
});

test("an eval run on a scenario dataset scores valid and reached and records its samples as eval-run records", async () => {
  const harness = await provenThread();
  const { folder } = await freeze(harness, "scenario");
  const agents = new FakeAgents(() => ({ answer: { outcome: "plan", reason: "r", plan: plan() } }));
  const lines: string[] = [];
  const { summary } = await startEvalRun({
    store: harness.store, agents: () => agents, quota: new QuotaWaiter("p", async () => undefined), runsFolder: join(harness.out, "runs-eval"),
    createScratchFolder, now: () => new Date("2026-10-03T14:00:00Z"), log: (line) => lines.push(line), newRunId: () => "er-scenario",
  }, { datasetFolder: folder, partition: "all", repeat: 2, name: null, settings: resolveAgentSettings(undefined) });
  deepStrictEqual([summary.jobKind, summary.samples, summary.metrics.valid.passes, summary.metrics.reached.passes, summary.metrics.prediction.count], ["scenario", 2, 1, 1, 0]);
  const printed = summaryLines(summary);
  ok(printed.some((line) => line.startsWith("  valid: 1/1 items")) && printed.some((line) => line.startsWith("  reached: 1/1 items")), printed.join("\n"));
  match(agents.calls[0]!.prompt, /^PROMPT_VERSION=scenario-v1/);
  const records = (await listRecords(harness.store)).filter((record) => record.origin === "eval-run");
  deepStrictEqual(records.map((record) => [record.jobKind, record.subject.kind]), [["scenario", "discovery-target"], ["scenario", "discovery-target"]]);
  ok(threadOf(harness.lines).startsWith("disc-"));
});

test("certify and compare take valid and reached for discovery runs and refuse the diagnosis metrics", async () => {
  const root = mkdtempSync(join(tmpdir(), "eval-discovery-"));
  writeRun(join(root, "runs", "s1"), { jobKind: "scenario", promptVersion: "scenario-v1" }, Array.from({ length: 20 }, () => true));
  writeRun(join(root, "runs", "s2"), { jobKind: "scenario", promptVersion: "scenario-v1" }, Array.from({ length: 20 }, () => true));
  const outcome = certify(join(root, "runs", "s1"), { metric: "valid", minPass: 0.8, maxMeanCostUsd: null }, join(root, "certificates"), new Date());
  ok("certificate" in outcome, JSON.stringify(outcome));
  equal(JSON.parse(readFileSync(certificatePath(join(root, "certificates"), "scenario"), "utf8")).jobKind, "scenario");
  throws(() => certify(join(root, "runs", "s1"), { metric: "rootCause", minPass: 0.8, maxMeanCostUsd: null }, join(root, "certificates"), new Date()),
    (error: Error) => error instanceof SetupError && /scores valid and reached, not rootCause/.test(error.message));
  equal(compareRuns(join(root, "runs", "s1"), join(root, "runs", "s2"), "reached", new Date()).verdict, "no-difference");
  throws(() => compareRuns(join(root, "runs", "s1"), join(root, "runs", "s2"), "prediction", new Date()), SetupError);
  const context = evalContext();
  for (const name of ["s1", "s2"]) writeRun(join(context.paths.evalsFolder, "runs", name), { jobKind: "scenario", promptVersion: "scenario-v1" }, [true, false, true]);
  equal(await runEvalCommand(["compare", "--baseline", "s1", "--candidate", "s2"], context), 0);
  ok(context.lines.some((line) => line.includes("(scenario, test), metric valid:")), context.lines.join("\n"));
  const settings = resolveAgentSettings(undefined);
  deepStrictEqual(certificateProblems(join(root, "certificates"), ["rank", "scenario"], settings).map((line) => line.split(":")[0]), ["rank"]);
});
