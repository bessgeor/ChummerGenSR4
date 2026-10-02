import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { putRecord } from "../src/evals/eval-record.js";
import { tQuantile975 } from "../src/evals/statistics.js";
import { compareThreads, threadMeasures, type ClusterMeasure, type ThreadComparison } from "../src/evals/thread-comparison.js";
import { SetupError } from "../src/host/setup-error.js";
import { evalContext, record, writeFile } from "./eval-fixtures.js";

const measure = (threadId: string, clusterId: string, fixed: 0 | 1, modelSeconds: number, costUsd: number | null = 0.5): ClusterMeasure =>
  ({ threadId, clusterId, fixed, modelSeconds, costUsd });

const sides = { baseline: ["b"], candidate: ["c"] };
const now = new Date("2026-10-02T12:00:00Z");

test("two pairs: the fix rate does not differ and the model time's interval comes from t with one degree of freedom", () => {
  const comparison = compareThreads([measure("b", "d-1", 1, 300), measure("b", "d-2", 1, 200)], [measure("c", "d-1", 1, 400), measure("c", "d-2", 1, 260)], sides, now);
  const [fixRate, modelTime] = comparison.metrics;
  deepStrictEqual([fixRate!.metric, fixRate!.pairs, fixRate!.meanDifference, fixRate!.verdict], ["fixRate", 2, 0, "no-difference"]);
  deepStrictEqual([modelTime!.metric, modelTime!.better, modelTime!.meanDifference, modelTime!.baselineMean, modelTime!.candidateMean], ["modelTime", "lower", 80, 250, 330]);
  // Differences 100 and 60: s = 28.28, standard error 20, half width 12.706 x 20.
  equal(modelTime!.standardError!.toFixed(6), "20.000000");
  equal(modelTime!.interval!.low.toFixed(2), (80 - tQuantile975(1) * 20).toFixed(2));
  equal(modelTime!.verdict, "no-difference");
  deepStrictEqual(comparison.cost, { pairs: 2, meanDifferenceUsd: 0 });
});

test("verdicts follow the better side of each metric, and fewer than two pairs are too few", () => {
  const fixed = compareThreads(["d-1", "d-2", "d-3"].map((id) => measure("b", id, 0, 100)), ["d-1", "d-2", "d-3"].map((id, index) => measure("c", id, 1, 50 + index)), sides, now);
  // Every pair moved by the same amount: no spread, so the interval is that amount.
  deepStrictEqual(fixed.metrics.map((metric) => metric.verdict), ["improved", "improved"]);
  const slower = compareThreads(["d-1", "d-2", "d-3"].map((id) => measure("b", id, 1, 100)), ["d-1", "d-2", "d-3"].map((id, index) => measure("c", id, 0, 200 + index)), sides, now);
  deepStrictEqual(slower.metrics.map((metric) => metric.verdict), ["worse", "worse"]);
  const mixed = compareThreads([measure("b", "d-1", 0, 1), measure("b", "d-2", 1, 1), measure("b", "d-3", 0, 1)], [measure("c", "d-1", 1, 1), measure("c", "d-2", 1, 1), measure("c", "d-3", 0, 1)], sides, now);
  equal(mixed.metrics[0]!.verdict, "no-difference");
  const one = compareThreads([measure("b", "d-1", 0, 100)], [measure("c", "d-1", 1, 50)], sides, now);
  deepStrictEqual(one.metrics.map((metric) => [metric.pairs, metric.meanDifference, metric.interval, metric.verdict]), [[1, 1, null, "too-few-pairs"], [1, -50, null, "too-few-pairs"]]);
});

test("clusters on one side only are listed and not paired; a cluster twice on one side is a setup error", () => {
  const comparison = compareThreads([measure("b", "d-1", 1, 10), measure("b", "d-2", 1, 10)], [measure("c", "d-1", 1, 10), measure("c", "d-3", 0, 10, null)], sides, now);
  deepStrictEqual(comparison.pairs.map((pair) => pair.clusterId), ["d-1"]);
  deepStrictEqual(comparison.unpaired, { baseline: ["d-2"], candidate: ["d-3"] });
  throws(() => compareThreads([measure("b1", "d-1", 1, 10), measure("b2", "d-1", 1, 10)], [], sides, now),
    (error: Error) => error instanceof SetupError && /d-1 is in two baseline threads \(b1, b2\)/.test(error.message));
});

test("a thread's clusters are measured from its outcome and its own workflow records", () => {
  const context = evalContext();
  const folder = context.paths.threadFolder("wf-1");
  writeFile(folder, "outcome.json", JSON.stringify({ threadId: "wf-1", outcome: "findings_remaining", clusters: [
    { clusterId: "d-1", disposition: "fixed", attempts: 1, stage: null, reason: null, commit: "c" },
    { clusterId: "d-2", disposition: "repair_rejected", attempts: 2, stage: "check", reason: "r", commit: null },
  ] }));
  const records = [
    record({ recordId: "wf-1/d-1/hypothesis/1", threadId: "wf-1", subject: { kind: "discrepancy-cluster", id: "d-1" }, durationMs: 60_000 }),
    record({ recordId: "wf-1/d-1/repair/1", jobKind: "repair", threadId: "wf-1", subject: { kind: "discrepancy-cluster", id: "d-1" }, durationMs: 30_000 }),
    record({ recordId: "wf-2/d-1/hypothesis/1", threadId: "wf-2", subject: { kind: "discrepancy-cluster", id: "d-1" }, durationMs: 999_000 }),
    record({ recordId: "er-1/x", origin: "eval-run", threadId: "wf-1", subject: { kind: "discrepancy-cluster", id: "d-1" }, durationMs: 999_000 }),
    record({ recordId: "wf-1/d-2/hypothesis/1", threadId: "wf-1", subject: { kind: "discrepancy-cluster", id: "d-2" }, durationMs: 10_000, usage: null }),
  ];
  deepStrictEqual(threadMeasures(folder, "wf-1", records), [
    { threadId: "wf-1", clusterId: "d-1", fixed: 1, modelSeconds: 90, costUsd: 0.2 },
    { threadId: "wf-1", clusterId: "d-2", fixed: 0, modelSeconds: 10, costUsd: null },
  ]);
  throws(() => threadMeasures(context.paths.threadFolder("wf-9"), "wf-9", records), (error: Error) => error instanceof SetupError && /wf-9 has no outcome\.json/.test(error.message));
});

test("npm run eval -- compare-threads writes the comparison and prints both metrics", async () => {
  const context = evalContext();
  for (const [thread, disposition, seconds] of [["wf-b1", "fixed", 300], ["wf-b2", "fixed", 200], ["wf-c1", "fixed", 400], ["wf-c2", "repair_rejected", 260]] as const) {
    const cluster = thread.endsWith("1") ? "d-1" : "d-2";
    writeFile(context.paths.threadFolder(thread), "outcome.json", JSON.stringify({ threadId: thread, clusters: [{ clusterId: cluster, disposition }] }));
    await putRecord(context.store, record({ recordId: `${thread}/${cluster}/hypothesis/1`, threadId: thread, subject: { kind: "discrepancy-cluster", id: cluster }, durationMs: seconds * 1000 }));
  }
  equal(await runEvalCommand(["compare-threads", "--baseline", "wf-b1,wf-b2", "--candidate", "wf-c1, wf-c2"], context), 0);
  ok(context.lines[0]!.startsWith("Comparison of threads wf-c1, wf-c2 against wf-b1, wf-b2: 2 cluster pairs."));
  ok(context.lines[1]!.includes("fixRate (higher is better): 2 pairs; mean 1.000 -> 0.500; mean paired difference -0.500"), context.lines[1]);
  ok(context.lines[2]!.includes("modelTime (lower is better): 2 pairs; mean 250.000 s -> 330.000 s; mean paired difference 80.000 s"), context.lines[2]);
  const folder = join(context.paths.evalsFolder, "comparisons");
  const written = JSON.parse(readFileSync(join(folder, readdirSync(folder)[0]!), "utf8")) as ThreadComparison;
  deepStrictEqual([written.baseline, written.candidate, written.pairs.length], [["wf-b1", "wf-b2"], ["wf-c1", "wf-c2"], 2]);
  await rejects(runEvalCommand(["compare-threads", "--baseline", " , ", "--candidate", "wf-c1"], context), /--baseline names no thread/);
  await rejects(runEvalCommand(["compare-threads", "--candidate", "wf-c1"], context), /needs --baseline/);
});
