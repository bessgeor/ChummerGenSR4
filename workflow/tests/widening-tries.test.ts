import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { EvalRecordSchema, recordNamespace } from "../src/evals/eval-record.js";
import type { AttemptDocument, TrySummary } from "../src/repair/attempt-archive.js";
import type { ClusterRepair } from "../src/repair/cluster-repair.js";
import { describeRepair, type RepairDocument } from "../src/repair/repair-report.js";
import type { ClusterWidening } from "../src/widening/cluster-widening.js";
import type { WideningDocument } from "../src/widening/widening-report.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource } from "./repair-fixtures.js";
import { readAttempt } from "../src/widening/widening-service.js";
import { scratch } from "./diagnosis-fixtures.js";
import { FakeWideningHost, type WideningScript } from "./widening-fixtures.js";

const cluster = "d-0000000000000100";

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** The try a repair job's worktree belongs to, from its branch `…/attempt-<n>-try-<k>`. */
function tryOf(folder: string): number {
  return Number(/-try-(\d+)$/.exec(git(folder, "rev-parse", "--abbrev-ref", "HEAD"))?.[1] ?? 0);
}

/** Twelve lines that the first try writes; the second try's patch is the one-line repair, so it is selected. */
const longerSource = Array.from({ length: 12 }, (_, index) => `// try 1 line ${index + 1}`).join("\n");

/** One confirmed cluster whose attempt makes two tries of its hypothesis, then widening. */
function harness(script: WideningScript = {}) {
  const agents = new FakeAgents((call: JobCall): Reply => {
    if (call.kind === "repair") return patchedReply({ "Chummer/frmCreate.cs": tryOf(call.workspace.folder) === 1 ? longerSource : repairedSource })(call);
    return { answer: call.kind === "challenge" ? challengeAnswer() : hypothesisAnswer() };
  });
  return diagnosisHarness({
    spots: [twoClusters[0]!], agents,
    repair: { deadlineMinutes: 60, tries: 2, host: (root) => new FakeRepairHost(root) },
    widening: { host: (root, names) => new FakeWideningHost(root, names, script), extraCases: ["gamma"] },
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

test("of an attempt with two passed tries only the selected one is widened and promoted, and widening.json and the report name it", async () => {
  const run = harness();
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const attemptRecord = `${threadId}/${cluster}/repair/1`;
  const state = await run.state(threadId);
  const repair = state.repairs[cluster]!;
  deepStrictEqual([repair.status, repair.attempt?.recordId], ["passed", `${attemptRecord}/try-2`]);
  const archive = readJson<AttemptDocument>(join(repair.attempt!.folder, "attempt.json"));
  const [one, two] = archive.tries!;
  // Only the selected try's commit is applied: one widening build of the widened source, which holds try 2's file.
  const widened = run.wideningHost.builds.filter((build) => build.label === `widen ${cluster} build`);
  equal(widened.length, 1);
  equal(readFileSync(join(widened[0]!.source, "Chummer", "frmCreate.cs"), "utf8"), repairedSource);
  ok(!run.wideningHost.builtSources.includes(longerSource));
  const tip = git(run.sourceRepository, "rev-parse", `accepted/${threadId}`);
  equal(git(run.sourceRepository, "show", `${tip}:Chummer/frmCreate.cs`), repairedSource);
  deepStrictEqual(git(run.sourceRepository, "diff", "--name-only", `${tip}~1`, tip).split("\n"), ["Chummer/frmCreate.cs"]);
  equal(git(run.sourceRepository, "diff", `${two!.commit}~1`, two!.commit!), git(run.sourceRepository, "diff", `${tip}~1`, tip));
  // The widening names the selected try, in the thread's state, its own widening.json and the thread's.
  const widening: ClusterWidening = state.widenings[cluster]!;
  deepStrictEqual([widening.status, widening.recordId, widening.selectedTry, widening.tries], ["promoted", `${attemptRecord}/try-2`, 2, 2]);
  deepStrictEqual(readJson<ClusterWidening>(join(widening.folder, "widening.json")).selectedTry, 2);
  const document = readJson<WideningDocument>(join(run.root, "threads", threadId, "widening.json"));
  deepStrictEqual(document.widenings.map((item) => [item.clusterId, item.selectedTry, item.tries, item.status]), [[cluster, 2, 2, "promoted"]]);
  // Only the selected try's record gets the widening label; the other try stays as it was archived.
  const label = async (recordId: string) => EvalRecordSchema.parse((await run.store.get(recordNamespace("repair"), recordId))!.value).labels;
  deepStrictEqual([(await label(`${attemptRecord}/try-2`)).widening?.outcome, (await label(`${attemptRecord}/try-2`)).widening?.commit], ["promoted", tip]);
  equal((await label(`${attemptRecord}/try-1`)).widening, null);
  equal((await label(`${attemptRecord}/try-1`)).repair?.outcome, "passed");
  // repair.json lists the latest attempt with its tries.
  const repairDocument = readJson<RepairDocument>(join(run.root, "threads", threadId, "repair.json"));
  deepStrictEqual(repairDocument.clusters[0]!.attempt?.tries?.map((item) => [item.try, item.outcome, item.selected, item.recordId]),
    [[1, "passed", false, `${attemptRecord}/try-1`], [2, "passed", true, `${attemptRecord}/try-2`]]);
  // The report: the attempt with its selected try, each try with its size and its narrow check's execution apart from its visual result.
  const folder = repair.attempt!.folder;
  ok(run.lines.some((line) => line.startsWith(`Repair ${cluster}: attempt 1 PASSED the narrow check with try 2 of 2; `)));
  ok(run.lines.includes(`Repair ${cluster}: try 1 (hypothesis 1) passed, ${one!.patch!.added + one!.patch!.removed} lines in 1 files, not selected; branch ${one!.branch}; archive ${join(folder, "try-1")}`));
  ok(run.lines.includes(`Repair ${cluster}: try 2 (hypothesis 1) passed, 2 lines in 1 files, SELECTED; branch ${two!.branch}; archive ${join(folder, "try-2")}`));
  for (const number of [1, 2]) {
    ok(run.lines.some((line) => line.startsWith(`Repair ${cluster}: try ${number} narrow check execution: capture status `)));
    ok(run.lines.some((line) => line.startsWith(`Repair ${cluster}: try ${number} narrow check visual: `)));
  }
  ok(!run.lines.some((line) => line.startsWith(`Repair ${cluster}: narrow check `)));
  ok(run.lines.includes(`Widening ${cluster}: attempt 1 try 2 of 2 PROMOTED as ${tip} on accepted/${threadId}`));
});

test("a widening that rejects the selected try rolls back only that try, and the unselected try is never widened", async () => {
  const run = harness({ build: (request) => (request.label === `widen ${cluster} build` ? 1 : 0) });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const state = await run.state(threadId);
  const widening = state.widenings[cluster]!;
  deepStrictEqual([widening.status, widening.rejection?.stage, widening.selectedTry], ["rejected", "build", 2]);
  equal(run.wideningHost.builds.filter((build) => build.label === `widen ${cluster} build`).length, 1);
  equal(git(run.sourceRepository, "for-each-ref", `refs/heads/accepted/${threadId}`), "");
  const label = async (recordId: string) => EvalRecordSchema.parse((await run.store.get(recordNamespace("repair"), recordId))!.value).labels.widening;
  equal((await label(`${threadId}/${cluster}/repair/1/try-2`))?.outcome, "rejected");
  equal(await label(`${threadId}/${cluster}/repair/1/try-1`), null);
  ok(run.lines.includes(`Widening ${cluster}: attempt 1 try 2 of 2 rejected at build: the widened source does not build; see build.log`));
});

test("an archive whose top level is not its selected try's is a setup error for widening", async () => {
  const run = harness({ build: () => 1 });
  equal(await run.start(), 1);
  const folder = (await run.state(run.threadId())).repairs[cluster]!.attempt!.folder;
  const archive = readJson<AttemptDocument>(join(folder, "attempt.json"));
  equal(readAttempt(folder).recordId, archive.recordId);
  const copy = scratch("workflow-widening-tries-");
  const tamper = (document: object) => writeFileSync(join(copy, "attempt.json"), `${JSON.stringify(document, null, 2)}
`);
  for (const document of [
    { ...archive, commit: archive.tries![0]!.commit },
    { ...archive, selectedTry: 1 },
    { ...archive, tries: archive.tries!.map((item) => ({ ...item, selected: true })) },
  ]) {
    tamper(document);
    throws(() => readAttempt(copy), (error: unknown) => error instanceof SetupError && /does not keep its one selected try's record and commit/.test(error.message));
  }
  // An archive written before attempts had tries is read as it was.
  const { tries: _tries, selectedTry: _selectedTry, ...legacy } = archive;
  tamper(legacy);
  equal(readAttempt(copy).commit, archive.commit);
});

test("the report shows each try of a rejected attempt with its narrow check's execution apart from its visual result", () => {
  const check = (status: 0 | 1 | 2, coverageValid: boolean) => ({
    runFolder: `runs/${status}`, status, coverageValid, invalidReasons: coverageValid ? [] : ["failure:build-alpha/candidate"], failures: coverageValid ? 0 : 1, passed: 0, failed: 1,
  });
  const tries: TrySummary[] = [
    { try: 1, hypothesis: 1, hypothesisRecord: "h/1", recordId: "r/try-1", branch: "b-1", commit: "c1", folder: "try-1", outcome: "rejected", stage: "build", reason: "the patched source does not build", selected: false, patch: { files: 2, added: 3, removed: 1 }, check: null },
    { try: 2, hypothesis: 2, hypothesisRecord: "h/2", recordId: "r/try-2", branch: "b-2", commit: "c2", folder: "try-2", outcome: "rejected", stage: "check", reason: "build-alpha/skills still differs", selected: false, patch: { files: 1, added: 1, removed: 1 }, check: check(2, false) },
  ];
  const repair: ClusterRepair = {
    clusterId: cluster, status: "rejected", earlier: [], waiting: null, records: ["r/try-1", "r/try-2"],
    attempt: { attempt: 1, recordId: "r/try-2", folder: "attempt-1", outcome: "rejected", stage: "check", reason: "try 1 (hypothesis 1) at build: …; try 2 (hypothesis 2) at check: …", check: check(2, false), branch: "b-2", commit: "c2", tries },
  };
  deepStrictEqual(describeRepair({ [cluster]: repair }, null), [
    `Repair ${cluster}: attempt 1 rejected at check: try 1 (hypothesis 1) at build: …; try 2 (hypothesis 2) at check: …; 2 records; archive attempt-1`,
    `Repair ${cluster}: try 1 (hypothesis 1) rejected at build: the patched source does not build, 4 lines in 2 files, not selected; branch b-1; archive ${join("attempt-1", "try-1")}`,
    `Repair ${cluster}: try 2 (hypothesis 2) rejected at check: build-alpha/skills still differs, 2 lines in 1 files, not selected; branch b-2; archive ${join("attempt-1", "try-2")}`,
    `Repair ${cluster}: try 2 narrow check execution: capture status 2, coverage INVALID: failure:build-alpha/candidate, 1 failures; run folder runs/2`,
    `Repair ${cluster}: try 2 narrow check visual: 0 passed, 1 failed`,
  ]);
});
