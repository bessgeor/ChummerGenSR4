import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { EvalRecordSchema, noLabels, putRecord, recordNamespace } from "../src/evals/eval-record.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import type { RunOptions } from "../src/options/run-options.js";
import type { AttemptDocument } from "../src/repair/attempt-archive.js";
import type { ClusterRepair } from "../src/repair/cluster-repair.js";
import { RepairService, type RepairInput } from "../src/repair/repair-service.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource, type BuildBehaviour, type CheckBehaviour } from "./repair-fixtures.js";
import { record } from "./eval-fixtures.js";

const cluster = "d-0000000000000100";

type Setup = {
  readonly reply?: (call: JobCall, attempt: number) => Reply;
  readonly build?: BuildBehaviour;
  readonly check?: CheckBehaviour;
  readonly deadlineMinutes?: number;
};

/** A thread whose diagnosis confirmed one cluster, and a repair service over it with fake agents and a fake host. */
async function diagnosed(setup: Setup = {}) {
  let repairReply = setup.reply ?? patchedReply({ "Chummer/frmCreate.cs": repairedSource });
  const agents = new FakeAgents((call, attempt) => (call.kind === "repair" ? repairReply(call, attempt)
    : { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() }));
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents });
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  const state = await harness.state(threadId);
  equal(state.diagnosisCheck?.clusters[cluster]?.outcome, "confirmed");
  const host = new FakeRepairHost(harness.root, setup.build ?? 0, setup.check ?? {});
  const lines: string[] = [];
  const sleeps: number[] = [];
  const threadFolder = (id: string) => join(harness.root, "threads", id);
  const service = new RepairService({
    threadFolder, agents: () => agents, quota: new QuotaWaiter("process-1", async (milliseconds) => {
      sleeps.push(milliseconds);
    }), build: host.build, narrowCheck: host.narrowCheck,
    createScratchFolder, now: () => new Date(), log: (line) => lines.push(line),
  });
  const repairs = service.prepare(state.clusters, state.diagnosisCheck);
  const input = (repair: ClusterRepair, overrides: Partial<RepairInput> = {}): RepairInput => ({
    threadId, options: { ...state.options, repair: { deadlineMinutes: setup.deadlineMinutes ?? 60 } }, repair, diagnosis: state.clusters[cluster]!,
    check: state.diagnosisCheck!, spentMs: state.agentMilliseconds, ...overrides,
  });
  return {
    harness, agents, host, service, lines, sleeps, repairs, input, threadId, store: harness.store as BaseStore, folder: threadFolder(threadId),
    setReply: (reply: (call: JobCall, attempt: number) => Reply) => {
      repairReply = reply;
    },
  };
}

function documentOf(folder: string): AttemptDocument {
  return JSON.parse(readFileSync(join(folder, "attempt.json"), "utf8")) as AttemptDocument;
}

test("prepare starts a repair for each confirmed cluster only", async () => {
  const { service, repairs, harness, threadId } = await diagnosed();
  deepStrictEqual(Object.keys(repairs), [cluster]);
  deepStrictEqual(repairs[cluster], { clusterId: cluster, status: "pending", attempt: null, earlier: [], waiting: null, records: [] });
  const state = await harness.state(threadId);
  const refuted = { ...state.diagnosisCheck!, clusters: { [cluster]: { ...state.diagnosisCheck!.clusters[cluster]!, outcome: "refuted" as const } } };
  deepStrictEqual(service.prepare(state.clusters, refuted), {});
  deepStrictEqual(service.prepare(state.clusters, null), {});
});

test("a passed attempt edits only its own copy, is built and checked narrowly, archived, and its record labelled", async () => {
  const setup = await diagnosed();
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  const recordId = `${setup.threadId}/${cluster}/repair/1`;
  equal(step.update.status, "passed");
  deepStrictEqual(step.update.records, [recordId]);
  equal(step.chargedMs, 1000);
  const attempt = step.update.attempt!;
  deepStrictEqual([attempt.attempt, attempt.recordId, attempt.outcome, attempt.stage, attempt.reason], [1, recordId, "passed", null, null]);
  equal(attempt.folder, join(setup.folder, "repair", cluster, "attempt-1"));
  deepStrictEqual([attempt.check?.status, attempt.check?.coverageValid, attempt.check?.passed, attempt.check?.failed], [0, true, 1, 0]);
  // The job: a writable copy of the snapshot outside the thread's folder, the context copy beside it, read-only.
  const call = setup.agents.calls.find((item) => item.kind === "repair")!;
  ok(!call.workspace.folder.startsWith(setup.harness.root), call.workspace.folder);
  deepStrictEqual([...call.workspace.snapshotFiles].sort(), ["context.json", "evidence"]);
  ok(call.workspace.contextFiles.includes("Chummer") && !call.workspace.contextFiles.includes(".git"));
  ok(call.prompt.includes(call.workspace.folder) && call.prompt.includes(hypothesisAnswer().explanation!.claim));
  equal(call.images.length, 2);
  // The snapshot is untouched; the build saw the edit, in the attempt's own folders.
  ok(readFileSync(join(setup.folder, "diagnosis", "source", "Chummer", "frmCreate.cs"), "utf8").includes("moved"));
  deepStrictEqual(setup.host.builtSources, [repairedSource]);
  const build = setup.host.builds[0]!;
  equal(build.source, call.workspace.folder);
  ok(!build.output.startsWith(setup.harness.root));
  const check = setup.host.checks[0]!;
  deepStrictEqual([check.cases, check.captures], [["build-alpha"], ["skills"]]);
  equal(check.candidateExecutable, join(build.output, "bin", "ChummerGenSR4.exe"));
  // The workspace is gone; the archive has the answer, the patch, both sides and the build log.
  ok(!existsSync(call.workspace.folder));
  const document = documentOf(attempt.folder);
  deepStrictEqual([document.outcome, document.recordId, document.hypothesisRecord, document.answer?.files], ["passed", recordId, `${setup.threadId}/${cluster}/hypothesis/1`, ["Chummer/frmCreate.cs"]]);
  deepStrictEqual(document.patch?.files.map((file) => [file.path, file.change, file.added, file.removed]), [["Chummer/frmCreate.cs", "modified", 1, 1]]);
  deepStrictEqual(document.check?.rows.map((row) => [row.case, row.capture, row.passed]), [["build-alpha", "skills", true]]);
  ok(readFileSync(join(attempt.folder, "patch.diff"), "utf8").startsWith("diff --git a/Chummer/frmCreate.cs b/Chummer/frmCreate.cs"));
  equal(readFileSync(join(attempt.folder, "files", "after", "Chummer", "frmCreate.cs"), "utf8"), repairedSource);
  ok(readFileSync(join(attempt.folder, "files", "before", "Chummer", "frmCreate.cs"), "utf8").includes("moved"));
  ok(existsSync(join(attempt.folder, "build.log")));
  const stored = EvalRecordSchema.parse((await setup.store.get(recordNamespace("repair"), recordId))!.value);
  deepStrictEqual([stored.jobKind, stored.origin, stored.subject, stored.promptVersion, stored.result.status], ["repair", "workflow", { kind: "discrepancy-cluster", id: cluster }, "repair-v2", "succeeded"]);
  deepStrictEqual({ ...stored.labels, repair: { ...stored.labels.repair!, labelledUtc: "t" } }, { ...noLabels, repair: { outcome: "passed", stage: null, reason: null, labelledUtc: "t" } });
});

test("each stage rejects an attempt with its reason, and the steps after it do not run", async () => {
  const cases: { setup: Setup; stage: string; reason: RegExp; builds: number; checks: number; status: string }[] = [
    { setup: { reply: () => ({ answer: { outcome: "no_patch", reason: "Nothing in the source explains it.", summary: "none", files: [] } }) }, stage: "model", reason: /no_patch: Nothing in the source/, builds: 0, checks: 0, status: "rejected" },
    { setup: { reply: patchedReply({ "bin/data/skills.xml": "<skills changed/>" }) }, stage: "patch", reason: /bin\/data\/skills\.xml is outside Chummer\//, builds: 0, checks: 0, status: "rejected" },
    { setup: { reply: patchedReply({ "Chummer/frmCreate.cs": repairedSource, "Chummer/untracked.cs": "x" }, { files: ["Chummer/frmCreate.cs"] }) }, stage: "patch", reason: /changed but not listed in the answer: Chummer\/untracked\.cs/, builds: 0, checks: 0, status: "rejected" },
    { setup: { build: 1 }, stage: "build", reason: /does not build/, builds: 1, checks: 0, status: "rejected" },
    { setup: { check: { observed: { "build-alpha/skills": "failed" } } }, stage: "check", reason: /still differs: build-alpha\/skills visual-difference \(0\.01\)/, builds: 1, checks: 1, status: "rejected" },
    { setup: { check: { status: 2 } }, stage: "check", reason: /execution failure: capture status 2, coverage invalid/, builds: 1, checks: 1, status: "rejected" },
    { setup: { reply: patchedReply({ "Chummer/frmCreate.cs": repairedSource }, { files: [] }) }, stage: "model", reason: /invalid_output/, builds: 0, checks: 0, status: "failed" },
    { setup: { reply: () => ({ failure: { kind: "refused", message: "no" } }) }, stage: "model", reason: /refused: no/, builds: 0, checks: 0, status: "failed" },
    { setup: { reply: () => ({ failure: { kind: "timeout", message: "ran longer than 60 minutes" } }) }, stage: "deadline", reason: /timeout: ran longer/, builds: 0, checks: 0, status: "rejected" },
  ];
  for (const item of cases) {
    const setup = await diagnosed(item.setup);
    const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
    const attempt = step.update.attempt!;
    equal(step.update.status, item.status, String(item.reason));
    deepStrictEqual([attempt.outcome, attempt.stage], ["rejected", item.stage], String(item.reason));
    ok(item.reason.test(attempt.reason ?? ""), `${item.reason}: ${attempt.reason}`);
    deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [item.builds, item.checks], String(item.reason));
    const document = documentOf(attempt.folder);
    deepStrictEqual([document.outcome, document.stage, document.reason], ["rejected", attempt.stage, attempt.reason]);
    equal(existsSync(join(attempt.folder, "build.log")), item.builds > 0);
    const stored = EvalRecordSchema.parse((await setup.store.get(recordNamespace("repair"), attempt.recordId))!.value);
    deepStrictEqual([stored.labels.repair?.outcome, stored.labels.repair?.stage], ["rejected", item.stage]);
    if (item.stage === "check") equal(attempt.check?.status, item.setup.check?.status ?? 1);
  }
});

test("a build still running at the deadline is stopped and rejects the attempt; a stopped run stays a setup error", async () => {
  const setup = await diagnosed({ build: "hang", deadlineMinutes: 0.003 });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual([step.update.status, step.update.attempt?.stage], ["rejected", "deadline"]);
  ok(/still running at the deadline/.test(step.update.attempt!.reason!));
  equal(setup.host.checks.length, 0);
  // The model job's time limit is the deadline when that is shorter.
  const again = await diagnosed({ build: "hang" });
  const controller = new AbortController();
  const running = again.service.repair(again.input(again.repairs[cluster]!, { signal: controller.signal }), again.store);
  setTimeout(() => controller.abort(), 100);
  await rejects(running, /stopped/);
});

test("the model job's time limit is the smaller of its own and the deadline", async () => {
  let limit = 0;
  const setup = await diagnosed({ deadlineMinutes: 5 });
  const agents = setup.agents;
  const run = agents.run.bind(agents);
  agents.run = async (job) => {
    // The limit is set when the job gets its place, so it is read once the job has run.
    const result = await run(job);
    if (job.kind === "repair") limit = job.choice.timeoutMinutes;
    return result;
  };
  await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(limit, 5);
});

test("a build or check that fails with a setup error ends the run; the record stays without a label and nothing is archived", async () => {
  for (const setup of [await diagnosed({ build: 3 }), await diagnosed({ check: { status: 3 } })]) {
    await rejects(setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store), (error: Error) => /exited with 3/.test(error.message));
    const stored = EvalRecordSchema.parse((await setup.store.get(recordNamespace("repair"), `${setup.threadId}/${cluster}/repair/1`))!.value);
    equal(stored.labels.repair, null);
    ok(!existsSync(join(setup.folder, "repair", cluster, "attempt-1")));
  }
  const infra = await diagnosed({ reply: () => ({ failure: { kind: "infra", message: "spawn claude ENOENT" } }) });
  await rejects(infra.service.repair(infra.input(infra.repairs[cluster]!), infra.store), SetupError);
});

test("a usage limit marks the attempt as waiting without an archive; the next attempt takes the next record", async () => {
  const setup = await diagnosed({ reply: () => ({ failure: { kind: "quota_exhausted", message: "You've hit your usage limit." } }) });
  const first = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(first.update.waiting?.job, "repair");
  equal(first.update.status, undefined);
  equal(first.chargedMs, 0);
  ok(!existsSync(join(setup.folder, "repair", cluster)) || !existsSync(join(setup.folder, "repair", cluster, "attempt-1")));
  setup.setReply(patchedReply({ "Chummer/frmCreate.cs": repairedSource }));
  const waiting: ClusterRepair = { ...setup.repairs[cluster]!, records: first.update.records! };
  const second = await setup.service.repair(setup.input(waiting), setup.store);
  equal(second.update.status, "passed");
  deepStrictEqual(second.update.records, [`${setup.threadId}/${cluster}/repair/1`, `${setup.threadId}/${cluster}/repair/2`]);
  equal(second.update.attempt?.folder, join(setup.folder, "repair", cluster, "attempt-2"));
});

test("an interrupted attempt's stored record is listed and the next attempt gets the next number", async () => {
  const setup = await diagnosed();
  await putRecord(setup.store, record({ recordId: `${setup.threadId}/${cluster}/repair/1`, jobKind: "repair" }));
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual(step.update.records, [`${setup.threadId}/${cluster}/repair/1`, `${setup.threadId}/${cluster}/repair/2`]);
  equal(step.update.attempt?.attempt, 2);
});

test("an existing archive of the same attempt is a setup error", async () => {
  const setup = await diagnosed();
  mkdirSync(join(setup.folder, "repair", cluster, "attempt-1"), { recursive: true });
  await rejects(setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store), (error: Error) => error instanceof SetupError && /exists already/.test(error.message));
});

test("a spent run budget starts no repair job", async () => {
  const setup = await diagnosed();
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!, { spentMs: 120 * 60_000 }), setup.store);
  deepStrictEqual(step, { update: { clusterId: cluster, status: "budget_exhausted" }, chargedMs: 0 });
  equal(setup.agents.calls.filter((call) => call.kind === "repair").length, 0);
});

test("a job that changes its context copy or adds to the scratch folder ends the run as infra, before any build", async () => {
  const tamper: { name: string; touch: (context: string, scratch: string) => void; reason: RegExp }[] = [
    { name: "context.json", touch: (context) => writeFileSync(join(context, "context.json"), "{}"), reason: /context copy's files changed/ },
    { name: "evidence image", touch: (context) => writeFileSync(join(context, "evidence", "1-candidate.png"), "not the crop"), reason: /context copy's files changed/ },
    { name: "new context file", touch: (context) => writeFileSync(join(context, "note.txt"), "x"), reason: /context copy gained note\.txt/ },
    { name: "removed context file", touch: (context) => rmSync(join(context, "context.json")), reason: /context copy lost context\.json/ },
    { name: "scratch folder", touch: (_, scratch) => writeFileSync(join(scratch, "stash.cs"), "x"), reason: /scratch folder holds stash\.cs/ },
  ];
  for (const item of tamper) {
    const edit = patchedReply({ "Chummer/frmCreate.cs": repairedSource });
    const setup = await diagnosed({
      reply: (call) => {
        item.touch(call.workspace.readOnly[0]!, dirname(call.workspace.folder));
        return edit(call);
      },
    });
    await rejects(setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store),
      (error: Error) => error instanceof SetupError && /outside its source copy/.test(error.message) && item.reason.test(error.message), item.name);
    const stored = EvalRecordSchema.parse((await setup.store.get(recordNamespace("repair"), `${setup.threadId}/${cluster}/repair/1`))!.value);
    deepStrictEqual([stored.result.status, stored.labels.repair], ["infra", null], item.name);
    deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [0, 0], item.name);
    ok(!existsSync(join(setup.folder, "repair", cluster, "attempt-1")), item.name);
  }
});
test("a thread without repair settings is refused", async () => {
  const setup = await diagnosed();
  const input = setup.input(setup.repairs[cluster]!);
  await rejects(setup.service.repair({ ...input, options: { ...input.options, repair: null } }, setup.store), /without repair settings/);
  const { repair: _removed, ...stale } = input.options;
  await rejects(setup.service.repair({ ...input, options: stale as RunOptions }, setup.store), /without repair settings/);
});
