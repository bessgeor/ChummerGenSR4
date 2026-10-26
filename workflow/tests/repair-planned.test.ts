import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { processBranchGit } from "../src/git/branch-git.js";
import { Worktrees } from "../src/git/worktrees.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { EvalRecordSchema, putRecord, recordNamespace } from "../src/evals/eval-record.js";
import { FixRecordSchema } from "../src/fixes/fix-record.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import type { AttemptDocument } from "../src/repair/attempt-archive.js";
import type { ClusterRepair } from "../src/repair/cluster-repair.js";
import { blockerClosure, validatePlan, type PlanOutput, type Subtask } from "../src/repair/plan-schemas.js";
import { RepairService, type RepairInput } from "../src/repair/repair-service.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { record } from "./eval-fixtures.js";
import { FakeRepairHost, repairedSource } from "./repair-fixtures.js";

const cluster = "d-0000000000000100";

const task = (id: number, files: string[], blockedBy: number[] = []): Subtask => ({ id, title: `Subtask ${id}`, instructions: `Do part ${id}.`, files, blockedBy });
const plan = (tasks: Subtask[]): PlanOutput => ({ outcome: "planned", reason: "Three parts.", summary: "Restore the label and its helpers.", tasks });

test("a plan's subtasks are numbered in order, blocked only by lower ones, inside Chummer/ and Core/, and apart where they may run together", () => {
  deepStrictEqual(validatePlan(plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/b.cs"]), task(3, ["Chummer/a.cs", "Chummer/b.cs"], [1, 2])])), []);
  deepStrictEqual(validatePlan(plan([task(1, ["Core/XmlManager.cs"]), task(2, ["Chummer/b.cs"])])), []);
  deepStrictEqual(validatePlan(plan([task(2, ["Chummer/a.cs"])])), ["tasks[0] has id 2, not 1"]);
  deepStrictEqual(validatePlan(plan([task(1, ["Chummer/a.cs"], [2]), task(2, ["Chummer/b.cs"], [1])])), ["tasks[0] is blocked by 2, which is not a lower subtask"]);
  deepStrictEqual(validatePlan(plan([task(1, ["bin/data/skills.xml", "../x.cs", "Chummer/a.cs", "Chummer/a.cs"])])),
    ["tasks[0].files[0] 'bin/data/skills.xml' is outside Chummer/ and Core/", "tasks[0].files[1] '../x.cs' has an empty, . or .. part", "tasks[0].files[3] 'Chummer/a.cs' is named twice"]);
  deepStrictEqual(validatePlan(plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/a.cs"])])), ["subtasks 1 and 2 may run at the same time and both name Chummer/a.cs"]);
  // Through subtask 2, subtask 3 waits for 1, so they may share a file.
  deepStrictEqual(validatePlan(plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/b.cs"], [1]), task(3, ["Chummer/a.cs"], [2])])), []);
  equal(validatePlan(plan([task(1, Array.from({ length: 11 }, (_, index) => `Chummer/f${index}.cs`))]))[0], "the plan names 11 files, more than 10");
  deepStrictEqual(validatePlan(plan([1, 2, 3, 4, 5, 6].map((id) => task(id, [`Chummer/${id}.cs`])))), ["a plan has 1 to 5 subtasks, this one 6"]);
  deepStrictEqual(validatePlan({ outcome: "no_plan", reason: "No cause in the source.", summary: "none", tasks: [task(1, ["Chummer/a.cs"])] }), ["a no_plan answer lists subtasks"]);
  deepStrictEqual(validatePlan({ outcome: "planned", reason: " ", summary: "s", tasks: [{ ...task(1, []), title: "" }] }),
    ["reason is empty", "tasks[0] title is empty", "tasks[0] names no file"]);
  deepStrictEqual([...blockerClosure([task(1, []), task(2, [], [1]), task(3, [], [2])]).get(3)!].sort(), [1, 2]);
});

const isPlan = (call: JobCall) => call.prompt.startsWith("PROMPT_VERSION=repair-plan-v2");
const subtaskOf = (call: JobCall) => Number(/^YOUR SUBTASK: (\d+)$/m.exec(call.prompt)?.[1] ?? 0);

/** Edits the job's copy and answers `patched` with the given files (by default the edited ones). */
function edit(call: JobCall, edits: Readonly<Record<string, string>>, files: string[] = Object.keys(edits)): Reply {
  for (const [path, text] of Object.entries(edits)) {
    mkdirSync(dirname(join(call.workspace.folder, path)), { recursive: true });
    writeFileSync(join(call.workspace.folder, path), text);
  }
  return { answer: { outcome: "patched", reason: `Subtask ${subtaskOf(call)} done.`, summary: `Changed ${Object.keys(edits).join(", ")}.`, files } };
}

type Replies = { readonly plan: () => Reply; readonly subtask: (id: number, call: JobCall, attempt: number) => Reply };

/** The fixture repository's git and worktrees. */
function gitOf(repository: string) {
  const git = processBranchGit(repository);
  return { git, worktrees: new Worktrees(git, repository) };
}

/** A thread whose diagnosis confirmed one cluster, with fix changes, and a repair service over it with fake agents and a fake host. */
async function planned(replies: Replies, setup: { deadlineMinutes?: number; budgetMinutes?: number; durationMs?: number; pool?: number } = {}) {
  let current = replies;
  const agents = new FakeAgents((call, attempt) => {
    if (call.kind !== "repair") return { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() };
    return isPlan(call) ? current.plan() : current.subtask(subtaskOf(call), call, attempt);
  }, setup.pool ?? Number.POSITIVE_INFINITY, setup.durationMs ?? 1000);
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents });
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  const state = await harness.state(threadId);
  const host = new FakeRepairHost(harness.root);
  const lines: string[] = [];
  const service = new RepairService({
    threadFolder: (id) => join(harness.root, "threads", id), agents: () => agents, quota: new QuotaWaiter("process-1", async () => {}, () => {}),
    build: host.build, narrowCheck: host.narrowCheck, createScratchFolder, ...gitOf(harness.sourceRepository), now: () => new Date(), log: (line) => lines.push(line),
  });
  const repairs = service.prepare(threadId, state.clusters, state.diagnosisCheck);
  const input = (repair: ClusterRepair, spentMs = state.agentMilliseconds): RepairInput => ({
    threadId, options: { ...state.options, fixChanges: true, repair: { deadlineMinutes: setup.deadlineMinutes ?? 60 }, agents: { ...state.options.agents, runBudgetMinutes: setup.budgetMinutes ?? 120 } },
    repair, diagnosis: state.clusters[cluster]!, check: state.diagnosisCheck!, spentMs,
  });
  return {
    agents, host, service, lines, repairs, input, threadId, store: harness.store as BaseStore, root: harness.root, prefix: `${threadId}/${cluster}/repair`, repository: harness.sourceRepository,
    replace: (next: Replies) => {
      current = next;
    },
  };
}

const document = (folder: string) => JSON.parse(readFileSync(join(folder, "attempt.json"), "utf8")) as AttemptDocument;
const repairCalls = (agents: FakeAgents) => agents.calls.filter((call) => call.kind === "repair");

test("independent subtasks run together, a blocked one starts on their changes, and the joined patch is built, checked, archived and drafted", async () => {
  const seen: Record<number, string[]> = {};
  const setup = await planned({
    plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/b.cs"]), task(3, ["Chummer/frmCreate.cs"], [1, 2])]) }),
    subtask: (id, call) => {
      seen[id] = ["Chummer/a.cs", "Chummer/b.cs"].filter((path) => existsSync(join(call.workspace.folder, path)));
      return edit(call, id === 1 ? { "Chummer/a.cs": "a" } : id === 2 ? { "Chummer/b.cs": "b" } : { "Chummer/frmCreate.cs": repairedSource });
    },
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(step.update.status, "passed");
  const { prefix } = setup;
  deepStrictEqual(step.update.records, [`${prefix}/1`, `${prefix}/1/task-1`, `${prefix}/1/task-2`, `${prefix}/1/task-3`]);
  equal(step.chargedMs, 4000);
  deepStrictEqual(seen, { 1: [], 2: [], 3: ["Chummer/a.cs", "Chummer/b.cs"] });
  ok(setup.agents.peak >= 2, `peak ${setup.agents.peak}`);
  const calls = repairCalls(setup.agents);
  // The plan reads a copy; each subtask writes its own.
  equal(new Set(calls.map((call) => call.workspace.folder)).size, 4);
  ok(calls[0]!.prompt.includes("Your folders, both read only"));
  for (const call of calls) ok(!existsSync(call.workspace.folder), call.workspace.folder);
  deepStrictEqual(setup.host.builtSources, [repairedSource]);
  // Each subtask committed on its own branch; subtask 3 started at a commit holding the changes of 1 and 2, and the
  // attempt commit on the source commit holds all three.
  const { git } = gitOf(setup.repository);
  const branch = `workflow/${setup.threadId}/repair/${cluster}/attempt-1`;
  const source = git(["rev-parse", `workflow/${setup.threadId}/source`]).trim();
  const changed = (from: string, to: string) => git(["diff", "--name-only", from, to]).trim().split("\n").filter((path) => path.length > 0);
  for (const id of [1, 2]) equal(git(["rev-parse", `${branch}-task-${id}~1`]).trim(), source);
  deepStrictEqual(changed(source, `${branch}-task-1`), ["Chummer/a.cs"]);
  deepStrictEqual(changed(source, `${branch}-task-2`), ["Chummer/b.cs"]);
  equal(git(["rev-parse", `${branch}-task-3~2`]).trim(), source);
  deepStrictEqual(changed(source, `${branch}-task-3~1`), ["Chummer/a.cs", "Chummer/b.cs"]);
  deepStrictEqual(changed(`${branch}-task-3~1`, `${branch}-task-3`), ["Chummer/frmCreate.cs"]);
  equal(git(["rev-parse", `${branch}~1`]).trim(), source);
  deepStrictEqual(changed(source, branch), ["Chummer/a.cs", "Chummer/b.cs", "Chummer/frmCreate.cs"]);
  deepStrictEqual([step.update.attempt!.branch, step.update.attempt!.commit], [branch, git(["rev-parse", branch]).trim()]);
  const attempt = document(step.update.attempt!.folder);
  deepStrictEqual(attempt.patch!.files.map((file) => [file.path, file.change]), [["Chummer/a.cs", "added"], ["Chummer/b.cs", "added"], ["Chummer/frmCreate.cs", "modified"]]);
  deepStrictEqual(attempt.answer, { outcome: "patched", reason: "Three parts.", summary: "Restore the label and its helpers.", files: ["Chummer/a.cs", "Chummer/b.cs", "Chummer/frmCreate.cs"] });
  deepStrictEqual(attempt.planned!.subtasks.map((item) => [item.id, item.recordId, item.files]),
    [[1, `${prefix}/1/task-1`, ["Chummer/a.cs"]], [2, `${prefix}/1/task-2`, ["Chummer/b.cs"]], [3, `${prefix}/1/task-3`, ["Chummer/frmCreate.cs"]]]);
  equal(attempt.planned!.plan.output!.tasks.length, 3);
  const draft = FixRecordSchema.parse(JSON.parse(readFileSync(join(step.update.attempt!.folder, "fix", "fix.json"), "utf8")));
  deepStrictEqual([draft.name, draft.widening, draft.check.outcome, draft.plan.recordId], [`fix-${cluster}-${setup.threadId.slice(-8)}`, null, "confirmed", `${prefix}/1`]);
  deepStrictEqual(draft.tasks.map((item) => [item.id, item.blockedBy, item.files]), [[1, [], ["Chummer/a.cs"]], [2, [], ["Chummer/b.cs"]], [3, [1, 2], ["Chummer/frmCreate.cs"]]]);
  ok(!draft.narrowCheck.run.includes("\\") && !draft.narrowCheck.run.includes("/"));
  ok(readFileSync(join(step.update.attempt!.folder, "fix", "tasks.md"), "utf8").includes("- [x] 1.3 \"Subtask 3\". Files: `Chummer/frmCreate.cs`. Blocked by: 1.1, 1.2."));
  ok(existsSync(join(step.update.attempt!.folder, "fix", "proposal.md")));
  for (const [id, version] of [[`${prefix}/1`, "repair-plan-v2"], [`${prefix}/1/task-2`, "repair-task-v2"]] as const) {
    const stored = EvalRecordSchema.parse((await setup.store.get(recordNamespace("repair"), id))!.value);
    deepStrictEqual([stored.promptVersion, stored.labels.repair?.outcome], [version, "passed"]);
  }
});

test("a subtask that changed a file of another it does not wait for rejects the attempt at stage patch before a build", async () => {
  const setup = await planned({
    plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/b.cs"])]) }),
    subtask: (id, call) => edit(call, id === 1 ? { "Chummer/a.cs": "a" } : { "Chummer/b.cs": "b", "Chummer/a.cs": "other a" }),
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual([step.update.status, step.update.attempt!.stage, step.update.attempt!.reason],
    ["rejected", "patch", "subtasks 1 and 2 both changed Chummer/a.cs, and 1 does not block 2"]);
  equal(setup.host.builds.length, 0);
  ok(!existsSync(join(step.update.attempt!.folder, "fix")));
});

test("a subtask whose changes differ from its answer, that declines or that fails ends the attempt, and no later wave starts", async () => {
  const unlisted = await planned({
    plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/frmCreate.cs"], [1])]) }),
    subtask: (_id, call) => edit(call, { "Chummer/a.cs": "a", "Chummer/c.cs": "c" }, ["Chummer/a.cs"]),
  });
  const first = await unlisted.service.repair(unlisted.input(unlisted.repairs[cluster]!), unlisted.store);
  deepStrictEqual([first.update.attempt!.stage, first.update.attempt!.reason], ["patch", "subtask 1: changed but not listed: Chummer/c.cs"]);
  equal(repairCalls(unlisted.agents).length, 2);

  unlisted.replace({
    plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/frmCreate.cs"], [1])]) }),
    subtask: () => ({ answer: { outcome: "no_patch", reason: "The label has no location to change.", summary: "none", files: [] } }),
  });
  const second = await unlisted.service.repair(unlisted.input({ ...unlisted.repairs[cluster]!, records: first.update.records! }), unlisted.store);
  deepStrictEqual([second.update.status, second.update.attempt!.attempt, second.update.attempt!.stage, second.update.attempt!.reason],
    ["rejected", 2, "model", "subtask 1: no_patch: The label has no location to change."]);
  equal(repairCalls(unlisted.agents).length, 4);

  unlisted.replace({ plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"])]) }), subtask: () => ({ answer: { outcome: "patched", reason: "", summary: "s", files: [] } }) });
  const third = await unlisted.service.repair(unlisted.input({ ...unlisted.repairs[cluster]!, records: second.update.records! }), unlisted.store);
  equal(third.update.status, "failed");
  equal(third.update.attempt!.stage, "model");
  ok(third.update.attempt!.reason!.startsWith("invalid_output: subtask 1:"), third.update.attempt!.reason!);
  equal(third.update.attempt!.attempt, 3);
});

test("a plan that declines or breaks the rules rejects the attempt at stage model without a subtask", async () => {
  const setup = await planned({ plan: () => ({ answer: { outcome: "no_plan", reason: "The source has no such label.", summary: "none", tasks: [] } }), subtask: () => ({ hang: true }) });
  const declined = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual([declined.update.status, declined.update.attempt!.stage, declined.update.attempt!.reason], ["rejected", "model", "no_plan: The source has no such label."]);
  setup.replace({ plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"], [1])]) }), subtask: () => ({ hang: true }) });
  const invalid = await setup.service.repair(setup.input({ ...setup.repairs[cluster]!, records: declined.update.records! }), setup.store);
  equal(invalid.update.status, "failed");
  ok(invalid.update.attempt!.reason!.includes("is blocked by 1, which is not a lower subtask"), invalid.update.attempt!.reason!);
  equal(repairCalls(setup.agents).length, 2);
});

test("a usage limit in a subtask parks the attempt with its records; the next one is numbered after it", async () => {
  let subtasks = 0;
  const setup = await planned({
    plan: () => ({ answer: plan([task(1, ["Chummer/frmCreate.cs"])]) }),
    subtask: (_id, call) => (++subtasks === 1 ? { failure: { kind: "quota_exhausted", message: "5-hour limit" } } : edit(call, { "Chummer/frmCreate.cs": repairedSource })),
  });
  const parked = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(parked.update.waiting?.message, "5-hour limit");
  deepStrictEqual(parked.update.records, [`${setup.prefix}/1`, `${setup.prefix}/1/task-1`]);
  // The plan's time is charged to the thread; the subtask that hit the limit is not.
  equal(parked.chargedMs, 1000);
  const again = await setup.service.repair(setup.input({ ...setup.repairs[cluster]!, records: parked.update.records!, waiting: null }), setup.store);
  equal(again.update.status, "passed");
  equal(again.update.attempt!.attempt, 2);
  deepStrictEqual(again.update.records!.slice(2), [`${setup.prefix}/2`, `${setup.prefix}/2/task-1`]);
});

test("a subtask the spent budget does not let start leaves the cluster out of budget, with the jobs so far archived and labelled", async () => {
  const setup = await planned({ plan: () => ({ answer: plan([task(1, ["Chummer/frmCreate.cs"])]) }), subtask: (_id, call) => edit(call, { "Chummer/frmCreate.cs": repairedSource }) },
    { budgetMinutes: 1, durationMs: 60_000 });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!, 0), setup.store);
  deepStrictEqual([step.update.status, step.update.records], ["budget_exhausted", [`${setup.prefix}/1`]]);
  equal(repairCalls(setup.agents).length, 1);
  equal(step.chargedMs, 60_000);
  const attempt = document(step.update.attempt!.folder);
  deepStrictEqual([attempt.outcome, attempt.stage, attempt.patch?.files.length], ["rejected", "model", 0]);
  ok(attempt.reason!.includes("run budget of 1 min was spent after 1 of the attempt's jobs finished"), attempt.reason!);
  equal(attempt.planned!.plan.output!.tasks.length, 1);
  deepStrictEqual(attempt.planned!.subtasks, []);
  const stored = EvalRecordSchema.parse((await setup.store.get(recordNamespace("repair"), `${setup.prefix}/1`))!.value);
  deepStrictEqual([stored.labels.repair?.outcome, stored.labels.repair?.stage], ["rejected", "model"]);
  equal(setup.host.builds.length, 0);
});

test("a failed subtask is the attempt's end even when the spent budget kept another of its wave from starting", async () => {
  const setup = await planned({
    plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/b.cs"])]) }),
    subtask: (id, call) => (id === 1 ? { failure: { kind: "invalid_output", message: "no JSON" } } : edit(call, { "Chummer/b.cs": "b" })),
  }, { budgetMinutes: 2, durationMs: 60_000, pool: 1 });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!, 0), setup.store);
  deepStrictEqual([step.update.status, step.update.attempt!.stage], ["failed", "model"]);
  ok(step.update.attempt!.reason!.startsWith("invalid_output: subtask 1:"), step.update.attempt!.reason!);
  deepStrictEqual(step.update.records, [`${setup.prefix}/1`, `${setup.prefix}/1/task-1`]);
  equal(repairCalls(setup.agents).length, 2);
});

test("an interrupted planned attempt's stored plan and subtask records are listed, and the next attempt is numbered after it", async () => {
  const setup = await planned({ plan: () => ({ answer: plan([task(1, ["Chummer/frmCreate.cs"])]) }), subtask: (_id, call) => edit(call, { "Chummer/frmCreate.cs": repairedSource }) });
  for (const recordId of [`${setup.prefix}/1`, `${setup.prefix}/1/task-1`, `${setup.prefix}/1/task-2`]) await putRecord(setup.store, record({ recordId, jobKind: "repair" }));
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(step.update.attempt!.attempt, 2);
  deepStrictEqual(step.update.records, [`${setup.prefix}/1`, `${setup.prefix}/1/task-1`, `${setup.prefix}/1/task-2`, `${setup.prefix}/2`, `${setup.prefix}/2/task-1`]);
});

test("the joined answer lists what the joined source changes, and a later subtask is told of every change it starts on", async () => {
  const setup = await planned({
    plan: () => ({ answer: plan([task(1, ["Chummer/a.cs"]), task(2, ["Chummer/a.cs", "Chummer/b.cs"], [1]), task(3, ["Chummer/frmCreate.cs"], [2])]) }),
    subtask: (id, call) => {
      if (id === 1) return edit(call, { "Chummer/a.cs": "a" });
      if (id === 2) {
        // Sets what subtask 1 added back to the snapshot's state: no file at all.
        rmSync(join(call.workspace.folder, "Chummer/a.cs"));
        return edit(call, { "Chummer/b.cs": "b" }, ["Chummer/a.cs", "Chummer/b.cs"]);
      }
      return edit(call, { "Chummer/frmCreate.cs": repairedSource });
    },
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(step.update.status, "passed", step.update.attempt!.reason ?? "");
  deepStrictEqual(document(step.update.attempt!.folder).answer!.files, ["Chummer/b.cs", "Chummer/frmCreate.cs"]);
  const third = repairCalls(setup.agents).find((call) => subtaskOf(call) === 3)!;
  ok(third.prompt.includes("already holds the changes of subtask 1, 2"), "subtask 3's prompt");
});

test("a deadline that passed after the plan rejects the attempt at stage deadline before a subtask starts", async () => {
  const setup = await planned({ plan: () => ({ answer: plan([task(1, ["Chummer/frmCreate.cs"])]) }), subtask: () => ({ hang: true }) }, { deadlineMinutes: 0.0001 });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual([step.update.status, step.update.attempt!.stage, step.update.attempt!.reason], ["rejected", "deadline", "the deadline passed before subtask 1 could start"]);
  equal(repairCalls(setup.agents).length, 1);
});
