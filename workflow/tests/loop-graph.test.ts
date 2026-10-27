import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import type { RepairDocument } from "../src/repair/repair-report.js";
import type { WideningDocument } from "../src/widening/widening-report.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource, type CheckBehaviour } from "./repair-fixtures.js";
import { FakeWideningHost, type WideningScript } from "./widening-fixtures.js";
import { repository } from "./diagnosis-fixtures.js";
import type { BranchGit } from "../src/git/branch-git.js";

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
  /** A wrapper around the repository's git. */
  readonly git?: (git: BranchGit) => BranchGit;
  readonly extra?: Partial<Parameters<typeof diagnosisHarness>[0]>;
};

const gitIn = (root: string) => (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** The fixture repository with its working tree committed on `master`, so a thread's fixes merge into it; `edit` changes the tree before the commit. */
function committedRepository(edit: (root: string) => void = () => {}): string {
  const root = repository();
  const git = gitIn(root);
  edit(root);
  git("add", "-A");
  git("commit", "-q", "-m", "working tree");
  git("branch", "-M", "master");
  return root;
}

/**
 * Every cluster confirmed; repairs edit frmCreate.cs (first cluster) or untracked.cs (second) unless told otherwise.
 * The repository is a committed one on `master` unless the options name another.
 */
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
    ...(options.widening === false ? {} : { widening: { host: (root, names) => new FakeWideningHost(root, names, options.script ?? {}), ...(options.git === undefined ? {} : { git: options.git }) } }),
    ...options.extra,
    repository: options.extra?.repository ?? committedRepository(),
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
  ok(run.lines.includes(`Loop ${first}: fixed after 2 attempts; ${state.accepted?.commit} merged as ${outcome.clusters[0]!.mergeCommit}`));
  ok(run.lines.includes(`Merge: master ${outcome.merge?.before} -> ${outcome.merge?.after}; 1 of 1 fixes merged, kept on workflow/${threadId}/integration`));
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
/** The values of a trailer on the commits `master` reaches, newest first. */
const trailersOn = (root: string, key: string) => gitIn(root)("log", `--format=%(trailers:key=${key},valueonly)`, "master").split(/\r?\n/).filter((line) => line.length > 0);

test("two promoted fixes are merged into the branch the thread started on, one merge commit each, in the order of the promotions", async () => {
  const run = harness({ spots: twoClusters });
  const git = gitIn(run.sourceRepository);
  const start = git("rev-parse", "master");
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const state = await run.state(threadId);
  deepStrictEqual(state.base, { branch: "master", commit: start });
  const outcome = outcomeOf(run.root, threadId);
  const after = git("rev-parse", "master");
  deepStrictEqual(outcome.clusters.map((item) => [item.clusterId, item.disposition, item.commit]), [[first, "fixed", state.widenings[first]!.commit], [second, "fixed", state.widenings[second]!.commit]]);
  deepStrictEqual([outcome.merge?.branch, outcome.merge?.before, outcome.merge?.after, outcome.merge?.integrationBranch], ["master", start, after, `workflow/${threadId}/integration`]);
  deepStrictEqual(outcome.merge?.fixes.map((fix) => [fix.clusterId, fix.status, fix.fixBranch, fix.mergeCommit]),
    [[first, "merged", `workflow/${threadId}/fix/${first}`, outcome.clusters[0]!.mergeCommit], [second, "merged", `workflow/${threadId}/fix/${second}`, after]]);
  // master gains a merge commit of the first fix's branch, then one of the second's, each with its trailers.
  deepStrictEqual(git("log", "--first-parent", "--format=%s", `${start}..master`).split(/\r?\n/), [`Merge fix for discrepancy ${second}`, `Merge fix for discrepancy ${first}`]);
  equal(git("rev-parse", `${outcome.clusters[0]!.mergeCommit}^1`), start);
  equal(git("rev-parse", `${outcome.clusters[0]!.mergeCommit}^2`), git("rev-parse", `workflow/${threadId}/fix/${first}`));
  equal(git("rev-parse", `${after}^2`), git("rev-parse", `workflow/${threadId}/fix/${second}`));
  equal(git("log", "-1", "--format=%(trailers:only,unfold)", after), `Workflow-Thread: ${threadId}\nMerged-Fix: ${threadId}/${second}`);
  // The checked-out working tree holds both fixes, with nothing left uncommitted, and the merge worktree is gone.
  deepStrictEqual([readFileSync(join(run.sourceRepository, "Chummer", "frmCreate.cs"), "utf8"), readFileSync(join(run.sourceRepository, "Chummer", "untracked.cs"), "utf8")], [repairedSource, "fixed"]);
  equal(git("status", "--porcelain=v1"), "");
  equal(existsSync(join(run.root, "threads", threadId, "merge")), false);
  ok(!git("worktree", "list", "--porcelain").includes(join(run.root, "threads", threadId, "merge").replace(/\\/g, "/")));
  ok(run.lines.includes(`Merge: master ${start} -> ${after}; 2 of 2 fixes merged, kept on workflow/${threadId}/integration`));
  equal(outcome.outcome, "verified_for_scope");
});

test("a fix that does not rebase onto the moved branch is not merged, nor the fix promoted after it", async () => {
  let moved = "";
  const run = harness({
    spots: twoClusters,
    extra: {
      beforeMerge: (root) => {
        writeFileSync(join(root, "Chummer", "frmCreate.cs"), "class frmCreate { int elsewhere; }");
        gitIn(root)("commit", "-q", "-am", "frmCreate changed on master");
        moved = gitIn(root)("rev-parse", "master");
      },
    },
  });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const git = gitIn(run.sourceRepository);
  equal(git("rev-parse", "master"), moved);
  equal(git("status", "--porcelain=v1"), "");
  const state = await run.state(threadId);
  const outcome = outcomeOf(run.root, threadId);
  deepStrictEqual(outcome.clusters.map((item) => [item.disposition, item.stage, item.commit, item.mergeCommit]),
    [["merge_failed", "merge", state.widenings[first]!.commit, null], ["merge_failed", "merge", state.widenings[second]!.commit, null]]);
  equal(outcome.clusters[0]!.reason, "the rebase onto master conflicts in Chummer/frmCreate.cs");
  ok(outcome.clusters[1]!.reason!.startsWith(`${first} did not merge`));
  deepStrictEqual(outcome.merge?.fixes.map((fix) => [fix.status, fix.files]), [["conflict", ["Chummer/frmCreate.cs"]], ["blocked", []]]);
  deepStrictEqual([outcome.merge?.before, outcome.merge?.after, outcome.merge?.integrationBranch], [moved, moved, null]);
  deepStrictEqual([outcome.outcome, outcome.measures.fixed], ["findings_remaining", 0]);
  ok(run.lines.includes(`Loop ${first}: merge_failed after 1 attempt; merge: the rebase onto master conflicts in Chummer/frmCreate.cs; ${state.widenings[first]!.commit}`));
  ok(run.lines.includes(`Merge: master ${moved} -> ${moved}; 0 of 2 fixes merged`));
});

test("a branch that moves while the fixes are merged is a setup error naming the integration branch, and the resumed thread merges onto its new tip", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  let moved = "";
  const root = committedRepository();
  const run = harness({
    spots: twoClusters,
    git: (git) => (args, options) => {
      const output = git(args, options);
      if (moved === "" && args[0] === "update-ref" && args.some((arg) => arg.endsWith("/integration"))) {
        writeFileSync(join(root, "README.md"), "moved meanwhile");
        gitIn(root)("commit", "-q", "-am", "master moved meanwhile");
        moved = gitIn(root)("rev-parse", "master");
      }
      return output;
    },
    extra: { checkpointer, store, repository: root },
  });
  equal(await run.start(), 3);
  const threadId = run.threadId();
  ok(run.lines.some((line) => line.startsWith("Setup error: master moved to ") && line.includes(`workflow/${threadId}/integration`)), run.lines.join("\n"));
  equal(gitIn(root)("rev-parse", "master"), moved);
  deepStrictEqual(trailersOn(root, "Merged-Fix"), []);

  const resumed = harness({ spots: twoClusters, extra: { checkpointer, store, root: run.root, repository: root } });
  equal(await resumed.resume(threadId), 1);
  deepStrictEqual(resumed.agents.calls, []);
  const outcome = outcomeOf(run.root, threadId);
  deepStrictEqual(outcome.clusters.map((item) => item.disposition), ["fixed", "fixed"]);
  deepStrictEqual([outcome.merge?.before, outcome.merge?.after], [moved, gitIn(root)("rev-parse", "master")]);
  deepStrictEqual(trailersOn(root, "Merged-Fix"), [`${threadId}/${second}`, `${threadId}/${first}`]);
  equal(gitIn(root)("rev-parse", `${outcome.clusters[0]!.mergeCommit}^1`), moved);
  equal(readFileSync(join(root, "README.md"), "utf8"), "moved meanwhile");
});

test("a fast-forward refused for a local edit of a merged file is a setup error, and once the edit is committed the resumed thread merges each fix once", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const lines = (middle: string, last: string) => `class frmCreate {\n  int ${middle};\n}\n// one\n// two\n// ${last}\n`;
  const root = committedRepository((folder) => writeFileSync(join(folder, "Chummer", "frmCreate.cs"), lines("moved", "local")));
  const git = gitIn(root);
  const start = git("rev-parse", "master");
  const run = harness({
    repair: patchedReply({ "Chummer/frmCreate.cs": lines("restored", "local") }),
    extra: { checkpointer, store, repository: root, beforeMerge: (folder) => writeFileSync(join(folder, "Chummer", "frmCreate.cs"), lines("moved", "local edit")) },
  });
  equal(await run.start(), 3);
  const threadId = run.threadId();
  ok(run.lines.some((line) => line.startsWith("Setup error: master could not be advanced to the merges kept on ") && line.includes(`workflow/${threadId}/integration`)), run.lines.join("\n"));
  equal(git("rev-parse", "master"), start);
  equal(git("diff", "--name-only"), "Chummer/frmCreate.cs");
  equal(git("log", "-1", "--format=%(trailers:key=Merged-Fix,valueonly)", `workflow/${threadId}/integration`), `${threadId}/${first}`);

  git("commit", "-q", "-am", "local edit");
  const edited = git("rev-parse", "master");
  const resumed = harness({ extra: { checkpointer, store, root: run.root, repository: root } });
  equal(await resumed.resume(threadId), 1);
  const outcome = outcomeOf(run.root, threadId);
  deepStrictEqual([outcome.clusters[0]!.disposition, outcome.merge?.before, outcome.merge?.after], ["fixed", edited, git("rev-parse", "master")]);
  deepStrictEqual(trailersOn(root, "Merged-Fix"), [`${threadId}/${first}`]);
  // The checkout gets its line endings from the machine's git settings.
  equal(readFileSync(join(root, "Chummer", "frmCreate.cs"), "utf8").replace(/\r\n/g, "\n"), lines("restored", "local edit"));
  equal(git("status", "--porcelain=v1"), "");
});

test("a branch no worktree has checked out when the thread concludes is advanced by a ref update, and the checkout stays as it is", async () => {
  const run = harness({ extra: { beforeMerge: (root) => gitIn(root)("checkout", "-q", "-b", "elsewhere") } });
  const git = gitIn(run.sourceRepository);
  const start = git("rev-parse", "master");
  equal(await run.start(), 1);
  const outcome = outcomeOf(run.root, run.threadId());
  equal(outcome.clusters[0]!.disposition, "fixed");
  deepStrictEqual([git("rev-parse", "master"), git("rev-parse", "master^1")], [outcome.clusters[0]!.mergeCommit, start]);
  deepStrictEqual([git("symbolic-ref", "--short", "HEAD"), git("rev-parse", "HEAD")], ["elsewhere", start]);
  equal(readFileSync(join(run.sourceRepository, "Chummer", "frmCreate.cs"), "utf8"), "class frmCreate { int moved; }");
  equal(git("show", "master:Chummer/frmCreate.cs"), repairedSource);
  equal(git("status", "--porcelain=v1"), "");
});

test("a thread that repairs and widens refuses a detached HEAD before the build and stores nothing; one without widening records it", async () => {
  const checkpointer = new MemorySaver();
  const run = harness({ extra: { checkpointer } });
  const git = gitIn(run.sourceRepository);
  git("checkout", "-q", "--detach");
  const head = git("rev-parse", "HEAD");
  equal(await run.start(), 3);
  ok(run.lines.some((line) => line.startsWith(`Setup error: HEAD is detached at ${head}, `)), run.lines.join("\n"));
  ok(!run.lines.some((line) => line.startsWith("Thread ") || line.startsWith("Resume it")));
  deepStrictEqual(Object.keys(checkpointer.storage), []);
  deepStrictEqual(run.prepared, []);
  deepStrictEqual(run.agents.calls, []);

  equal(await run.start({ noWidening: true }), 1);
  deepStrictEqual(run.prepared, [run.threadId()]);
  const state = await run.state(run.threadId());
  deepStrictEqual(state.base, { branch: null, commit: head });
  equal(outcomeOf(run.root, run.threadId()).merge, null);
});
