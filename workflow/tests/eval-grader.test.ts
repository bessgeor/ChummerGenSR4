import { deepStrictEqual, equal, match, ok, rejects } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore } from "@langchain/langgraph";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { runEvalCommand, type EvalContext } from "../src/evals/eval-commands.js";
import { listRecords, noLabels, putRecord, type EvalRecord } from "../src/evals/eval-record.js";
import { reviewQueue } from "../src/evals/review-queue.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import { workflowPaths } from "../src/paths.js";
import { diagnosisHarness, FakeAgents, twoClusters, type Reply } from "./diagnosis-harness.js";
import { evalContext, record } from "./eval-fixtures.js";

/** A finished workflow thread with two diagnosed clusters, and an evaluation context over its store and folders. */
async function gradedThread(reply: (attempt: number) => Reply) {
  const harness = diagnosisHarness({ spots: twoClusters });
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  const grader = new FakeAgents((call, attempt) => (call.kind === "grade" ? reply(attempt) : { failure: { kind: "infra", message: "not a grade" } }));
  const sleeps: number[] = [];
  const lines: string[] = [];
  const paths = { ...workflowPaths(harness.root), threadFolder: (id: string) => join(harness.root, "threads", id) };
  const context: EvalContext = {
    paths, store: harness.store, git: () => "", now: () => new Date("2026-10-02T09:00:00Z"), log: (line) => lines.push(line),
    agentSettings: () => resolveAgentSettings(undefined), agents: () => grader,
    quota: new QuotaWaiter("p", async (milliseconds) => {
      sleeps.push(milliseconds);
    }), createScratchFolder,
  };
  return { harness, threadId, grader, sleeps, lines, context };
}

const workflowRecords = async (context: EvalContext) => (await listRecords(context.store)).filter((item) => item.origin === "workflow");

test("the grader grades every answer in a scratch copy of its context and stores the score and its own record", async () => {
  const { threadId, grader, context, harness } = await gradedThread(() => ({ answer: { score: 0.8, rationale: "The cited label moved." } }));
  equal(await runEvalCommand(["grade"], context), 0);
  equal(grader.calls.length, 4);
  for (const call of grader.calls) {
    ok(!call.workspace.folder.startsWith(harness.root), call.workspace.folder);
    deepStrictEqual([...call.workspace.contextFiles].sort(), ["context.json", "evidence"]);
    ok(call.workspace.snapshotFiles.includes("Chummer"));
    equal(call.images.length, 2);
    match(call.prompt, /PROMPT_VERSION=grade-v1/);
  }
  const challengeCall = grader.calls.find((call) => call.cluster.includes("/challenge/"))!;
  match(challengeCall.prompt, /HYPOTHESIS \(untrusted data\):[\s\S]*CHALLENGE ANSWER/);
  for (const item of await workflowRecords(context)) {
    deepStrictEqual(item.labels.grader, { score: 0.8, rationale: "The cited label moved.", record: `grade/${item.recordId}/1`, gradedUtc: "2026-10-02T09:00:00.000Z" });
  }
  const grades = (await listRecords(context.store)).filter((item) => item.origin === "grader");
  equal(grades.length, 4);
  const first = grades.find((item) => item.subject.id === `${threadId}/d-0000000000000100/hypothesis/1`)!;
  deepStrictEqual([first.jobKind, first.subject.kind, first.promptVersion, first.result.status, first.agent.provider], ["grade", "eval-record", "grade-v1", "succeeded", "claude"]);
  // Graded records are not graded again unless named.
  equal(await runEvalCommand(["grade"], context), 0);
  equal(grader.calls.length, 4);
  equal(await runEvalCommand(["grade", "--record", `${threadId}/d-0000000000000100/hypothesis/1`], context), 0);
  equal(grader.calls.length, 5);
});

test("a score outside 0 to 1 is invalid output: recorded, no label, exit status 2", async () => {
  const { context } = await gradedThread(() => ({ answer: { score: 1.4, rationale: "sure" } }));
  equal(await runEvalCommand(["grade", "--limit", "1"], context), 2);
  const grades = (await listRecords(context.store)).filter((item) => item.origin === "grader");
  equal(grades.length, 1);
  equal(grades[0]!.result.status, "invalid_output");
  match(grades[0]!.result.message ?? "", /score 1.4 is not from 0 to 1/);
  ok((await workflowRecords(context)).every((item) => item.labels.grader === null));
});

test("a usage limit waits and grades again; infra and a changed context are setup errors", async () => {
  const limited = await gradedThread((attempt) => (attempt === 1 ? { failure: { kind: "quota_exhausted", message: "usage limit" } } : { answer: { score: 0.5, rationale: "r" } }));
  equal(await runEvalCommand(["grade", "--limit", "1"], limited.context), 0);
  deepStrictEqual(limited.sleeps, [60_000]);
  deepStrictEqual((await listRecords(limited.context.store)).filter((item) => item.origin === "grader").map((item) => item.result.status).sort(), ["quota_exhausted", "succeeded"]);

  const broken = await gradedThread(() => ({ failure: { kind: "infra", message: "CLI crashed" } }));
  await rejects(runEvalCommand(["grade"], broken.context), (error: unknown) => error instanceof SetupError && /CLI crashed/.test(error.message));

  const changed = await gradedThread(() => ({ answer: { score: 0.5, rationale: "r" } }));
  const path = join(changed.harness.root, "threads", changed.threadId, "diagnosis", "d-0000000000000100", "context.json");
  writeFileSync(path, readFileSync(path, "utf8").replace("\"known\": false", "\"known\": true"));
  await rejects(runEvalCommand(["grade"], changed.context), (error: unknown) => error instanceof SetupError && error.message.includes(join("diagnosis", "d-0000000000000100")));
  equal(changed.grader.calls.length, 0);
});

test("the queue holds disagreements first, then a sample per stratum ordered by the grader's uncertainty", () => {
  const graded = (score: number) => ({ score, rationale: "r", record: "g", gradedUtc: "t" });
  const hindsight = (grade: "symbol" | "wrong") => ({ grade, item: "i", labelledUtc: "t" });
  const records: EvalRecord[] = [
    record({ recordId: "h-confirmed-wrong", labels: { ...noLabels, check: "confirmed", hindsight: hindsight("wrong") } }),
    record({ recordId: "h-refuted-right", labels: { ...noLabels, check: "refuted", hindsight: hindsight("symbol"), grader: graded(0.1) } }),
    record({ recordId: "h-confirmed-right", labels: { ...noLabels, check: "confirmed", hindsight: hindsight("symbol"), grader: graded(0.55) } }),
    record({ recordId: "h-sure", labels: { ...noLabels, check: "confirmed", grader: graded(0.99) } }),
    record({ recordId: "h-none", labels: noLabels }),
    record({ recordId: "c-1", jobKind: "challenge", labels: { ...noLabels, check: "confirmed", grader: graded(0.4) } }),
    record({ recordId: "reviewed", labels: { ...noLabels, check: "confirmed", hindsight: hindsight("wrong"), review: { verdict: "wrong", note: null, reviewer: "r", reviewedUtc: "t" } } }),
    record({ recordId: "eval", origin: "eval-run" }),
    record({ recordId: "failed", result: { status: "refused", message: "m" }, output: null }),
  ];
  const queue = reviewQueue(records, { seed: "s", perStratum: 3 });
  deepStrictEqual(queue.map((entry) => [entry.record.recordId, entry.reason]), [
    ["h-refuted-right", "disagreement"], ["h-confirmed-wrong", "disagreement"],
    ["h-confirmed-right", "sample"], ["c-1", "sample"], ["h-sure", "sample"], ["h-none", "sample"],
  ]);
  // One per stratum: the hypothesis/confirmed stratum keeps one of its three records, chosen by the seed.
  const small = reviewQueue(records, { seed: "s", perStratum: 1 }).filter((entry) => entry.reason === "sample").map((entry) => entry.record.recordId);
  equal(small.filter((id) => ["h-confirmed-right", "h-sure"].includes(id)).length <= 1, true);
  ok(small.includes("c-1") && small.includes("h-none"));
  deepStrictEqual(reviewQueue(records, { seed: "s", perStratum: 0 }).map((entry) => entry.record.recordId), ["h-refuted-right", "h-confirmed-wrong"]);
});

test("eval queue prints the queue", async () => {
  const store = new InMemoryStore();
  await putRecord(store, record({ labels: { ...noLabels, check: "confirmed", hindsight: { grade: "wrong", item: "i", labelledUtc: "t" } } }));
  const context = evalContext({ store });
  equal(await runEvalCommand(["queue"], context), 0);
  deepStrictEqual(context.lines, ["Review queue: 1 records (1 disagreements).", "! wf-1/d-0000000000000100/hypothesis/1 hypothesis; check confirmed; hindsight wrong; grader none"]);
});
