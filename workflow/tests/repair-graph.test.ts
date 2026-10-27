import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { EvalRecordSchema, recordNamespace } from "../src/evals/eval-record.js";
import { dispatchesRepair, unattendedProblems } from "../src/evals/certificate.js";
import type { RunOptions } from "../src/options/run-options.js";
import type { RepairDocument } from "../src/repair/repair-report.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource, type BuildBehaviour, type CheckBehaviour } from "./repair-fixtures.js";
import { scratch } from "./diagnosis-fixtures.js";

const first = "d-0000000000000100";
const second = "d-0000000000000400";

/** Diagnosis answers for both clusters (the second refuted unless `confirmBoth`), and the given repair reply. */
function agents(repair: (call: JobCall, attempt: number) => Reply = patchedReply({ "Chummer/frmCreate.cs": repairedSource }), confirmBoth = true): FakeAgents {
  return new FakeAgents((call, attempt) => {
    if (call.kind === "repair") return repair(call, attempt);
    if (call.kind === "challenge") return { answer: challengeAnswer() };
    const answer = hypothesisAnswer();
    if (confirmBoth || call.cluster === first) return { answer };
    // A hypothesis whose prediction the check observes to be wrong: refuted.
    return { answer: { ...answer, explanation: { ...answer.explanation!, predictions: [{ case: "build-alpha", capture: "skills", expect: "matches", why: "w" }, answer.explanation!.predictions[1]!] } } };
  });
}

function withRepair(fake: FakeAgents, options: { build?: BuildBehaviour; check?: CheckBehaviour; spots?: typeof twoClusters; extra?: Partial<Parameters<typeof diagnosisHarness>[0]> } = {}) {
  return diagnosisHarness({
    spots: options.spots ?? twoClusters, agents: fake,
    repair: { deadlineMinutes: 60, host: (root) => new FakeRepairHost(root, options.build ?? 0, options.check ?? {}) },
    ...options.extra,
  });
}

function repairDocumentOf(root: string, threadId: string): RepairDocument {
  return JSON.parse(readFileSync(join(root, "threads", threadId, "repair.json"), "utf8")) as RepairDocument;
}

test("after diagnosis, each confirmed cluster gets one attempt, side by side, and repair.json and the report list them", async () => {
  const fake = agents();
  const harness = withRepair(fake);
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  const repairs = fake.events.filter((event) => event.startsWith("repair"));
  // Both attempts start before either ends.
  deepStrictEqual(repairs.slice(0, 2).map((event) => event.endsWith("start")), [true, true]);
  deepStrictEqual(harness.repairHost.checks.map((check) => `${check.cases.join(",")}/${check.captures.join(",")}`).sort(), ["build-alpha/skills", "career-beta/common"]);
  const state = await harness.state(threadId);
  deepStrictEqual(Object.values(state.repairs).map((repair) => [repair.clusterId, repair.status]).sort(), [[first, "passed"], [second, "passed"]]);
  equal(state.repairPath, join(harness.root, "threads", threadId, "repair.json"));
  const document = repairDocumentOf(harness.root, threadId);
  deepStrictEqual(document.totals, { clusters: 2, pending: 0, passed: 2, rejected: 0, failed: 0, budget_exhausted: 0 });
  ok(harness.lines.some((line) => line.startsWith(`Repair ${first}: attempt 1 PASSED the narrow check; 1 records; archive `)));
  ok(harness.lines.some((line) => line.startsWith(`Repair ${first}: narrow check execution: capture status 0, coverage valid, `)));
  ok(harness.lines.some((line) => line === `Repair ${first}: narrow check visual: 1 passed, 0 failed`));
  ok(harness.lines.some((line) => line.startsWith("Repair: 2 clusters; ")));
});

test("refuted clusters get no attempt", async () => {
  const fake = agents(undefined, false);
  const harness = withRepair(fake);
  equal(await harness.start(), 1);
  const state = await harness.state(harness.threadId());
  deepStrictEqual(Object.keys(state.repairs), [first]);
  equal(fake.calls.filter((call) => call.kind === "repair").length, 1);
});

test("--no-repair and --only end the run before repair", async () => {
  for (const overrides of [{ noRepair: true }, { only: "diagnose" as const }]) {
    const fake = agents();
    const harness = withRepair(fake);
    await harness.start(overrides);
    equal(fake.calls.filter((call) => call.kind === "repair").length, 0, JSON.stringify(overrides));
    const state = await harness.state(harness.threadId());
    deepStrictEqual(state.repairs, {});
    equal(state.repairPath, null);
    ok(!existsSync(join(harness.root, "threads", harness.threadId(), "repair.json")));
  }
});

test("a rejected attempt leaves the exit status to the compare; a failed repair job or a lost narrow check makes it 2", async () => {
  const rejected = withRepair(agents(), { check: { observed: { "build-alpha/skills": "failed" } }, spots: [twoClusters[0]!] });
  equal(await rejected.start(), 1);
  ok(rejected.lines.some((line) => line.startsWith(`Repair ${first}: attempt 1 rejected at check: still differs: build-alpha/skills`)));
  ok(rejected.lines.some((line) => line === `Repair ${first}: narrow check visual: 0 passed, 1 failed`));
  const failed = withRepair(agents(() => ({ failure: { kind: "refused", message: "no" } })), { spots: [twoClusters[0]!] });
  equal(await failed.start(), 2);
  ok(failed.lines.some((line) => line.startsWith(`Repair ${first}: attempt 1 FAILED at model: refused: no`)));
  const lost = withRepair(agents(), { check: { status: 2 }, spots: [twoClusters[0]!] });
  equal(await lost.start(), 2);
  ok(lost.lines.some((line) => line.startsWith(`Repair ${first}: narrow check execution: capture status 2, coverage INVALID: failure:build-alpha/candidate`)));
});

test("a usage limit in a repair job waits and the attempt runs again", async () => {
  const fake = agents((call, attempt) => (attempt === 1 ? { failure: { kind: "quota_exhausted", message: "You've hit your usage limit." } } : patchedReply({ "Chummer/frmCreate.cs": repairedSource })(call)));
  const harness = withRepair(fake, { spots: [twoClusters[0]!] });
  equal(await harness.start(), 1);
  deepStrictEqual(harness.sleeps, [60_000]);
  const repair = (await harness.state(harness.threadId())).repairs[first]!;
  equal(repair.status, "passed");
  deepStrictEqual(repair.records, [1, 2].map((attempt) => `${harness.threadId()}/${first}/repair/${attempt}`));
});

test("a run killed during a narrow check resumes with a new attempt and does not diagnose again", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const fake = agents();
  const killed = withRepair(fake, { spots: [twoClusters[0]!], check: { hang: () => setTimeout(() => controller.abort(), 10) }, extra: { checkpointer, store, signal: controller.signal } });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  ok(killed.lines.some((line) => /Interrupted/.test(line)));
  const resumed = withRepair(fake, { spots: [twoClusters[0]!], extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
  equal(await resumed.resume(threadId), 1);
  deepStrictEqual(fake.calls.map((call) => call.kind), ["hypothesis", "challenge", "repair", "repair"]);
  const repair = (await resumed.state(threadId)).repairs[first]!;
  equal(repair.status, "passed");
  deepStrictEqual(repair.records, [1, 2].map((attempt) => `${threadId}/${first}/repair/${attempt}`));
  equal(repair.attempt?.attempt, 2);
  const interrupted = EvalRecordSchema.parse((await store.get(recordNamespace("repair"), `${threadId}/${first}/repair/1`))!.value);
  equal(interrupted.labels.repair, null);
  ok(!existsSync(join(killed.root, "threads", threadId, "repair", first, "attempt-1")));
});

test("an unattended run that would repair is refused; --no-repair, --no-diagnosis and --only lift it", () => {
  const options = (overrides: Partial<RunOptions>): RunOptions => ({
    caseFile: "c", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: null, canonicalCacheSource: "off", noOcr: false, tessdata: null,
    only: null, recapture: false, diagnosis: true, agents: resolveAgentSettings(undefined), unattended: true, certificates: scratch(), repair: { deadlineMinutes: 60 }, widening: true, ...overrides,
  });
  ok(unattendedProblems(options({})).some((problem) => /^repair: .*add --no-repair/.test(problem)));
  ok(!unattendedProblems(options({ repair: null })).some((problem) => problem.startsWith("repair")));
  deepStrictEqual([dispatchesRepair(options({ diagnosis: false })), dispatchesRepair(options({ only: "diagnose" })), dispatchesRepair({ diagnosis: true, only: null, repair: null })], [false, false, false]);
  deepStrictEqual(unattendedProblems(options({ unattended: false })), []);
});
