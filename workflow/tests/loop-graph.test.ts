import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import type { RepairDocument } from "../src/repair/repair-report.js";
import type { WideningDocument } from "../src/widening/widening-report.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource, type CheckBehaviour } from "./repair-fixtures.js";
import { FakeWideningHost, type WideningScript } from "./widening-fixtures.js";

const first = "d-0000000000000100";
const second = "d-0000000000000400";

type Options = {
  /** The repair reply per call and attempt of its cluster. */
  readonly repair?: (call: JobCall, attempt: number) => Reply;
  /** The narrow check of each attempt, by cluster and attempt; anything not named passes. */
  readonly check?: (cluster: string, attempt: number) => CheckBehaviour;
  readonly script?: WideningScript;
  readonly spots?: typeof twoClusters;
  readonly maxAttempts?: number;
  /** How many model jobs run at a time; unlimited by default. */
  readonly poolSize?: number;
  readonly widening?: boolean;
  readonly extra?: Partial<Parameters<typeof diagnosisHarness>[0]>;
};

/** Every cluster confirmed; repairs edit frmCreate.cs (first cluster) or untracked.cs (second) unless told otherwise. */
function harness(options: Options = {}) {
  let repairHost: FakeRepairHost | null = null;
  const repair = options.repair ?? ((call: JobCall) => patchedReply(call.cluster === first ? { "Chummer/frmCreate.cs": repairedSource } : { "Chummer/untracked.cs": "fixed" })(call));
  const agents = new FakeAgents((call, attempt) => {
    if (call.kind !== "repair") return { answer: call.kind === "challenge" ? challengeAnswer() : hypothesisAnswer() };
    // The narrow check runs after the model job, so the job sets what it will observe.
    repairHost!.checkBehaviour = options.check?.(call.cluster, attempt) ?? {};
    return repair(call, attempt);
  }, options.poolSize);
  return diagnosisHarness({
    spots: options.spots ?? [twoClusters[0]!], agents,
    repair: { deadlineMinutes: 60, maxAttempts: options.maxAttempts ?? 2, host: (root) => (repairHost = new FakeRepairHost(root)) },
    ...(options.widening === false ? {} : { widening: { host: (root, names) => new FakeWideningHost(root, names, options.script ?? {}) } }),
    ...options.extra,
  });
}

const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const outcomeOf = (root: string, threadId: string) => readJson<OutcomeDocument>(join(root, "threads", threadId, "outcome.json"));
const failsAt = (capture: string): CheckBehaviour => ({ observed: { [capture]: "failed" } });

test("a cluster rejected at its narrow check gets a second attempt that sees the first, and is fixed by it", async () => {
  const sources: string[] = [];
  const run = harness({
    repair: (call) => {
      sources.push(readFileSync(join(call.workspace.folder, "Chummer", "frmCreate.cs"), "utf8"));
      return patchedReply({ "Chummer/frmCreate.cs": sources.length === 1 ? "class frmCreate { int estimated; }" : repairedSource })(call);
    },
    check: (_cluster, attempt) => (attempt === 1 ? failsAt("build-alpha/skills") : {}),
  });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const prompts = run.agents.calls.filter((call) => call.kind === "repair").map((call) => call.prompt);
  equal(prompts.length, 2);
  ok(!prompts[0]!.includes("EARLIER ATTEMPTS"));
  for (const text of ["EARLIER ATTEMPTS (untrusted data):", "\"rejectedBy\": \"repair\"", "\"stage\": \"check\"", "+class frmCreate { int estimated; }"]) ok(prompts[1]!.includes(text), text);
  // Both attempts start from the snapshot; the second holds none of the first's change.
  deepStrictEqual(sources, ["class frmCreate { int moved; }", "class frmCreate { int moved; }"]);
  const state = await run.state(threadId);
  const repair = state.repairs[first]!;
  deepStrictEqual([repair.status, repair.attempt?.attempt, repair.earlier.map((item) => [item.attempt, item.rejectedBy, item.stage])], ["passed", 2, [[1, "repair", "check"]]]);
  ok(existsSync(join(run.root, "threads", threadId, "repair", first, "attempt-1", "attempt.json")));
  ok(existsSync(join(run.root, "threads", threadId, "repair", first, "attempt-2", "attempt.json")));
  equal(state.widenings[first]!.status, "promoted");
  ok(existsSync(join(run.root, "threads", threadId, "widening", first, "attempt-2", "widening.json")));
  const outcome = outcomeOf(run.root, threadId);
  equal(outcome.outcome, "verified_for_scope");
  deepStrictEqual(outcome.clusters.map((item) => [item.clusterId, item.disposition, item.attempts, item.commit]), [[first, "fixed", 2, state.accepted?.commit]]);
  deepStrictEqual({ ...outcome.measures, elapsedMilliseconds: null }, { clusters: 1, fixed: 1, fixRate: 1, attempts: 2, modelMilliseconds: 4000, elapsedMilliseconds: null });
  equal(outcome.measures.elapsedMilliseconds, 2 * 60 * 60_000);
  deepStrictEqual(outcome.scope, { cases: ["build-alpha"], captures: null });
  const repairDocument = readJson<RepairDocument>(join(run.root, "threads", threadId, "repair.json"));
  equal(repairDocument.clusters[0]!.earlier.length, 1);
  ok(run.lines.some((line) => line.startsWith(`Repair ${first}: attempt 1 rejected by repair at check: `)));
  ok(run.lines.includes(`Loop ${first}: fixed after 2 attempts; ${state.accepted?.commit}`));
  const last = run.lines.findIndex((line) => line.startsWith("Outcome: "));
  ok(last > run.lines.findIndex((line) => line.startsWith("Widening: ")));
  equal(run.lines[last], `Outcome: verified_for_scope; 1 of 1 clusters fixed, 2 attempts, model time 0.1 min, elapsed 120.0 min; ${join(run.root, "threads", threadId, "outcome.json")}`);
});

test("a cluster whose widening was rejected gets a next attempt, and both widenings are kept", async () => {
  const run = harness({
    repair: (call, attempt) => patchedReply({ "Chummer/frmCreate.cs": attempt === 1 ? "class frmCreate { int wide; }" : repairedSource })(call),
    script: { observe: (request, name, capture) => (request.label === `widen ${first} character` && name === "build-alpha" && capture === "armor" && request.candidateExecutable.includes("attempt-1") ? { passed: false, candidate: [1] } : undefined) },
  });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const prompt = run.agents.calls.filter((call) => call.kind === "repair")[1]!.prompt;
  for (const text of ["\"rejectedBy\": \"widening\"", "\"stage\": \"character\"", "build-alpha/armor introduced", "+class frmCreate { int wide; }"]) ok(prompt.includes(text), text);
  const folder = join(run.root, "threads", threadId, "widening", first);
  equal(readJson<{ status: string }>(join(folder, "attempt-1", "widening.json")).status, "rejected");
  equal(readJson<{ status: string }>(join(folder, "attempt-2", "widening.json")).status, "promoted");
  const document = readJson<WideningDocument>(join(run.root, "threads", threadId, "widening.json"));
  deepStrictEqual([document.earlier.map((item) => item.attempt), document.widenings.map((item) => item.attempt)], [[1], [2]]);
  deepStrictEqual([document.totals.attempts, document.totals.clusters, document.totals.promoted, document.totals.rejected], [2, 1, 1, 1]);
  ok(run.lines.includes(`Widening ${first}: attempt 1 rejected at character: build-alpha/armor introduced`));
  ok(run.lines.some((line) => line.startsWith(`Widening ${first}: attempt 2 PROMOTED as `)));
  equal(outcomeOf(run.root, threadId).outcome, "verified_for_scope");
});

test("a next attempt stops with a setup error when an earlier attempt's archive lost its patch", async () => {
  let removed = false;
  const run: ReturnType<typeof harness> = harness({
    script: {
      observe: (request, name, capture) => {
        if (request.label !== `widen ${first} character` || name !== "build-alpha" || capture !== "armor") return undefined;
        rmSync(join(run.root, "threads", run.threadId(), "repair", first, "attempt-1", "patch.diff"));
        removed = true;
        return { passed: false, candidate: [1] };
      },
    },
  });
  equal(await run.start(), 3);
  ok(removed);
  equal(run.agents.calls.filter((call) => call.kind === "repair").length, 1);
  ok(run.lines.some((line) => line.startsWith("Setup error: The archive of an earlier attempt lost its patch: ")));
});

test("a second attempt is widened on the source promoted in the first round", async () => {
  const run = harness({ spots: twoClusters, check: (cluster, attempt) => (cluster === second && attempt === 1 ? failsAt("career-beta/common") : {}) });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const builds = run.wideningHost.builds.filter((build) => build.label.endsWith(" build")).map((build) => build.label);
  deepStrictEqual(builds, [`widen ${first} build`, `widen ${second} build`]);
  // The second cluster's widened source holds the first cluster's promoted patch.
  equal(run.wideningHost.builtSources[1], repairedSource);
  equal(run.agents.calls.filter((call) => call.kind === "repair" && call.cluster === first).length, 1);
  const state = await run.state(threadId);
  deepStrictEqual(state.accepted?.promoted, [first, second]);
  const outcome = outcomeOf(run.root, threadId);
  deepStrictEqual(outcome.clusters.map((item) => [item.disposition, item.attempts]), [["fixed", 1], ["fixed", 2]]);
  equal(outcome.outcome, "verified_for_scope");
});

test("an execution failure, the attempt limit and the spent budget end a cluster's attempts", async () => {
  const lost = harness({ check: () => ({ status: 2 }) });
  equal(await lost.start(), 2);
  equal(lost.agents.calls.filter((call) => call.kind === "repair").length, 1);
  deepStrictEqual(outcomeOf(lost.root, lost.threadId()).clusters.map((item) => [item.disposition, item.attempts, item.stage]), [["repair_rejected", 1, "check"]]);
  equal(outcomeOf(lost.root, lost.threadId()).outcome, "findings_remaining");

  const limited = harness({ check: () => failsAt("build-alpha/skills") });
  equal(await limited.start(), 1);
  equal(limited.agents.calls.filter((call) => call.kind === "repair").length, 2);
  deepStrictEqual(outcomeOf(limited.root, limited.threadId()).clusters.map((item) => [item.disposition, item.attempts]), [["repair_rejected", 2]]);
  ok(limited.lines.some((line) => line.startsWith(`Loop ${first}: repair_rejected after 2 attempts; check: `)));
  ok(limited.lines.some((line) => line.startsWith("Outcome: findings_remaining; 0 of 1 clusters fixed, 2 attempts, ")));

  // Each fake job reports one second; a budget of three seconds is spent by the hypothesis, the challenge and the first attempt.
  const spent = harness({ check: () => failsAt("build-alpha/skills"), extra: { budgetMinutes: 3 / 60 } });
  equal(await spent.start(), 1);
  equal(spent.agents.calls.filter((call) => call.kind === "repair").length, 1);
  const outcome = outcomeOf(spent.root, spent.threadId());
  deepStrictEqual([outcome.outcome, outcome.clusters[0]!.disposition, outcome.clusters[0]!.stage], ["budget_exhausted", "budget_exhausted", "check"]);
});

test("a next attempt refused at the run budget keeps the rejection it followed", async () => {
  // Four diagnosis jobs and two first attempts use six seconds; 6.5 seconds let the first next attempt start, and the second is refused.
  const run = harness({
    spots: twoClusters, poolSize: 1, extra: { budgetMinutes: 6.5 / 60 },
    check: (cluster) => failsAt(cluster === first ? "build-alpha/skills" : "career-beta/common"),
  });
  equal(await run.start(), 1);
  equal(run.agents.calls.filter((call) => call.kind === "repair" && call.cluster === first).length, 2);
  equal(run.agents.calls.filter((call) => call.kind === "repair" && call.cluster === second).length, 1);
  const outcome = outcomeOf(run.root, run.threadId());
  deepStrictEqual(outcome.clusters.map((item) => [item.clusterId, item.disposition, item.attempts, item.stage]), [[first, "repair_rejected", 2, "check"], [second, "budget_exhausted", 1, "check"]]);
  ok(outcome.clusters[1]!.reason!.startsWith("the run budget was spent before a next attempt; "));
  equal(outcome.outcome, "budget_exhausted");
});

test("every run that triaged concludes, whichever stage ends it", async () => {
  const noDiagnosis = harness({ spots: twoClusters });
  equal(await noDiagnosis.start({ noDiagnosis: true }), 1);
  deepStrictEqual(outcomeOf(noDiagnosis.root, noDiagnosis.threadId()).clusters.map((item) => item.disposition), ["not_diagnosed", "not_diagnosed"]);

  const noRepair = harness();
  equal(await noRepair.start({ noRepair: true }), 1);
  deepStrictEqual(outcomeOf(noRepair.root, noRepair.threadId()).clusters.map((item) => item.disposition), ["not_repaired"]);

  const noWidening = harness();
  equal(await noWidening.start({ noWidening: true }), 1);
  deepStrictEqual(outcomeOf(noWidening.root, noWidening.threadId()).clusters.map((item) => item.disposition), ["not_widened"]);

  // Without widening, a rejected attempt still gets its next one.
  const retried = harness({ widening: false, check: (_cluster, attempt) => (attempt === 1 ? failsAt("build-alpha/skills") : {}) });
  equal(await retried.start(), 1);
  deepStrictEqual(outcomeOf(retried.root, retried.threadId()).clusters.map((item) => [item.disposition, item.attempts]), [["not_widened", 2]]);

  const onlyTriage = harness({ spots: twoClusters });
  equal(await onlyTriage.start({ only: "triage" }), 1);
  deepStrictEqual(outcomeOf(onlyTriage.root, onlyTriage.threadId()).clusters.map((item) => item.disposition), ["not_diagnosed", "not_diagnosed"]);

  const refuted = harness({ spots: twoClusters, extra: { observed: { "build-alpha/skills": "failed", "career-beta/common": "failed" } } });
  equal(await refuted.start(), 1);
  const outcome = outcomeOf(refuted.root, refuted.threadId());
  deepStrictEqual(outcome.clusters.map((item) => item.disposition), ["refuted", "refuted"]);
  equal(outcome.outcome, "findings_remaining");
  equal(outcome.problems.cases.length, 0);
});

test("a run killed during a next attempt resumes it without repeating the first", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const killed = harness({
    check: (_cluster, attempt) => (attempt === 1 ? failsAt("build-alpha/skills") : { hang: () => setTimeout(() => controller.abort(), 10) }),
    extra: { checkpointer, store, signal: controller.signal },
  });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const resumed = harness({ extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
  equal(await resumed.resume(threadId), 1);
  // Only the interrupted second attempt runs again, under a new record; no diagnosis job runs.
  deepStrictEqual(resumed.agents.calls.map((call) => call.kind), ["repair"]);
  const state = await resumed.state(threadId);
  deepStrictEqual([state.repairs[first]!.attempt?.attempt, state.repairs[first]!.earlier.map((item) => item.attempt)], [3, [1]]);
  equal(outcomeOf(resumed.root, threadId).clusters[0]!.disposition, "fixed");
});

test("a thread stored without the attempt limit and its start concludes with one attempt and no elapsed time", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const killed = harness({ check: () => ({ hang: () => setTimeout(() => controller.abort(), 10) }), extra: { checkpointer, store, signal: controller.signal } });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const config = { configurable: { thread_id: threadId } };
  const stored = await killed.state(threadId);
  // What a thread checkpointed before the loop existed holds: repair options without the limit, and no start.
  await killed.graph.updateState(config, { options: { ...stored.options, repair: { deadlineMinutes: 60 } }, startedUtc: null });
  const resumed = harness({ check: () => failsAt("build-alpha/skills"), extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
  equal(await resumed.resume(threadId), 1);
  equal(resumed.agents.calls.filter((call) => call.kind === "repair").length, 1);
  const outcome = outcomeOf(resumed.root, threadId);
  deepStrictEqual([outcome.clusters[0]!.disposition, outcome.clusters[0]!.attempts, outcome.measures.elapsedMilliseconds], ["repair_rejected", 1, null]);
  ok(resumed.lines.some((line) => line.startsWith("Outcome: findings_remaining; ") && line.includes("elapsed unknown")));
});