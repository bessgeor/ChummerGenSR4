import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { variantChecks } from "../src/diagnosis/check.js";
import { clusterStatus, mergeClusters, pendingVariants, variantsOf, variantUpdate, type ClusterDiagnosis } from "../src/diagnosis/cluster-diagnosis.js";
import type { DiagnosisDocument } from "../src/diagnosis/diagnosis-document.js";
import { EvalRecordSchema, recordNamespace, type CheckLabel } from "../src/evals/eval-record.js";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource } from "./repair-fixtures.js";

const clusterId = "d-0000000000000100";
const firstClaim = "The Skills tab label moved in frmCreate.";
const secondClaim = "The Skills tab label font changed in frmCreate.";

/** A hypothesis whose first prediction the check observes to be wrong: refuted. */
function refutedAnswer(): Reply {
  const answer = hypothesisAnswer(firstClaim);
  return { answer: { ...answer, explanation: { ...answer.explanation!, predictions: [{ case: "build-alpha", capture: "skills", expect: "matches", why: "w" }, answer.explanation!.predictions[1]!] } } };
}

const abstain: Reply = { answer: { outcome: "abstain", reason: "The crops show no readable change.", explanation: null } };

/** Diagnosis answers by hypothesis: the first refuted, the second confirmed, unless `hypothesis` says otherwise. */
function agents(hypothesis: (call: JobCall) => Reply = (call) => (call.variant === 1 ? refutedAnswer() : { answer: hypothesisAnswer(secondClaim) }), other?: (call: JobCall, attempt: number) => Reply | null): FakeAgents {
  return new FakeAgents((call, attempt) => other?.(call, attempt) ?? (call.kind === "hypothesis" ? hypothesis(call) : { answer: challengeAnswer() }));
}

async function clusterOf(harness: ReturnType<typeof diagnosisHarness>, threadId = harness.threadId()): Promise<ClusterDiagnosis> {
  return (await harness.state(threadId)).clusters[clusterId] as ClusterDiagnosis;
}

async function labelOf(store: InMemoryStore, recordId: string): Promise<CheckLabel | null> {
  const kind = recordId.includes("/hypothesis/") ? "hypothesis" : "challenge";
  return EvalRecordSchema.parse((await store.get(recordNamespace(kind), recordId))!.value).labels.check;
}

/** Each hypothesis's records with their check labels. */
async function labelsByVariant(store: InMemoryStore, cluster: ClusterDiagnosis): Promise<(CheckLabel | null)[][]> {
  return Promise.all(variantsOf(cluster).map((variant) => Promise.all(variant.records.map((id) => labelOf(store, id)))));
}

test("two hypotheses run side by side, each is challenged and judged; one confirmed makes the cluster confirmed", async () => {
  const fake = agents();
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, hypotheses: 2 });
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  // Both hypotheses start before either ends, and their challenges after both ended.
  const at = (event: string) => fake.events.indexOf(event);
  ok(at(`hypothesis ${clusterId} #2 start`) < at(`hypothesis ${clusterId} #1 end`) && at(`hypothesis ${clusterId} #1 start`) < at(`hypothesis ${clusterId} #2 end`), fake.events.join(", "));
  ok(Math.max(at(`hypothesis ${clusterId} #1 end`), at(`hypothesis ${clusterId} #2 end`)) < Math.min(at(`challenge ${clusterId} #1 start`), at(`challenge ${clusterId} #2 start`)));
  // Each challenge sees its own hypothesis only.
  const challenges = fake.calls.filter((call) => call.kind === "challenge").sort((a, b) => a.variant - b.variant);
  deepStrictEqual(challenges.map((call) => call.variant), [1, 2]);
  ok(challenges[0]!.prompt.includes(firstClaim) && !challenges[0]!.prompt.includes(secondClaim));
  ok(challenges[1]!.prompt.includes(secondClaim) && !challenges[1]!.prompt.includes(firstClaim));
  const cluster = await clusterOf(harness);
  deepStrictEqual(variantsOf(cluster).map((variant) => [variant.variant, variant.status]), [[1, "challenged"], [2, "challenged"]]);
  equal(clusterStatus(cluster), "challenged");
  // The two hypotheses' records are numbered from one sequence, and each challenge record names its own hypothesis.
  deepStrictEqual(variantsOf(cluster).map((variant) => variant.hypothesis!.recordId).sort(), [1, 2].map((n) => `${threadId}/${clusterId}/hypothesis/${n}`));
  deepStrictEqual(cluster.records.length, 4);
  for (const variant of variantsOf(cluster)) {
    const challenge = EvalRecordSchema.parse((await harness.store.get(recordNamespace("challenge"), variant.challenge!.recordId))!.value);
    equal(challenge.challenged, variant.hypothesis!.recordId);
  }
  // One check run covers the predictions of both hypotheses and both alternatives.
  equal(harness.checks.length, 1);
  deepStrictEqual([harness.checks[0]!.cases, harness.checks[0]!.captures], [["build-alpha", "career-beta"], ["skills", "common"]]);
  const check = (await harness.state(threadId)).diagnosisCheck!.clusters[clusterId]!;
  equal(check.outcome, "confirmed");
  deepStrictEqual(variantChecks(check).map((item) => [item.variant, item.outcome]), [[1, "refuted"], [2, "confirmed"]]);
  // Each record gets the label of its own hypothesis.
  deepStrictEqual(await labelsByVariant(harness.store, cluster), [["refuted", "refuted"], ["confirmed", "confirmed"]]);
  const document = JSON.parse(readFileSync(join(harness.root, "threads", threadId, "diagnosis.json"), "utf8")) as DiagnosisDocument;
  deepStrictEqual(document.clusters[0]!.hypotheses.map((variant) => [variant.variant, variant.status, variant.records.length]), [[1, "challenged", 2], [2, "challenged", 2]]);
  deepStrictEqual([document.totals.challenged, document.totals.confirmed], [1, 1]);
  const line = harness.lines.find((item) => item.startsWith(`Diagnosis ${clusterId}:`))!;
  ok(line.includes(`hypothesis 1 (claude default/medium): ${firstClaim}`) && line.includes("check refuted; hypothesis 2 (claude default/medium)"), line);
  ok(line.endsWith("check confirmed; cluster check confirmed; 4 records"), line);
  ok(harness.lines.includes(`Diagnosis check: ${clusterId} confirmed (hypothesis 1 refuted, hypothesis 2 confirmed).`));
});

test("every hypothesis refuted refutes the cluster", async () => {
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents: agents(() => refutedAnswer()), hypotheses: 2 });
  equal(await harness.start(), 1);
  const check = (await harness.state(harness.threadId())).diagnosisCheck!.clusters[clusterId]!;
  deepStrictEqual([check.outcome, variantChecks(check).map((item) => item.outcome)], ["refuted", ["refuted", "refuted"]]);
});

test("the repair starts from the confirmed hypothesis when the first was refuted", async () => {
  const repair = patchedReply({ "Chummer/frmCreate.cs": repairedSource });
  const fake = agents(undefined, (call) => (call.kind === "repair" ? repair(call) : null));
  const harness = diagnosisHarness({
    spots: [twoClusters[0]!], agents: fake, hypotheses: 2, repair: { deadlineMinutes: 60, host: (root) => new FakeRepairHost(root) },
  });
  equal(await harness.start(), 1);
  const cluster = await clusterOf(harness);
  const prompt = fake.calls.find((call) => call.kind === "repair")!.prompt;
  ok(prompt.includes(secondClaim) && !prompt.includes(firstClaim), prompt);
  const attempt = JSON.parse(readFileSync(join(harness.root, "threads", harness.threadId(), "repair", clusterId, "attempt-1", "attempt.json"), "utf8")) as { hypothesisRecord: string };
  equal(attempt.hypothesisRecord, variantsOf(cluster)[1]!.hypothesis!.recordId);
});

test("an abstaining hypothesis gets no challenge and no label; the other decides the cluster", async () => {
  const fake = agents((call) => (call.variant === 2 ? abstain : { answer: hypothesisAnswer(firstClaim) }));
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, hypotheses: 2 });
  equal(await harness.start(), 1);
  deepStrictEqual(fake.calls.filter((call) => call.kind === "challenge").map((call) => call.variant), [1]);
  const cluster = await clusterOf(harness);
  deepStrictEqual(variantsOf(cluster).map((variant) => variant.status), ["challenged", "abstained"]);
  equal(clusterStatus(cluster), "challenged");
  const check = (await harness.state(harness.threadId())).diagnosisCheck!.clusters[clusterId]!;
  deepStrictEqual([check.outcome, variantChecks(check).map((item) => [item.variant, item.outcome])], ["confirmed", [[1, "confirmed"]]]);
  deepStrictEqual(await labelsByVariant(harness.store, cluster), [["confirmed", "confirmed"], [null]]);
  ok(harness.lines.some((line) => line.includes("hypothesis 2 (claude default/medium) abstained: The crops show no readable change.")));
});

test("a cluster whose every hypothesis abstained is abstained and not checked", async () => {
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents: agents(() => abstain), hypotheses: 3 });
  equal(await harness.start(), 1);
  const cluster = await clusterOf(harness);
  deepStrictEqual(variantsOf(cluster).map((variant) => variant.status), ["abstained", "abstained", "abstained"]);
  equal(clusterStatus(cluster), "abstained");
  equal(harness.checks.length, 0);
  const outcome = JSON.parse(readFileSync(join(harness.root, "threads", harness.threadId(), "outcome.json"), "utf8")) as OutcomeDocument;
  deepStrictEqual(outcome.clusters.map((item) => item.disposition), ["abstained"]);
});

test("a failed hypothesis fails its cluster: the other hypothesis is not challenged", async () => {
  const fake = agents((call) => {
    if (call.variant === 1) return { answer: hypothesisAnswer(firstClaim) };
    const answer = hypothesisAnswer(secondClaim);
    return { answer: { ...answer, explanation: { ...answer.explanation!, locations: [{ path: "Chummer/missing.cs", symbol: null, line: null }] } } };
  });
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, hypotheses: 2 });
  equal(await harness.start(), 2);
  equal(fake.calls.filter((call) => call.kind === "challenge").length, 0);
  const cluster = await clusterOf(harness);
  deepStrictEqual(variantsOf(cluster).map((variant) => variant.status), ["hypothesized", "failed"]);
  equal(clusterStatus(cluster), "failed");
  ok(harness.lines.some((line) => line.includes("FAILED: hypothesis invalid_output")));
});

test("a run killed during a hypothesis's challenge resumes it alone, and the labels stay per hypothesis", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const fake = agents(undefined, (call, attempt) => {
    if (call.kind !== "challenge" || call.variant !== 2 || attempt > 1) return null;
    setTimeout(() => controller.abort(), 10);
    return { hang: true };
  });
  const killed = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, hypotheses: 2, checkpointer, store, signal: controller.signal });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const resumed = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, hypotheses: 2, checkpointer, store, root: killed.root });
  equal(await resumed.resume(threadId), 1);
  // The hypotheses are not asked again; the second hypothesis's challenge runs again.
  deepStrictEqual(fake.calls.filter((call) => call.kind === "hypothesis").map((call) => call.variant).sort(), [1, 2]);
  equal(fake.calls.filter((call) => call.kind === "challenge" && call.variant === 2).length, 2);
  const cluster = await clusterOf(resumed, threadId);
  deepStrictEqual(variantsOf(cluster).map((variant) => variant.status), ["challenged", "challenged"]);
  deepStrictEqual(new Set(cluster.records).size, cluster.records.length);
  deepStrictEqual(await labelsByVariant(store, cluster), [["refuted", "refuted"], ["confirmed", "confirmed"]]);
  for (const id of cluster.records) ok((await labelOf(store, id)) !== null, id);
});

test("a thread stored with one hypothesis per cluster is read and resumed as one hypothesis", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const fake = agents(() => ({ answer: hypothesisAnswer(firstClaim) }), (call, attempt) => {
    if (call.kind !== "challenge" || attempt > 1) return null;
    setTimeout(() => controller.abort(), 10);
    return { hang: true };
  });
  // Without `hypotheses` the options are those of a thread stored before a cluster could have several.
  const killed = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, checkpointer, store, signal: controller.signal });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const stored = await clusterOf(killed, threadId);
  deepStrictEqual([stored.variants, stored.firstRecords, (await killed.state(threadId)).options.hypotheses], [undefined, undefined, undefined]);
  const resumed = diagnosisHarness({ spots: [twoClusters[0]!], agents: fake, checkpointer, store, root: killed.root });
  equal(await resumed.resume(threadId), 1);
  deepStrictEqual(fake.calls.map((call) => [call.kind, call.variant]), [["hypothesis", 1], ["challenge", 1], ["challenge", 1]]);
  const cluster = await clusterOf(resumed, threadId);
  deepStrictEqual([cluster.variants, cluster.firstRecords, variantsOf(cluster).length], [undefined, undefined, 1]);
  const check = (await resumed.state(threadId)).diagnosisCheck!.clusters[clusterId]!;
  deepStrictEqual(variantChecks(check).map((item) => [item.variant, item.outcome]), [[1, "confirmed"]]);
  for (const id of cluster.records) equal(await labelOf(store, id), "confirmed", id);
  ok(resumed.lines.includes(`Diagnosis check: ${clusterId} confirmed.`));
});

test("the updates of two hypotheses of one cluster in one step both stay, and a whole cluster replaces the one it names", () => {
  const cluster: ClusterDiagnosis = {
    clusterId: "a", contextFolder: "f", contextHash: "h", status: "pending", hypothesis: null, challenge: null, waiting: null, failure: null,
    records: [], firstRecords: [], variants: pendingVariants(3),
  };
  const first = { ...variantUpdate(cluster, 1, { status: "abstained", records: ["t/a/hypothesis/1"] }), records: ["t/a/hypothesis/1"] };
  const third = { ...variantUpdate(cluster, 3, { status: "hypothesized", records: ["t/a/hypothesis/2"] }), records: ["t/a/hypothesis/1", "t/a/hypothesis/2"] };
  const merged = mergeClusters(mergeClusters({ a: cluster }, { a: first }), { a: third })["a"]!;
  deepStrictEqual(variantsOf(merged).map((variant) => [variant.variant, variant.status, variant.records]),
    [[1, "abstained", ["t/a/hypothesis/1"]], [2, "pending", []], [3, "hypothesized", ["t/a/hypothesis/2"]]]);
  deepStrictEqual(merged.records, ["t/a/hypothesis/1", "t/a/hypothesis/2"]);
  equal(clusterStatus(merged), "pending");
  // With one hypothesis the cluster keeps no list of the first hypothesis's own records.
  const { variants: _variants, firstRecords: _firstRecords, ...fields } = cluster;
  const single: ClusterDiagnosis = { ...fields, records: ["r"] };
  deepStrictEqual(variantUpdate(single, 1, { status: "hypothesized", records: ["r"] }), { clusterId: "a", status: "hypothesized" });
  deepStrictEqual(mergeClusters({ a: merged }, { a: single })["a"], single);
});
