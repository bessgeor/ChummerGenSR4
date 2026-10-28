import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { EvalRecordSchema, putRecord, recordNamespace } from "../src/evals/eval-record.js";
import { processBranchGit } from "../src/git/branch-git.js";
import { Worktrees } from "../src/git/worktrees.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import { nextAttempts } from "../src/loop/retry.js";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { AttemptDocument, TryDocument } from "../src/repair/attempt-archive.js";
import { mergeRepairs, type CheckExecution, type ClusterRepair } from "../src/repair/cluster-repair.js";
import { repairStatus } from "../src/repair/repair-report.js";
import { RepairService, selectBest, tryPlan, type RepairInput } from "../src/repair/repair-service.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { record } from "./eval-fixtures.js";
import { FakeRepairHost, patchedReply } from "./repair-fixtures.js";

const cluster = "d-0000000000000100";
const secondClaim = "The Skills tab label font changed in frmCreate.";

/** The try a job's or a build's worktree belongs to, from its branch `…/attempt-<n>-try-<k>`; 0 for an attempt of one try. */
function tryOf(folder: string): number {
  const branch = execFileSync("git", ["-C", folder, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  return Number(/-try-(\d+)$/.exec(branch)?.[1] ?? 0);
}

/** A source file of `lines` lines, which changes `lines` + 1 lines of the fixture's one-line `Chummer/frmCreate.cs`. */
function lines(count: number, tag: string): string {
  return Array.from({ length: count }, (_, index) => `// ${tag} ${index + 1}`).join("\n");
}

type Setup = {
  /** The repair answer of each try. */
  readonly reply: (call: JobCall, tryNumber: number) => Reply;
  /** Absent like in a thread stored before attempts had tries. */
  readonly tries: number | undefined;
  /** Both hypotheses confirmed when 2. */
  readonly hypotheses?: number;
  /** The build's exit status and the narrow check's failing captures, per try. */
  readonly build?: (tryNumber: number) => number;
  readonly failing?: (tryNumber: number) => readonly string[];
  readonly poolSize?: number;
  readonly durationMs?: number;
  readonly deadlineMinutes?: number;
  /** The service's clock. */
  readonly now?: () => Date;
};

/** A thread whose diagnosis confirmed the cluster (with one or two hypotheses), and a repair service with fake agents and a fake host. */
async function diagnosed(setup: Setup) {
  const agents = new FakeAgents((call) => (call.kind === "repair" ? setup.reply(call, tryOf(call.workspace.folder))
    : { answer: call.kind === "hypothesis" ? hypothesisAnswer(call.variant === 2 ? secondClaim : undefined) : challengeAnswer() }), setup.poolSize, setup.durationMs);
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents, ...(setup.hypotheses === undefined ? {} : { hypotheses: setup.hypotheses }) });
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  const state = await harness.state(threadId);
  equal(state.diagnosisCheck?.clusters[cluster]?.outcome, "confirmed");
  const host = new FakeRepairHost(harness.root);
  // Which try each build output belongs to, so the narrow check of a try is told apart.
  const outputs = new Map<string, number>();
  const logged: string[] = [];
  const scratches: string[] = [];
  const threadFolder = (id: string) => join(harness.root, "threads", id);
  const git = processBranchGit(harness.sourceRepository);
  const service = new RepairService({
    threadFolder, agents: () => agents, quota: new QuotaWaiter("process-1", async () => {}),
    build: async (request) => {
      const number = tryOf(request.source);
      outputs.set(request.output, number);
      host.buildBehaviour = setup.build?.(number) ?? 0;
      return host.build(request);
    },
    narrowCheck: async (request) => {
      const number = [...outputs].find(([output]) => request.candidateExecutable.startsWith(output))![1];
      host.checkBehaviour = { observed: Object.fromEntries((setup.failing?.(number) ?? []).map((capture) => [capture, "failed" as const])) };
      return host.narrowCheck(request);
    },
    createScratchFolder: (prefix: string) => {
      const folder = createScratchFolder(prefix);
      scratches.push(folder.path);
      return folder;
    },
    git, worktrees: new Worktrees(git, harness.sourceRepository), now: setup.now ?? (() => new Date()), log: (line) => logged.push(line),
  });
  const repairs = service.prepare(threadId, state.clusters, state.diagnosisCheck);
  const input = (repair: ClusterRepair, overrides: Partial<RepairInput> = {}): RepairInput => ({
    threadId, options: { ...state.options, repair: { deadlineMinutes: setup.deadlineMinutes ?? 60, ...(setup.tries === undefined ? {} : { tries: setup.tries }) } }, repair, diagnosis: state.clusters[repair.clusterId]!,
    check: state.diagnosisCheck!, spentMs: state.agentMilliseconds, ...overrides,
  });
  return { harness, agents, host, service, lines: logged, scratches, repairs, input, threadId, git, store: harness.store as BaseStore, folder: threadFolder(threadId) };
}

function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function repairLabel(store: BaseStore, recordId: string) {
  return EvalRecordSchema.parse((await store.get(recordNamespace("repair"), recordId))!.value).labels.repair;
}

test("two passed tries of different sizes: the smaller is selected, and the archive holds both in try-<k>/", async () => {
  // One try per confirmed hypothesis: the first changes 12 lines, the second 5.
  const setup = await diagnosed({
    hypotheses: 2, tries: 1,
    reply: (call, number) => patchedReply({ "Chummer/frmCreate.cs": number === 1 ? lines(11, "first") : lines(4, "second") })(call),
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  const attemptRecord = `${setup.threadId}/${cluster}/repair/1`;
  equal(step.update.status, "passed");
  deepStrictEqual(step.update.records, [`${attemptRecord}/try-1`, `${attemptRecord}/try-2`]);
  equal(step.chargedMs, 2000);
  // Side by side, each in its own worktree on its own branch, each told its own hypothesis.
  ok(setup.agents.peak >= 2, `peak ${setup.agents.peak}`);
  const calls = setup.agents.calls.filter((call) => call.kind === "repair");
  equal(new Set(calls.map((call) => call.workspace.folder)).size, 2);
  const byTry = new Map(calls.map((call) => [call.workspace.folder, call]));
  const prompts = [...byTry.values()].map((call) => call.prompt);
  equal(prompts.filter((prompt) => prompt.includes(secondClaim)).length, 1);
  deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [2, 2]);
  const attempt = step.update.attempt!;
  const branch = (number: number) => `workflow/${setup.threadId}/repair/${cluster}/attempt-1-try-${number}`;
  deepStrictEqual([attempt.outcome, attempt.recordId, attempt.branch, attempt.stage, attempt.reason], ["passed", `${attemptRecord}/try-2`, branch(2), null, null]);
  equal(setup.git(["rev-parse", branch(2)]).trim(), attempt.commit);
  const source = setup.git(["rev-parse", `workflow/${setup.threadId}/source`]).trim();
  for (const number of [1, 2]) equal(setup.git(["rev-parse", `${branch(number)}~1`]).trim(), source);
  deepStrictEqual(attempt.tries?.map((item) => [item.try, item.hypothesis, item.outcome, item.selected, item.patch?.added, item.patch?.removed]),
    [[1, 1, "passed", false, 11, 1], [2, 2, "passed", true, 4, 1]]);
  // The archive: the selected try's fields at the top level, every try in its own folder.
  const document = read<AttemptDocument>(join(attempt.folder, "attempt.json"));
  deepStrictEqual([document.outcome, document.selectedTry, document.recordId, document.branch, document.commit, document.hypothesisRecord],
    ["passed", 2, `${attemptRecord}/try-2`, branch(2), attempt.commit, `${setup.threadId}/${cluster}/hypothesis/2`]);
  deepStrictEqual([document.patch?.added, document.patch?.removed], [4, 1]);
  equal(readFileSync(join(attempt.folder, "files", "after", "Chummer", "frmCreate.cs"), "utf8"), lines(4, "second"));
  equal(readFileSync(join(attempt.folder, "patch.diff"), "utf8"), readFileSync(join(attempt.folder, "try-2", "patch.diff"), "utf8"));
  for (const [number, tag, count] of [[1, "first", 11], [2, "second", 4]] as const) {
    const folder = join(attempt.folder, `try-${number}`);
    const own = read<TryDocument>(join(folder, "attempt.json"));
    deepStrictEqual([own.try, own.hypothesis, own.outcome, own.recordId, own.branch, own.check?.status], [number, number, "passed", `${attemptRecord}/try-${number}`, branch(number), 0]);
    equal(readFileSync(join(folder, "files", "after", "Chummer", "frmCreate.cs"), "utf8"), lines(count, tag));
    ok(existsSync(join(folder, "build.log")));
    deepStrictEqual(await repairLabel(setup.store, own.recordId).then((label) => [label?.outcome, label?.stage]), ["passed", null]);
  }
  ok(setup.lines.some((line) => /try 1 \(hypothesis 1\) passed, 12 lines in 1 files\.$/.test(line)), setup.lines.join("\n"));
  ok(setup.lines.some((line) => /: passed with try 2; /.test(line)));
  // The workspaces are gone.
  for (const call of calls) ok(!existsSync(call.workspace.folder));
});

test("a tie in changed lines goes to fewer files, and a full tie to the lower try number", async () => {
  // Three changed lines each: try 1 in two files (one modified, one added), try 2 in one.
  const files = await diagnosed({
    tries: 2,
    reply: (call, number) => patchedReply(number === 1
      ? { "Chummer/frmCreate.cs": "class frmCreate { int a; }", "Core/Core.cs": "class Core { int b; }" }
      : { "Chummer/frmCreate.cs": lines(2, "two") })(call),
  });
  const chosen = await files.service.repair(files.input(files.repairs[cluster]!), files.store);
  deepStrictEqual(chosen.update.attempt?.tries?.map((item) => [item.try, item.hypothesis, (item.patch?.added ?? 0) + (item.patch?.removed ?? 0), item.patch?.files, item.selected]),
    [[1, 1, 3, 2, false], [2, 1, 3, 1, true]]);
  // The same patch twice: the first try.
  const same = await diagnosed({ tries: 2, reply: (call) => patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int same; }" })(call) });
  const first = await same.service.repair(same.input(same.repairs[cluster]!), same.store);
  equal(read<AttemptDocument>(join(first.update.attempt!.folder, "attempt.json")).selectedTry, 1);
  deepStrictEqual(first.update.attempt?.tries?.map((item) => item.selected), [true, false]);
  // The rule alone.
  deepStrictEqual(selectBest([{ lines: 5, files: 1, tryNumber: 3 }, { lines: 5, files: 1, tryNumber: 2 }, { lines: 6, files: 1, tryNumber: 1 }]), { lines: 5, files: 1, tryNumber: 2 });
  equal(selectBest([]), null);
});

test("every try rejected: the attempt is rejected with each try's stage and reason, and a next attempt's prompt shows both patches", async () => {
  const setup = await diagnosed({
    tries: 2,
    reply: (call, number) => patchedReply({ "Chummer/frmCreate.cs": `class frmCreate { int patch${number}; }` })(call),
    build: (number) => (number === 1 ? 1 : 0),
    failing: (number) => (number === 2 ? ["build-alpha/skills"] : []),
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  const attempt = step.update.attempt!;
  deepStrictEqual([step.update.status, attempt.outcome, attempt.stage], ["rejected", "rejected", "build"]);
  ok(/^try 1 \(hypothesis 1\) at build: the patched source does not build; see build\.log; try 2 \(hypothesis 1\) at check: still differs: build-alpha\/skills/.test(attempt.reason!), attempt.reason!);
  deepStrictEqual(attempt.tries?.map((item) => [item.try, item.outcome, item.stage, item.selected]), [[1, "rejected", "build", false], [2, "rejected", "check", false]]);
  const document = read<AttemptDocument>(join(attempt.folder, "attempt.json"));
  deepStrictEqual([document.outcome, document.stage, document.reason, document.selectedTry], ["rejected", "build", attempt.reason, null]);
  for (const [number, stage] of [[1, "build"], [2, "check"]] as const) {
    const own = read<TryDocument>(join(attempt.folder, `try-${number}`, "attempt.json"));
    deepStrictEqual([own.outcome, own.stage], ["rejected", stage]);
    deepStrictEqual(await repairLabel(setup.store, own.recordId).then((label) => [label?.outcome, label?.stage]), ["rejected", stage]);
  }
  // The next attempt is told about both tries, each with its patch.
  const repairs = mergeRepairs({ [cluster]: setup.repairs[cluster]! }, { [cluster]: step.update });
  const next = mergeRepairs(repairs, nextAttempts([cluster], repairs, {}).repairs)[cluster]!;
  const second = await setup.service.repair(setup.input(next), setup.store);
  equal(second.update.attempt?.attempt, 2);
  const prompt = setup.agents.calls.filter((call) => call.kind === "repair").at(-1)!.prompt;
  ok(prompt.includes("An attempt with \"tries\" made several patches side by side"), prompt);
  // Each try's patch once: the attempt's own patch is one of them.
  for (const number of [1, 2]) equal(prompt.split(`+class frmCreate { int patch${number}; }`).length, 2, `patch ${number}`);
  ok(prompt.includes("\"stage\": \"check\"") && prompt.includes("\"stage\": \"build\""));
});

test("a usage limit in one try parks the whole attempt; the finished try's job is charged, and the attempt starts again under a new number", async () => {
  let limited = true;
  const setup = await diagnosed({
    tries: 2,
    reply: (call, number) => (number === 1 && limited ? { failure: { kind: "quota_exhausted", message: "You've hit your usage limit." } }
      : patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int fixed; }" })(call)),
  });
  // Try 2 runs its job only after try 1's has ended with the limit and the attempt had time to take note of it, whatever the timing of the host.
  const run = setup.agents.run.bind(setup.agents);
  setup.agents.run = async (job) => {
    if (limited && job.kind === "repair" && job.label.endsWith(" try 2")) {
      while (!setup.agents.events.some((event) => event.endsWith(" try 1 end"))) await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return run(job);
  };
  const first = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  const attemptRecord = (number: number) => `${setup.threadId}/${cluster}/repair/${number}`;
  equal(first.update.waiting?.job, "repair");
  equal(first.update.status, undefined);
  deepStrictEqual(first.update.records, [`${attemptRecord(1)}/try-1`, `${attemptRecord(1)}/try-2`]);
  equal(first.chargedMs, 1000);
  // Nothing is built, checked or archived for a parked attempt.
  deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [0, 0]);
  ok(!existsSync(join(setup.folder, "repair", cluster, "attempt-1")));
  limited = false;
  const waiting: ClusterRepair = { ...setup.repairs[cluster]!, records: first.update.records! };
  const second = await setup.service.repair(setup.input(waiting), setup.store);
  equal(second.update.status, "passed");
  deepStrictEqual(second.update.records, [...first.update.records!, `${attemptRecord(2)}/try-1`, `${attemptRecord(2)}/try-2`]);
  equal(second.update.attempt?.folder, join(setup.folder, "repair", cluster, "attempt-2"));
});

test("a spent budget stops the tries that did not start: the attempt passes or is rejected by the try that ran", async () => {
  // One job at a time, each charging the whole budget of one minute, so the second try cannot start.
  for (const build of [0, 1]) {
    const setup = await diagnosed({ tries: 2, poolSize: 1, durationMs: 60_000, reply: (call) => patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int x; }" })(call), build: () => build });
    const base = setup.input(setup.repairs[cluster]!);
    const input = { ...base, spentMs: 0, options: { ...base.options, agents: resolveAgentSettings({ runBudgetMinutes: 1 }) } };
    const step = await setup.service.repair(input, setup.store);
    const attempt = step.update.attempt!;
    equal(setup.agents.calls.filter((call) => call.kind === "repair").length, 1);
    deepStrictEqual(step.update.records, [`${setup.threadId}/${cluster}/repair/1/try-1`]);
    equal(step.chargedMs, 60_000);
    const stopped = attempt.tries![1]!;
    deepStrictEqual([stopped.outcome, stopped.stage, stopped.commit, stopped.selected], ["rejected", "model", null, false]);
    ok(/run budget of 1 min was spent before the try's first job could start/.test(stopped.reason!), stopped.reason!);
    const own = read<TryDocument>(join(attempt.folder, "try-2", "attempt.json"));
    deepStrictEqual([own.outcome, own.answer, own.patch, own.build], ["rejected", null, null, null]);
    equal(readFileSync(join(attempt.folder, "try-2", "patch.diff"), "utf8"), "");
    if (build === 0) {
      deepStrictEqual([step.update.status, attempt.outcome, attempt.recordId], ["passed", "passed", `${setup.threadId}/${cluster}/repair/1/try-1`]);
    } else {
      // No try passed, and the one that ran to its end decides: the attempt is rejected, shown by that try.
      deepStrictEqual([step.update.status, attempt.outcome, attempt.stage, attempt.recordId], ["rejected", "rejected", "build", `${setup.threadId}/${cluster}/repair/1/try-1`]);
      ok(/try 1 \(hypothesis 1\) at build: .*; try 2 \(hypothesis 1\) at model: the run budget/.test(attempt.reason!), attempt.reason!);
    }
  }
  // Spent before the attempt: no try starts, as for an attempt of one try.
  const spent = await diagnosed({ tries: 2, reply: (call) => patchedReply({ "Chummer/frmCreate.cs": "x" })(call) });
  const step = await spent.service.repair(spent.input(spent.repairs[cluster]!, { spentMs: 120 * 60_000 }), spent.store);
  deepStrictEqual(step, { update: { clusterId: cluster, status: "budget_exhausted" }, chargedMs: 0 });
});

test("an attempt of one try keeps the attempt's record and branch, and its archive holds try-1/", async () => {
  const setup = await diagnosed({ tries: 1, reply: (call) => patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int one; }" })(call) });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  const attempt = step.update.attempt!;
  deepStrictEqual([step.update.status, attempt.recordId, attempt.branch, attempt.tries], ["passed", `${setup.threadId}/${cluster}/repair/1`, `workflow/${setup.threadId}/repair/${cluster}/attempt-1`, undefined]);
  const document = read<AttemptDocument>(join(attempt.folder, "attempt.json"));
  deepStrictEqual([document.selectedTry, document.tries?.map((item) => [item.try, item.recordId, item.folder, item.selected])], [1, [[1, attempt.recordId, "try-1", true]]]);
  equal(read<TryDocument>(join(attempt.folder, "try-1", "attempt.json")).recordId, attempt.recordId);
});

test("an interrupted attempt's stored try records are listed and the next attempt gets the next number", async () => {
  const setup = await diagnosed({ tries: 2, reply: (call) => patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int y; }" })(call) });
  const stored = `${setup.threadId}/${cluster}/repair/1/try-2`;
  await putRecord(setup.store, record({ recordId: stored, jobKind: "repair" }));
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual(step.update.records, [stored, `${setup.threadId}/${cluster}/repair/2/try-1`, `${setup.threadId}/${cluster}/repair/2/try-2`]);
  equal(step.update.attempt?.attempt, 2);
});

test("the tries go round the confirmed hypotheses, at most six; a narrow check of any try that failed to execute makes the status 2", () => {
  const hypotheses = [1, 2, 3].map((variant) => ({ variant, diagnosis: {} as never }));
  deepStrictEqual(tryPlan(hypotheses.slice(0, 2), 2).map((item) => [item.tryNumber, item.hypothesis.variant]), [[1, 1], [2, 2], [3, 1], [4, 2]]);
  deepStrictEqual(tryPlan(hypotheses, 3).map((item) => item.hypothesis.variant), [1, 2, 3, 1, 2, 3]);
  deepStrictEqual(tryPlan(hypotheses.slice(0, 1), 1).map((item) => item.tryNumber), [1]);
  const check = (status: 0 | 1 | 2): CheckExecution => ({ runFolder: "r", status, coverageValid: status !== 2, invalidReasons: [], failures: 0, passed: 1, failed: 0 });
  const trySummary = (number: number, status: 0 | 1 | 2) => ({
    try: number, hypothesis: 1, hypothesisRecord: "h", recordId: `r/try-${number}`, branch: "b", commit: null, folder: `try-${number}`, outcome: "passed" as const,
    stage: null, reason: null, selected: number === 1, patch: null, check: check(status),
  });
  const repair = (second: 0 | 1 | 2): ClusterRepair => ({
    clusterId: "d-1", status: "passed", earlier: [], waiting: null, records: [],
    attempt: { attempt: 1, recordId: "r/try-1", folder: "f", outcome: "passed", stage: null, reason: null, check: check(0), tries: [trySummary(1, 0), trySummary(2, second)] },
  });
  equal(repairStatus({ "d-1": repair(1) }), 0);
  equal(repairStatus({ "d-1": repair(2) }), 2);
});

test("a thread stored before attempts had tries repairs from its first confirmed hypothesis alone", async () => {
  const setup = await diagnosed({ hypotheses: 2, tries: undefined, reply: (call) => patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int old; }" })(call) });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  deepStrictEqual([step.update.status, step.update.records], ["passed", [`${setup.threadId}/${cluster}/repair/1`]]);
  equal(read<AttemptDocument>(join(step.update.attempt!.folder, "attempt.json")).hypothesisRecord, `${setup.threadId}/${cluster}/hypothesis/1`);
  equal(setup.agents.calls.filter((call) => call.kind === "repair").length, 1);
});

test("an earlier attempt whose try lost its patch is a setup error before any try's workspace exists", async () => {
  const setup = await diagnosed({ tries: 2, reply: (call, number) => patchedReply({ "Chummer/frmCreate.cs": `class frmCreate { int lost${number}; }` })(call), build: () => 1 });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  rmSync(join(step.update.attempt!.folder, "try-2", "patch.diff"));
  const repairs = mergeRepairs({ [cluster]: setup.repairs[cluster]! }, { [cluster]: step.update });
  const next = mergeRepairs(repairs, nextAttempts([cluster], repairs, {}).repairs)[cluster]!;
  const made = setup.scratches.length;
  await rejects(setup.service.repair(setup.input(next), setup.store), (error: Error) => error instanceof SetupError && /lost its patch/.test(error.message));
  equal(setup.scratches.length, made);
});

test("a try is built and checked as soon as its own jobs end, while a sibling's job still runs", async () => {
  const stop = new AbortController();
  const setup = await diagnosed({
    tries: 2,
    reply: (call, number) => (number === 2 ? { hang: true } : patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int early; }" })(call)),
    // Try 1's build starts while try 2's job is hanging; stopping the run then ends try 2.
    build: (number) => {
      if (number === 1) stop.abort();
      return 0;
    },
  });
  await rejects(setup.service.repair(setup.input(setup.repairs[cluster]!, { signal: stop.signal }), setup.store), (error: Error) => error instanceof SetupError && /stopped/.test(error.message));
  deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [1, 1]);
  equal(setup.agents.calls.filter((call) => call.kind === "repair").length, 2);
  // No workspace of either try is left behind.
  for (const call of setup.agents.calls.filter((item) => item.kind === "repair")) ok(!existsSync(call.workspace.folder));
});

test("the tries share the attempt's deadline: a try that waited for its place gets what is left, not a fresh deadline", async () => {
  const minute = 60_000;
  // One job at a time; each repair job takes 4 minutes of the clock, and the attempt's deadline is 10.
  let clock = Date.UTC(2026, 0, 1);
  const setup = await diagnosed({
    tries: 2, poolSize: 1, deadlineMinutes: 10, now: () => new Date(clock),
    reply: (call, number) => {
      clock += 4 * minute;
      return patchedReply({ "Chummer/frmCreate.cs": `class frmCreate { int t${number}; }` })(call);
    },
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  const calls = setup.agents.calls.filter((call) => call.kind === "repair");
  deepStrictEqual(calls.map((call) => call.timeoutMinutes), [10, 6]);
  deepStrictEqual([step.update.status, setup.host.builds.length], ["passed", 2]);
});

test("a try whose place came after the attempt's deadline does not start, and a try past it is rejected before its build", async () => {
  const minute = 60_000;
  let clock = Date.UTC(2026, 0, 1);
  const setup = await diagnosed({
    tries: 2, poolSize: 1, deadlineMinutes: 10, now: () => new Date(clock),
    reply: (call) => {
      clock += 11 * minute;
      return patchedReply({ "Chummer/frmCreate.cs": "class frmCreate { int late; }" })(call);
    },
  });
  const step = await setup.service.repair(setup.input(setup.repairs[cluster]!), setup.store);
  equal(setup.agents.calls.filter((call) => call.kind === "repair").length, 1);
  deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [0, 0]);
  deepStrictEqual([step.update.status, step.update.attempt?.outcome, step.update.attempt?.stage], ["rejected", "rejected", "deadline"]);
  deepStrictEqual(step.update.attempt?.tries?.map((item) => [item.try, item.outcome, item.stage]), [[1, "rejected", "deadline"], [2, "rejected", "deadline"]]);
  ok(/try 1 \(hypothesis 1\) at deadline: the deadline passed before the build could start; try 2 \(hypothesis 1\) at deadline: the attempt's deadline passed before the try's job could start/
    .test(step.update.attempt!.reason!), step.update.attempt!.reason!);
  deepStrictEqual(step.update.records, [`${setup.threadId}/${cluster}/repair/1/try-1`]);
});
