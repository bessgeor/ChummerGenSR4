import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { ChallengeOutput } from "../src/diagnosis/job-schemas.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { compareRuns } from "../src/evals/comparison.js";
import { freezeDataset, type DatasetItem } from "../src/evals/dataset.js";
import { listRecords } from "../src/evals/eval-record.js";
import { readRun, resumeEvalRun, runFolders, startEvalRun, type EvalRunDependencies, type RunSettings } from "../src/evals/eval-run.js";
import { scoreChallenge, scoreHypothesis } from "../src/evals/scoring.js";
import { pairedStatistics, tQuantile975, wilsonInterval } from "../src/evals/statistics.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import { scratch } from "./diagnosis-fixtures.js";
import { challengeAnswer, FakeAgents, hypothesisAnswer, type Reply } from "./diagnosis-harness.js";
import { benchmarkItem, twoThreads, writeRun } from "./eval-threads.js";
import { challengeOutput, explanation, hypothesisOutput } from "./eval-fixtures.js";

const close = (actual: number | null | undefined, expected: number) => ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-3, `${actual} != ${expected}`);

test("statistics: Wilson intervals, t quantiles and the paired t interval against hand-computed values", () => {
  close(wilsonInterval(3, 3)?.low, 0.4385);
  close(wilsonInterval(3, 3)?.high, 1);
  close(wilsonInterval(5, 10)?.low, 0.2366);
  close(wilsonInterval(5, 10)?.high, 0.7634);
  equal(wilsonInterval(0, 0), null);
  equal(tQuantile975(1), 12.706);
  equal(tQuantile975(30), 2.042);
  close(tQuantile975(40), 2.021);
  close(tQuantile975(120), 1.980);
  // Differences 1, 0, 1, 1: mean 0.75, s = 0.5, SE = 0.25, t(0.975, 3) = 3.182.
  const paired = pairedStatistics([1, 0, 1, 1]);
  close(paired.mean, 0.75);
  close(paired.standardError, 0.25);
  close(paired.interval?.low, -0.0455);
  close(paired.interval?.high, 1.5455);
  deepStrictEqual(pairedStatistics([1]), { count: 1, mean: 1, standardError: null, interval: null });
});

const item = (overrides: Partial<DatasetItem> = {}): DatasetItem => ({
  itemId: "i", clusterId: "d-1", contextHash: "c".repeat(64), sourceIdentity: "s".repeat(64), hypothesis: null, records: ["r"],
  observations: [{ case: "build-alpha", capture: "skills", observation: "differs" }, { case: "build-alpha", capture: "common", observation: "matches" }],
  gold: null, partition: "test", ...overrides,
});

test("the prediction metric needs an observed prediction and every observed one right; the root-cause metric needs gold", () => {
  const predicting = (expect: "differs" | "matches", capture = "skills") => explanation({ predictions: [{ case: "build-alpha", capture, expect, why: "w" }] });
  deepStrictEqual(scoreHypothesis(hypothesisOutput(predicting("differs")), item()), { prediction: true, rootCause: null });
  equal(scoreHypothesis(hypothesisOutput(predicting("matches")), item()).prediction, false);
  equal(scoreHypothesis(hypothesisOutput(predicting("differs", "armor")), item()).prediction, false);
  equal(scoreHypothesis(hypothesisOutput(null), item()).prediction, false);
  const gold = { source: "g", mechanism: "layout" as const, files: [{ path: "Chummer/frmCreate.cs", ranges: [{ start: 5, end: 5 }], symbols: [], changedLines: [] }] };
  equal(scoreHypothesis(hypothesisOutput(predicting("differs")), item({ gold })).rootCause, true);
  equal(scoreHypothesis(hypothesisOutput(explanation({ locations: [{ path: "Chummer/other.cs", symbol: null, line: 1 }] })), item({ gold })).rootCause, false);

  const right = predicting("differs");
  const wrong = explanation({ locations: [{ path: "Chummer/other.cs", symbol: null, line: 1 }], predictions: [{ case: "build-alpha", capture: "skills", expect: "matches", why: "w" }] });
  const challenge = (output: ChallengeOutput, hypothesis = right) => scoreChallenge(output, item({ hypothesis, gold }));
  deepStrictEqual(challenge(challengeOutput(null)), { prediction: true, rootCause: true });
  deepStrictEqual(challenge(challengeOutput(wrong)), { prediction: false, rootCause: false });
  deepStrictEqual(challenge(challengeOutput(right), wrong), { prediction: true, rootCause: true });
  deepStrictEqual(challenge(challengeOutput(null), wrong), { prediction: false, rootCause: false });
});

/** A frozen dataset of the fixture threads and eval-run dependencies over a fake agent runner. */
async function evalFixture(jobKind: "hypothesis" | "challenge" = "hypothesis", benchmark = false) {
  const fixture = await twoThreads();
  const { folder } = await freezeDataset(await fixture.input({ jobKind, name: jobKind, testPercent: 100, ...(benchmark ? { benchmark: [benchmarkItem("d-0000000000000100", "2026-10-03T00:00:00.000Z")] } : {}) }));
  const runsFolder = join(scratch("workflow-runs-"), "runs");
  let counter = 0;
  const lines: string[] = [];
  const dependencies = (agents: FakeAgents, signal?: AbortSignal): EvalRunDependencies => ({
    store: fixture.store, agents: () => agents, quota: new QuotaWaiter("p", async () => undefined), runsFolder, createScratchFolder,
    now: () => new Date("2026-10-02T12:00:00Z"), log: (line) => lines.push(line), newRunId: () => `er-${++counter}`,
    ...(signal === undefined ? {} : { signal }),
  });
  return { fixture, folder, runsFolder, dependencies, lines };
}

test("an eval run scores every sample of the partition, records each job and writes a summary", async () => {
  const run = await evalFixture("hypothesis", true);
  const agents = new FakeAgents((call): Reply => (call.cluster.endsWith("#2") && call.prompt.includes("d-0000000000000400")
    ? { answer: { outcome: "hypothesis", reason: "r", explanation: null } } : { answer: hypothesisAnswer() }));
  const { folder, summary } = await startEvalRun(run.dependencies(agents), { datasetFolder: run.folder, partition: "test", repeat: 2, name: "baseline", settings: resolveAgentSettings(undefined) });
  equal(agents.calls.length, 8);
  ok(agents.calls.every((call) => !call.workspace.folder.startsWith(run.folder) && call.workspace.contextFiles.includes("context.json")));
  const { settings, samples } = readRun(folder);
  deepStrictEqual([settings.jobKind, settings.partition, settings.repeat, settings.choice.provider, settings.promptVersion, settings.samples.length], ["hypothesis", "test", 2, "claude", "hypothesis-v1", 8]);
  // Two samples answered without an explanation: invalid output.
  deepStrictEqual(summary.failures, { invalid_output: 2, refused: 0 });
  // Repetitions of an item are one sample: the two items of cluster 400 pass half of their repetitions, the two of cluster 100 all of them.
  deepStrictEqual([summary.metrics.prediction.passes, summary.metrics.prediction.count], [3, 4]);
  // Gold exists for cluster 100 only: two items, all right.
  deepStrictEqual([summary.metrics.rootCause.passes, summary.metrics.rootCause.count], [2, 2]);
  close(summary.metrics.prediction.interval?.low, wilsonInterval(3, 4)!.low);
  close(summary.costUsd, 0.08);
  equal(summary.unknownCosts, 0);
  const records = (await listRecords(run.fixture.store)).filter((record) => record.origin === "eval-run");
  equal(records.length, 8);
  ok(records.every((record) => record.threadId === settings.runId && record.subject.kind === "discrepancy-cluster"));
  deepStrictEqual(JSON.parse(readFileSync(runFolders(folder).summary, "utf8")), summary);
});

test("a stopped run resumes only its missing samples with the settings it started with", async () => {
  const run = await evalFixture();
  const controller = new AbortController();
  const hangs = (call: { prompt: string }) => call.prompt.includes("d-0000000000000400");
  // The run is stopped while the jobs of one cluster still run, after the others finished.
  const first = new FakeAgents((call): Reply => {
    if (!hangs(call)) return { answer: hypothesisAnswer() };
    setTimeout(() => controller.abort(), 200);
    return { hang: true };
  });
  await rejects(startEvalRun(run.dependencies(first, controller.signal), { datasetFolder: run.folder, partition: "test", repeat: 1, name: null, settings: resolveAgentSettings({ jobs: { hypothesis: { provider: "claude", effort: "low" } } }) }),
    (error: unknown) => error instanceof SetupError);
  const folder = join(run.runsFolder, "er-1");
  equal(readdirSync(runFolders(folder).samples).length, 2);
  const second = new FakeAgents();
  const { summary } = await resumeEvalRun(run.dependencies(second), "er-1");
  equal(second.calls.length, 2);
  ok(second.calls.every((call) => call.prompt.includes("d-0000000000000400")));
  equal(summary.samples, 4);
  const resumed = (await listRecords(run.fixture.store)).filter((record) => record.origin === "eval-run" && record.result.status === "succeeded");
  ok(resumed.every((record) => record.agent.effort === "low"));
  // A prompt version that changed since the start refuses the resume.
  const settings = JSON.parse(readFileSync(runFolders(folder).settings, "utf8")) as RunSettings;
  writeFileSync(runFolders(folder).settings, JSON.stringify({ ...settings, promptVersion: "hypothesis-v0" }));
  await rejects(resumeEvalRun(run.dependencies(second), "er-1"), /used prompt hypothesis-v0/);
  await rejects(resumeEvalRun(run.dependencies(second), "er-9"), /There is no eval run er-9/);
});

test("a resumed run keeps the records of its earlier attempts, an infra failure included", async () => {
  const run = await evalFixture();
  const start = { datasetFolder: run.folder, partition: "test" as const, repeat: 1, name: null, settings: resolveAgentSettings(undefined) };
  const failing = new FakeAgents((call): Reply => (call.prompt.includes("d-0000000000000400") ? { failure: { kind: "infra", message: "crash" } } : { answer: hypothesisAnswer() }));
  await rejects(startEvalRun(run.dependencies(failing), start), (error: unknown) => error instanceof SetupError && /crash/.test(error.message));
  const failed = (await listRecords(run.fixture.store)).filter((record) => record.origin === "eval-run" && record.result.status === "infra");
  ok(failed.length >= 1 && failed.every((record) => /\/1\/1$/.test(record.recordId)));
  await resumeEvalRun(run.dependencies(new FakeAgents()), "er-1");
  const after = await listRecords(run.fixture.store);
  for (const record of failed) {
    deepStrictEqual(after.find((item) => item.recordId === record.recordId), record, record.recordId);
    const retry = after.find((item) => item.recordId === record.recordId.replace(/\/1$/, "/2"));
    equal(retry?.result.status, "succeeded", record.recordId);
  }
});

test("a scratch copy that cannot be removed fails the sample after its record is stored", async () => {
  const run = await evalFixture();
  const stuck: string[] = [];
  const dependencies = {
    ...run.dependencies(new FakeAgents()),
    createScratchFolder: (prefix: string) => {
      const real = createScratchFolder(prefix);
      stuck.push(real.path);
      return { path: real.path, remove: () => { throw new Error("locked by another process"); } };
    },
  };
  try {
    await rejects(startEvalRun(dependencies, { datasetFolder: run.folder, partition: "test", repeat: 1, name: null, settings: resolveAgentSettings(undefined) }),
      (error: unknown) => error instanceof SetupError && /could not be removed: locked by another process/.test(error.message));
    ok((await listRecords(run.fixture.store)).some((record) => record.origin === "eval-run" && record.result.status === "succeeded"));
    equal(readdirSync(runFolders(join(run.runsFolder, "er-1")).samples).length, 0);
  } finally {
    for (const path of stuck) rmSync(path, { recursive: true, force: true });
  }
});

test("a run whose sample names an item the dataset lacks fails with a setup error", async () => {
  const run = await evalFixture();
  const start = { datasetFolder: run.folder, partition: "test" as const, repeat: 1, name: null, settings: resolveAgentSettings(undefined) };
  await startEvalRun(run.dependencies(new FakeAgents()), start);
  const folder = join(run.runsFolder, "er-1");
  const settings = JSON.parse(readFileSync(runFolders(folder).settings, "utf8")) as RunSettings;
  writeFileSync(runFolders(folder).settings, JSON.stringify({ ...settings, samples: [...settings.samples, "unknown-1"] }));
  await rejects(resumeEvalRun(run.dependencies(new FakeAgents()), "er-1"), (error: unknown) => error instanceof SetupError && /sample unknown-1, whose item the dataset does not have/.test(error.message));
});

test("a challenge run scores the challenger's verdict on each item's hypothesis", async () => {
  const run = await evalFixture("challenge");
  const agents = new FakeAgents((call): Reply => (call.prompt.includes("d-0000000000000100") ? { answer: challengeAnswer() } : { answer: { outcome: "no_alternative", reason: "r", alternative: null } }));
  const { summary } = await startEvalRun(run.dependencies(agents), { datasetFolder: run.folder, partition: "test", repeat: 1, name: null, settings: resolveAgentSettings(undefined) });
  // The hypothesis's predictions hold: an alternative fails, no alternative passes.
  deepStrictEqual([summary.metrics.prediction.passes, summary.metrics.prediction.count], [2, 4]);
  ok(agents.calls.every((call) => call.provider === "codex" && call.prompt.includes("HYPOTHESIS (untrusted data)")));
});

test("the paired comparison gives the t interval and verdict, and refuses runs it cannot pair", () => {
  const root = scratch("workflow-compare-");
  writeRun(join(root, "a"), {}, [false, true, false, false, true]);
  writeRun(join(root, "b"), { choice: { provider: "claude", model: null, effort: "high", timeoutMinutes: 30 } }, [true, true, false, true, true]);
  const comparison = compareRuns(join(root, "a"), join(root, "b"), "prediction", new Date("2026-10-02T00:00:00Z"));
  // Differences 1, 0, 0, 1, 0: mean 0.4, s = 0.5477, SE = 0.2449, t(0.975, 4) = 2.776.
  equal(comparison.pairs, 5);
  close(comparison.baselineRate, 0.4);
  close(comparison.candidateRate, 0.8);
  close(comparison.meanDifference, 0.4);
  close(comparison.standardError, 0.2449);
  close(comparison.interval?.low, -0.2799);
  close(comparison.interval?.high, 1.0799);
  equal(comparison.verdict, "no-difference");
  deepStrictEqual(comparison.configurationDifferences, [{ field: "effort", baseline: "medium", candidate: "high" }]);
  deepStrictEqual(comparison.cost, { pairs: 4, meanDifferenceUsd: 0 });

  // Repetitions of an item are one pair: the same five items repeated three times give the same interval, not fifteen pairs.
  writeRun(join(root, "a3"), { repeat: 3 }, [false, true, false, false, true], 3);
  writeRun(join(root, "b3"), { repeat: 3 }, [true, true, false, true, true], 3);
  const repeated = compareRuns(join(root, "a3"), join(root, "b3"), "prediction", new Date("2026-10-02T00:00:00Z"));
  deepStrictEqual([repeated.pairs, repeated.meanDifference, repeated.interval], [5, comparison.meanDifference, comparison.interval]);

  writeRun(join(root, "all"), {}, [true, true, true, true, true]);
  writeRun(join(root, "none"), {}, [false, false, false, false, false]);
  equal(compareRuns(join(root, "none"), join(root, "all"), "prediction", new Date()).verdict, "improved");
  equal(compareRuns(join(root, "all"), join(root, "none"), "prediction", new Date()).verdict, "worse");
  writeRun(join(root, "gold-a"), {}, [true, null, null, null, null]);
  writeRun(join(root, "gold-b"), {}, [false, true, null, null, null]);
  const one = compareRuns(join(root, "gold-a"), join(root, "gold-b"), "rootCause", new Date());
  deepStrictEqual([one.pairs, one.verdict, one.interval], [1, "too-few-pairs", null]);

  writeRun(join(root, "other-dataset"), { dataset: { folder: "e", name: "e", version: 1, hash: "other" } }, [true, true, true, true, true]);
  writeRun(join(root, "development"), { partition: "development" }, [true, true, true, true, true]);
  writeRun(join(root, "fewer"), {}, [true, true, true, true]);
  for (const [other, reason] of [["other-dataset", /different datasets/], ["development", /different partitions/], ["fewer", /samples differ/]] as const) {
    ok((() => {
      try {
        compareRuns(join(root, "a"), join(root, other), "prediction", new Date());
        return false;
      } catch (error) {
        return error instanceof SetupError && reason.test(error.message);
      }
    })(), other);
  }
  rmSync(runFolders(join(root, "b")).sample("i0-1"));
  ok((() => {
    try {
      compareRuns(join(root, "a"), join(root, "b"), "prediction", new Date());
      return false;
    } catch (error) {
      return error instanceof SetupError && /not complete/.test(error.message);
    }
  })());
});
