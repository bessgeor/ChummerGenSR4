import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import type { ClusterDiagnosis } from "../src/diagnosis/cluster-diagnosis.js";
import { nextDiagnosisRoute } from "../src/diagnosis/cluster-diagnosis.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { EvalRecordSchema, recordNamespace } from "../src/evals/eval-record.js";
import { nodeMode } from "../src/graph/workflow-graph.js";
import { scratch, triageDocument } from "./diagnosis-fixtures.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type Reply } from "./diagnosis-harness.js";

const quota: Reply = { failure: { kind: "quota_exhausted", message: "You've hit your usage limit" } };

async function clustersOf(harness: ReturnType<typeof diagnosisHarness>): Promise<Record<string, ClusterDiagnosis>> {
  return (await harness.state(harness.threadId())).clusters as Record<string, ClusterDiagnosis>;
}

test("hypotheses fan out per cluster, and challenges start once every hypothesis finished", async () => {
  const harness = diagnosisHarness({ spots: twoClusters });
  equal(await harness.start(), 1);
  const { events, calls, peak } = harness.agents;
  equal(peak, 2);
  const lastHypothesisEnd = Math.max(...events.map((event, index) => (event.startsWith("hypothesis") && event.endsWith("end") ? index : -1)));
  const firstChallengeStart = events.findIndex((event) => event.startsWith("challenge") && event.endsWith("start"));
  ok(lastHypothesisEnd < firstChallengeStart);
  deepStrictEqual(calls.map((call) => `${call.kind} ${call.provider}`).sort(),
    ["challenge codex", "challenge codex", "hypothesis claude", "hypothesis claude"]);
  const clusters = await clustersOf(harness);
  deepStrictEqual(Object.values(clusters).map((cluster) => cluster.status), ["challenged", "challenged"]);
  const first = Object.values(clusters)[0]!;
  equal(first.records.length, 2);
  ok(calls[0]!.prompt.startsWith("PROMPT_VERSION=hypothesis-v1"));
  equal(calls[0]!.images.length, 2);
  ok(calls.find((call) => call.kind === "challenge")!.prompt.includes("The Skills tab label moved in frmCreate."));
  const record = EvalRecordSchema.parse((await harness.store.get(recordNamespace("hypothesis"), first.records[0]!))!.value);
  equal(record.subject.id, first.clusterId);
  equal(record.contextHash, first.contextHash);
  deepStrictEqual(record.agent, { provider: "claude", model: null, effort: "medium" });
  deepStrictEqual(record.result, { status: "succeeded", message: null });
  deepStrictEqual(record.output, hypothesisAnswer());
  // Both clusters' hypotheses held in the check and their alternatives did not.
  deepStrictEqual(record.labels, { check: "confirmed" });
});

test("an abstaining cluster gets no challenge", async () => {
  const agents = new FakeAgents((call) => ({
    answer: call.kind === "hypothesis"
      ? (call.cluster.endsWith("100") ? { outcome: "abstain", reason: "The crops show no readable change.", explanation: null } : hypothesisAnswer())
      : challengeAnswer(),
  }));
  const harness = diagnosisHarness({ spots: twoClusters, agents });
  equal(await harness.start(), 1);
  deepStrictEqual(agents.calls.filter((call) => call.kind === "challenge").map((call) => call.cluster), ["d-0000000000000400"]);
  deepStrictEqual(Object.values(await clustersOf(harness)).map((cluster) => cluster.status), ["abstained", "challenged"]);
});

test("an answer that fails validation fails its cluster as invalid_output and is recorded; the other cluster goes on", async () => {
  const agents = new FakeAgents((call) => {
    if (call.kind === "challenge") return { answer: challengeAnswer() };
    const answer = hypothesisAnswer();
    return call.cluster.endsWith("100")
      ? { answer: { ...answer, explanation: { ...answer.explanation!, locations: [{ path: "Chummer/missing.cs", symbol: null, line: null }] } } }
      : { answer };
  });
  const harness = diagnosisHarness({ spots: twoClusters, agents });
  await harness.start();
  const failed = (await clustersOf(harness))["d-0000000000000100"]!;
  equal(failed.status, "failed");
  equal(failed.failure?.kind, "invalid_output");
  ok(/Chummer\/missing.cs is not a file of the source snapshot/.test(failed.failure!.message));
  const record = EvalRecordSchema.parse((await harness.store.get(recordNamespace("hypothesis"), failed.records[0]!))!.value);
  equal(record.result.status, "invalid_output");
  equal(record.output, null);
  equal((await clustersOf(harness))["d-0000000000000400"]!.status, "challenged");
});

test("a challenger that does not disagree on a shared capture is invalid_output", async () => {
  const agents = new FakeAgents((call) => {
    if (call.kind === "hypothesis") return { answer: hypothesisAnswer() };
    const answer = challengeAnswer();
    return { answer: { ...answer, alternative: { ...answer.alternative!, predictions: [{ case: "career-beta", capture: "common", expect: "matches", why: "same" }] } } };
  });
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents });
  await harness.start();
  const cluster = Object.values(await clustersOf(harness))[0]!;
  deepStrictEqual([cluster.status, cluster.failure?.job, cluster.failure?.kind], ["failed", "challenge", "invalid_output"]);
});

test("an infra failure ends the run with 3; the resumed thread runs that job again with a new record", async () => {
  const agents = new FakeAgents((call, attempt) => (call.kind === "challenge" && attempt === 1
    ? { failure: { kind: "infra", message: "spawn claude ENOENT" } } : { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() }));
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents });
  equal(await harness.start(), 3);
  ok(harness.lines.some((line) => /challenge d-0000000000000100 failed: spawn claude ENOENT/.test(line)));
  const threadId = harness.threadId();
  equal(await harness.resume(threadId), 1);
  deepStrictEqual(agents.calls.map((call) => call.kind), ["hypothesis", "challenge", "challenge"]);
  const cluster = Object.values(await clustersOf(harness))[0]!;
  deepStrictEqual(cluster.records, [`${threadId}/d-0000000000000100/hypothesis/1`, `${threadId}/d-0000000000000100/challenge/2`]);
  const first = EvalRecordSchema.parse((await harness.store.get(recordNamespace("challenge"), `${threadId}/d-0000000000000100/challenge/1`))!.value);
  equal(first.result.status, "infra");
});

test("a usage limit waits 1, 2 and 5 minutes, retries the job, and is never charged to the budget", async () => {
  const agents = new FakeAgents((call, attempt) => (call.kind === "hypothesis" && attempt <= 3 ? quota : { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() }));
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents });
  equal(await harness.start(), 1);
  deepStrictEqual(harness.sleeps, [60_000, 120_000, 300_000]);
  const cluster = Object.values(await clustersOf(harness))[0]!;
  equal(cluster.status, "challenged");
  equal(cluster.waiting, null);
  equal(cluster.records.length, 5);
  equal((await harness.state(harness.threadId())).agentMilliseconds, 2000);
  const record = EvalRecordSchema.parse((await harness.store.get(recordNamespace("hypothesis"), cluster.records[0]!))!.value);
  equal(record.result.status, "quota_exhausted");
});

test("the delays go 1, 2, 5, 10, 15 minutes, then 15; a successful job starts them again", async () => {
  const sleeps: number[] = [];
  const waiter = new QuotaWaiter("p", async (milliseconds) => {
    sleeps.push(milliseconds);
  });
  for (let index = 0; index < 7; index++) await waiter.wait(["p"]);
  waiter.reset();
  await waiter.wait(["p"]);
  deepStrictEqual(sleeps.map((milliseconds) => milliseconds / 60_000), [1, 2, 5, 10, 15, 15, 15, 1]);
});

test("Ctrl+C during a quota wait ends the run with 3; after a restart the job runs again at once", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const agents = new FakeAgents((call, attempt) => (call.kind === "hypothesis" && attempt === 1 ? quota : { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() }));
  const first = diagnosisHarness({
    spots: [twoClusters[0]!], agents, checkpointer, store, processId: "first", signal: controller.signal,
    sleep: (_milliseconds, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      setTimeout(() => controller.abort(), 10);
    }),
  });
  equal(await first.start(), 3);
  ok(first.lines.some((line) => /Interrupted/.test(line)));
  const second = diagnosisHarness({ spots: [twoClusters[0]!], agents, checkpointer, store, processId: "second", root: first.root });
  equal(await second.resume(first.threadId()), 1);
  deepStrictEqual(second.sleeps, []);
  ok(second.lines.some((line) => /retrying at once/.test(line)));
  deepStrictEqual(agents.calls.map((call) => call.kind), ["hypothesis", "hypothesis", "challenge"]);
});

test("a run killed during a challenge resumes without asking for the hypothesis again", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const agents = new FakeAgents((call, attempt) => {
    if (call.kind === "challenge" && attempt === 1) {
      setTimeout(() => controller.abort(), 10);
      return { hang: true };
    }
    return { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() };
  });
  const first = diagnosisHarness({ spots: twoClusters, agents, checkpointer, store, signal: controller.signal });
  equal(await first.start(), 3);
  const second = diagnosisHarness({ spots: twoClusters, agents, checkpointer, store, root: first.root });
  equal(await second.resume(first.threadId()), 1);
  equal(agents.calls.filter((call) => call.kind === "hypothesis").length, 2);
  ok(agents.calls.filter((call) => call.kind === "challenge").length >= 3);
  deepStrictEqual(Object.values((await second.state(first.threadId())).clusters as Record<string, ClusterDiagnosis>).map((cluster) => cluster.status), ["challenged", "challenged"]);
});

test("once the run budget is spent no job starts and its cluster is budget_exhausted", async () => {
  // Each fake job takes 1000 ms; a budget of 1.5 s lets both hypotheses run (they start together) and no challenge.
  const harness = diagnosisHarness({ spots: twoClusters, budgetMinutes: 1.5 / 60 });
  equal(await harness.start(), 1);
  deepStrictEqual(harness.agents.calls.map((call) => call.kind), ["hypothesis", "hypothesis"]);
  deepStrictEqual(Object.values(await clustersOf(harness)).map((cluster) => cluster.status), ["budget_exhausted", "budget_exhausted"]);
});

test("--no-diagnosis and --only triage run no model job; no cluster ends the run after preparing nothing", async () => {
  const off = diagnosisHarness({ spots: twoClusters });
  equal(await off.start({ noDiagnosis: true }), 1);
  equal(off.agents.calls.length, 0);
  const triageOnly = diagnosisHarness({ spots: twoClusters });
  deepStrictEqual([nodeMode("diagnose", "triage"), nodeMode("triage", "diagnose"), nodeMode("diagnose", null)], ["skip", "reuse-only", "run"]);
  equal(await triageOnly.start({ only: "triage" }), 1);
  equal(triageOnly.agents.calls.length, 0);
  const empty = join(scratch(), "triage.json");
  const none = diagnosisHarness({
    spots: twoClusters,
    extraSteps: {
      triage: async (input) => {
        writeFileSync(empty, JSON.stringify(triageDocument(input.threadId, [], {})));
        return { path: empty, discrepancies: 0, clusters: 0, newClusters: 0, otherFindings: 0 };
      },
    },
  });
  equal(await none.start(), 1);
  equal(none.agents.calls.length, 0);
  deepStrictEqual((await none.state(none.threadId())).clusters, {});
});

test("the router waits first, then hypothesizes, then challenges, then checks once", () => {
  const cluster = (id: string, status: ClusterDiagnosis["status"], waiting = false): ClusterDiagnosis => ({
    clusterId: id, contextFolder: "f", contextHash: "h", status, hypothesis: null, challenge: null, failure: null, records: [],
    waiting: waiting ? { job: "hypothesis", provider: "claude", since: "t", processId: "p", message: "m" } : null,
  });
  deepStrictEqual(nextDiagnosisRoute({ a: cluster("a", "pending", true), b: cluster("b", "pending") }, false), { kind: "wait_for_quota" });
  deepStrictEqual(nextDiagnosisRoute({ a: cluster("a", "pending"), b: cluster("b", "hypothesized") }, false), { kind: "hypothesize", clusters: ["a"] });
  deepStrictEqual(nextDiagnosisRoute({ a: cluster("a", "failed"), b: cluster("b", "hypothesized") }, false), { kind: "challenge", clusters: ["b"] });
  deepStrictEqual(nextDiagnosisRoute({ a: cluster("a", "challenged"), b: cluster("b", "abstained") }, false), { kind: "check" });
  deepStrictEqual(nextDiagnosisRoute({ a: cluster("a", "challenged") }, true), { kind: "end" });
  deepStrictEqual(nextDiagnosisRoute({ a: cluster("a", "budget_exhausted") }, false), { kind: "end" });
});
