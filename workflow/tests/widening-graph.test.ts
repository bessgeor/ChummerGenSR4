import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { EvalRecordSchema, recordNamespace } from "../src/evals/eval-record.js";
import { SetupError } from "../src/host/setup-error.js";
import type { BranchGit } from "../src/git/branch-git.js";
import type { ClusterWidening } from "../src/widening/cluster-widening.js";
import type { WideningDocument } from "../src/widening/widening-report.js";
import type { WideningDependencies } from "../src/widening/widening-service.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { FakeRepairHost, patchedReply, repairedSource } from "./repair-fixtures.js";
import { scratch } from "./diagnosis-fixtures.js";
import { FakeWideningHost, writeCoverage, writeRun, type WideningScript } from "./widening-fixtures.js";
import { stoppedStage } from "./stage-state.js";

const first = "d-0000000000000100";
const second = "d-0000000000000400";

/** Both clusters confirmed; the first cluster's repair edits frmCreate.cs, the second's untracked.cs unless both edit the same file. */
function agents(sameFile = false): FakeAgents {
  return new FakeAgents((call: JobCall): Reply => {
    if (call.kind === "repair") {
      return call.cluster === first || sameFile
        ? patchedReply({ "Chummer/frmCreate.cs": call.cluster === first ? repairedSource : "class frmCreate { int other; }" })(call)
        : patchedReply({ "Chummer/untracked.cs": "fixed" })(call);
    }
    return { answer: call.kind === "challenge" ? challengeAnswer() : hypothesisAnswer() };
  });
}

type Options = {
  readonly script?: WideningScript;
  readonly spots?: typeof twoClusters;
  readonly sameFile?: boolean;
  readonly extra?: Partial<Parameters<typeof diagnosisHarness>[0]>;
  readonly git?: (git: BranchGit) => BranchGit;
  readonly inputs?: WideningDependencies["inputs"];
};

function harness(options: Options = {}) {
  return diagnosisHarness({
    spots: options.spots ?? twoClusters, agents: agents(options.sameFile),
    repair: { deadlineMinutes: 60, host: (root) => new FakeRepairHost(root) },
    widening: { host: (root, names) => new FakeWideningHost(root, names, options.script ?? {}), extraCases: ["gamma"], ...(options.git === undefined ? {} : { git: options.git }), ...(options.inputs === undefined ? {} : { inputs: options.inputs }) },
    ...options.extra,
  });
}

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function documentOf(root: string, threadId: string): WideningDocument {
  return JSON.parse(readFileSync(join(root, "threads", threadId, "widening.json"), "utf8")) as WideningDocument;
}

/** A failing row with these candidate pixels at the given capture label, case and capture. */
function failAt(label: string, caseName: string, capture: string, candidate: number[] = [1], baseline: "same" | "passes" = "passes"): NonNullable<WideningScript["observe"]> {
  return (request, name, item, isBaseline) => {
    if (name !== caseName || item !== capture) return undefined;
    if (isBaseline) return baseline === "same" && request.label === `${label} baseline` ? { passed: false, candidate } : undefined;
    return request.label === label ? { passed: false, candidate } : undefined;
  };
}

test("passed attempts are widened one after the other through the levels and promoted as commits on the accepted branch", async () => {
  const run = harness();
  const repository = run.sourceRepository;
  const before = { head: git(repository, "rev-parse", "HEAD"), status: git(repository, "status", "--porcelain=v1") };
  equal(await run.start(), 1);
  const threadId = run.threadId();
  deepStrictEqual(run.wideningHost.labels(), [
    `widen ${first} narrow`, `widen ${first} character`, `widen ${first} mode`, `widen ${first} suite`,
    `widen ${second} narrow`, `widen ${second} character`, `widen ${second} suite`,
  ]);
  deepStrictEqual(run.wideningHost.captures.slice(0, 4).map((item) => `${item.request.cases.join(",")}/${item.request.captures?.join(",") ?? "all"}`),
    ["build-alpha/skills", "build-alpha/all", "build-gamma/all", "career-beta/all"]);
  // The second attempt is built on the source the first one left.
  equal(readFileSync(join(run.wideningHost.builds[1]!.source, "Chummer", "frmCreate.cs"), "utf8"), repairedSource);
  equal(readFileSync(join(run.wideningHost.builds[1]!.source, "Chummer", "untracked.cs"), "utf8"), "fixed");
  equal(git(repository, "log", "--format=%s", `accepted/${threadId}`), `Fix discrepancy ${second}\nFix discrepancy ${first}\nSource captured by thread ${threadId}\ninitial`);
  deepStrictEqual({ head: git(repository, "rev-parse", "HEAD"), status: git(repository, "status", "--porcelain=v1") }, before);
  const state = await run.state(threadId);
  const tip = git(repository, "rev-parse", `accepted/${threadId}`);
  equal(state.accepted?.commit, tip);
  deepStrictEqual(state.accepted?.promoted, [first, second]);
  // Each fix commit was made on its widening's branch, the second on the first.
  equal(git(repository, "rev-parse", `workflow/${threadId}/widening/${second}/attempt-1`), tip);
  equal(git(repository, "rev-parse", `workflow/${threadId}/widening/${first}/attempt-1`), git(repository, "rev-parse", `${tip}~1`));
  equal(state.widenings[second]!.levels[2]!.outcome, "nothing-new");
  const document = documentOf(run.root, threadId);
  deepStrictEqual([document.totals.promoted, document.totals.rejected], [2, 0]);
  ok(existsSync(join(run.root, "threads", threadId, "widening", first, "attempt-1", "widening.json")));
  ok(run.lines.includes(`Widening ${second}: attempt 1 PROMOTED as ${tip} on accepted/${threadId}`));
  ok(run.lines.some((line) => line.startsWith(`Widening ${first} narrow execution: capture status 0, coverage valid, `)));
  ok(run.lines.includes(`Widening ${first} narrow visual: 1 passed, 0 failed (target 0, introduced 0, changed 0, pre-existing 0, unattributed 0); PASSED`));
  ok(run.lines.includes(`Widening ${second} mode: nothing new to capture`));
  ok(run.lines.some((line) => line.startsWith(`Widening: 2 attempts, 2 promoted, 0 rejected; accepted/${threadId} at ${tip}; `)));
  const label = EvalRecordSchema.parse((await run.store.get(recordNamespace("repair"), `${threadId}/${second}/repair/1`))!.value).labels.widening;
  deepStrictEqual([label?.outcome, label?.stage, label?.commit], ["promoted", null, tip]);
});

test("a level with a difference the patch brought rolls the attempt back, and its baseline capture serves the next cluster", async () => {
  const introduced = failAt(`widen ${first} character`, "build-alpha", "armor");
  const run = harness({
    script: {
      observe: (request, name, capture, baseline) => introduced(request, name, capture, baseline)
        ?? (request.label === `widen ${second} suite` && name === "build-alpha" && capture === "armor" ? { passed: false, candidate: [1] } : undefined),
    },
  });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  deepStrictEqual(run.wideningHost.labels(), [
    `widen ${first} narrow`, `widen ${first} character`, `widen ${first} character baseline`,
    `widen ${second} narrow`, `widen ${second} character`, `widen ${second} suite`,
  ]);
  const state = await run.state(threadId);
  const rejected = state.widenings[first]!;
  deepStrictEqual([rejected.status, rejected.rejection?.stage, rejected.rejection?.reason], ["rejected", "character", "build-alpha/armor introduced"]);
  ok(!existsSync(join(rejected.folder, "source")) && !existsSync(join(rejected.folder, "build")));
  // The rolled-back worktree is no longer registered, and its branch stays with the applied patch uncommitted on its start.
  ok(!git(run.sourceRepository, "worktree", "list", "--porcelain").includes(`widening/${first}`));
  equal(git(run.sourceRepository, "rev-parse", `workflow/${threadId}/widening/${first}/attempt-1`), git(run.sourceRepository, "rev-parse", `workflow/${threadId}/source`));
  // The second attempt starts from the snapshot, and its own new difference is attributed with the first one's baseline capture.
  equal(run.wideningHost.builtSources[run.wideningHost.builds.findIndex((build) => build.label === `widen ${second} build`)], "class frmCreate { int moved; }");
  deepStrictEqual(state.widenings[second]!.rejection, { stage: "suite", reason: "build-alpha/armor introduced", executionFailure: false });
  equal(state.widenings[second]!.levels[3]!.findings[0]!.baselineRun, run.wideningHost.captures[2]!.runFolder);
  equal(run.wideningHost.builds.filter((build) => build.label === "build accepted source").length, 1);
  equal(git(run.sourceRepository, "for-each-ref", `refs/heads/accepted/${threadId}`), "");
  equal(state.accepted?.commit, null);
  ok(run.lines.includes(`Widening ${first}: attempt 1 rejected at character: build-alpha/armor introduced`));
  ok(run.lines.some((line) => line.startsWith(`Widening ${first} character baseline execution: capture status 0, coverage valid`)));
  ok(run.lines.includes(`Widening ${first} character visual: 2 passed, 1 failed (target 0, introduced 1, changed 0, pre-existing 0, unattributed 0); FAILED`));
  const label = EvalRecordSchema.parse((await run.store.get(recordNamespace("repair"), `${threadId}/${first}/repair/1`))!.value).labels.widening;
  deepStrictEqual([label?.outcome, label?.stage, label?.commit], ["rejected", "character", null]);
});

test("after a promotion the promoted attempt's level runs are the baseline", async () => {
  const run = harness({ script: { observe: failAt(`widen ${second} suite`, "build-gamma", "armor") } });
  equal(await run.start(), 1);
  const state = await run.state(run.threadId());
  deepStrictEqual(state.widenings[second]!.rejection?.reason, "build-gamma/armor introduced");
  equal(state.widenings[second]!.levels[3]!.findings[0]!.baselineRun, run.wideningHost.captures[2]!.runFolder);
  ok(!run.wideningHost.captures.some((item) => item.baseline));
  equal(git(run.sourceRepository, "rev-list", "--count", `accepted/${run.threadId()}`), "3");
});

test("a difference with the same candidate pixels on the accepted build is pre-existing and stays listed", async () => {
  const run = harness({ spots: [twoClusters[0]!], script: { observe: failAt(`widen ${first} suite`, "career-beta", "armor", [3], "same") } });
  equal(await run.start(), 1);
  const widening: ClusterWidening = (await run.state(run.threadId())).widenings[first]!;
  equal(widening.status, "promoted");
  const finding = widening.levels[3]!.findings[0]!;
  deepStrictEqual([finding.case, finding.capture, finding.attribution], ["career-beta", "armor", "pre-existing"]);
  ok(run.lines.includes(`Widening ${first} suite visual: 2 passed, 1 failed (target 0, introduced 0, changed 0, pre-existing 1, unattributed 0); PASSED`));
  const stored = JSON.parse(readFileSync(join(widening.folder, "widening.json"), "utf8")) as ClusterWidening;
  equal(stored.levels[3]!.findings[0]!.attribution, "pre-existing");
});

test("the target still differing at a wider level, and a changed pre-existing difference, reject the attempt", async () => {
  const target = harness({ spots: [twoClusters[0]!], script: { observe: (request, name, capture) => (request.label === `widen ${first} character` && name === "build-alpha" && capture === "skills" ? { passed: false } : undefined) } });
  equal(await target.start(), 1);
  equal((await target.state(target.threadId())).widenings[first]!.rejection?.reason, "build-alpha/skills target");
  const changed = harness({
    spots: [twoClusters[0]!],
    script: { observe: (request, name, capture, baseline) => (name === "career-beta" && capture === "armor" ? { passed: false, candidate: baseline ? [1] : [1, 2, 3, 4, 5, 6, 7] } : undefined) },
  });
  equal(await changed.start(), 1);
  equal((await changed.state(changed.threadId())).widenings[first]!.rejection?.reason, "career-beta/armor changed");
});

test("execution failures of a level or of its baseline capture reject the attempt and make the status 2", async () => {
  const level = harness({ spots: [twoClusters[0]!], script: { status: (request) => (request.label === `widen ${first} narrow` ? 2 : undefined) } });
  equal(await level.start(), 2);
  const widening = (await level.state(level.threadId())).widenings[first]!;
  deepStrictEqual([widening.status, widening.rejection?.stage, widening.rejection?.executionFailure], ["rejected", "narrow", true]);
  ok(level.lines.some((line) => line.startsWith(`Widening ${first} narrow execution: capture status 2, coverage INVALID: failure:build-alpha/candidate`)));
  const baseline = harness({
    spots: [twoClusters[0]!],
    script: { observe: failAt(`widen ${first} character`, "build-alpha", "armor"), status: (_request, isBaseline) => (isBaseline ? 2 : undefined) },
  });
  equal(await baseline.start(), 2);
  const failed = (await baseline.state(baseline.threadId())).widenings[first]!;
  ok(failed.rejection?.reason.startsWith("execution failure in the baseline capture: capture status 2"));
  equal(failed.levels[1]!.baseline?.status, 2);
});

test("a build that fails rejects the attempt at stage build, and a build setup error ends the run", async () => {
  const failed = harness({ spots: [twoClusters[0]!], script: { build: (request) => (request.label.endsWith(" build") ? 1 : 0) } });
  equal(await failed.start(), 1);
  deepStrictEqual((await failed.state(failed.threadId())).widenings[first]!.rejection, { stage: "build", reason: "the widened source does not build; see build.log", executionFailure: false });
  equal(failed.wideningHost.captures.length, 0);
  const broken = harness({ spots: [twoClusters[0]!], script: { build: () => 3 } });
  equal(await broken.start(), 3);
  ok(broken.lines.some((line) => /the build script exited with 3/.test(line)));
});

test("a patch on a file an earlier promotion changed is rejected at stage apply", async () => {
  const run = harness({ sameFile: true });
  equal(await run.start(), 1);
  const state = await run.state(run.threadId());
  equal(state.widenings[first]!.status, "promoted");
  deepStrictEqual(state.widenings[second]!.rejection?.stage, "apply");
  ok(state.widenings[second]!.rejection?.reason.includes("Chummer/frmCreate.cs"));
  equal(run.wideningHost.builds.filter((build) => build.label === `widen ${second} build`).length, 0);
  // The rejected widening's branch stays, at the accepted commit it started from; its worktree is gone.
  const threadId = run.threadId();
  equal(git(run.sourceRepository, "rev-parse", `workflow/${threadId}/widening/${second}/attempt-1`), git(run.sourceRepository, "rev-parse", `accepted/${threadId}`));
  ok(!git(run.sourceRepository, "worktree", "list", "--porcelain").includes(`widening/${second}`));
});

test("a source branch that moved after the attempts were made is a setup error before any widening", async () => {
  // After the attempt's worktree is gone, the source branch reads as the attempt's own commit, as if someone moved it.
  let repaired = false;
  const moveSource = (inner: BranchGit): BranchGit => (args, options) => {
    if (args[0] === "worktree" && args[1] === "remove") repaired = true;
    if (repaired && args[0] === "for-each-ref" && /^refs\/heads\/workflow\/[^/]+\/source$/.test(args.at(-1) ?? "")) {
      return inner(["for-each-ref", "--format=%(objectname)", args.at(-1)!.replace(/\/source$/, `/repair/${first}/attempt-1`)], options);
    }
    return inner(args, options);
  };
  const run = harness({ spots: [twoClusters[0]!], git: moveSource });
  equal(await run.start(), 3);
  ok(run.lines.some((line) => /source branch workflow\/[^ ]+\/source is at [0-9a-f]+, which is neither the snapshot's commit/.test(line)), run.lines.join("\n"));
  equal(run.wideningHost.builds.length, 0);
  equal(git(run.sourceRepository, "for-each-ref", "refs/heads/accepted"), "");
});

test("--no-widening ends the run after repair", async () => {
  const run = harness();
  equal(await run.start({ noWidening: true }), 1);
  equal(run.wideningHost.captures.length, 0);
  ok(!existsSync(join(run.root, "threads", run.threadId(), "widening.json")));
  equal(git(run.sourceRepository, "for-each-ref", "refs/heads/accepted"), "");
  deepStrictEqual((await run.state(run.threadId())).widenings, {});
});

test("a run killed during a level resumes at that level", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const killed = harness({
    spots: [twoClusters[0]!],
    script: { status: (request) => (request.label === `widen ${first} mode` ? (setTimeout(() => controller.abort(), 10), "hang") : undefined) },
    extra: { checkpointer, store, signal: controller.signal },
  });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const resumed = harness({ spots: [twoClusters[0]!], extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
  equal(await resumed.resume(threadId), 1);
  deepStrictEqual(resumed.wideningHost.labels(), [`widen ${first} mode`, `widen ${first} suite`]);
  equal(resumed.wideningHost.builds.length, 0);
  equal((await resumed.state(threadId)).widenings[first]!.status, "promoted");
});

test("a run killed during a level stops inside the widen stage and resumes there", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  const controller = new AbortController();
  const killed = harness({
    spots: [twoClusters[0]!],
    script: { status: (request) => (request.label === `widen ${first} character` ? (setTimeout(() => controller.abort(), 10), "hang") : undefined) },
    extra: { checkpointer, store, signal: controller.signal },
  });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const stopped = await stoppedStage(killed.graph, threadId);
  deepStrictEqual([stopped.next, stopped.inner], [["widen"], ["widen"]]);
  ok(stopped.namespace.startsWith("widen:"), stopped.namespace);
  const resumed = harness({ spots: [twoClusters[0]!], extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
  equal(await resumed.resume(threadId), 1);
  // Neither diagnosis nor repair runs again, and the widening goes on at the interrupted level.
  equal(resumed.agents.calls.length, 0);
  equal(resumed.repairHost.builds.length, 0);
  deepStrictEqual(resumed.wideningHost.labels(), [`widen ${first} character`, `widen ${first} mode`, `widen ${first} suite`]);
  equal((await resumed.state(threadId)).widenings[first]!.status, "promoted");
});

test("a run killed after the promotion's commit resumes without a second commit", async () => {
  const checkpointer = new MemorySaver();
  const store = new InMemoryStore();
  let crashed = false;
  const crashAfterMove = (inner: BranchGit): BranchGit => (args, options) => {
    const output = inner(args, options);
    if (args[0] === "update-ref" && args[3]?.startsWith("refs/heads/accepted/") === true && !crashed) {
      crashed = true;
      throw new SetupError("the process died after the branch moved");
    }
    return output;
  };
  const killed = harness({ spots: [twoClusters[0]!], git: crashAfterMove, extra: { checkpointer, store } });
  equal(await killed.start(), 3);
  const threadId = killed.threadId();
  const tip = git(killed.sourceRepository, "rev-parse", `accepted/${threadId}`);
  const resumed = harness({ spots: [twoClusters[0]!], extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
  equal(await resumed.resume(threadId), 1);
  equal(resumed.wideningHost.captures.length, 0);
  equal(git(killed.sourceRepository, "rev-parse", `accepted/${threadId}`), tip);
  equal(git(killed.sourceRepository, "rev-list", "--count", `accepted/${threadId}`), "3");
  equal((await resumed.state(threadId)).widenings[first]!.commit, tip);
});

test("candidate runs with execution failures are no baseline, while valid ones are", async () => {
  const root = scratch();
  const run = harness({
    script: {
      observe: (request, name, capture, baseline) => failAt(`widen ${first} character`, "build-alpha", "armor", [1], "same")(request, name, capture, baseline)
        ?? failAt(`widen ${first} suite`, "career-beta", "armor", [3], "same")(request, name, capture, baseline),
    },
    extra: {
      root,
      extraSteps: {
        capture: async (_context, item) => {
          const runFolder = join(root, "runs", item.name);
          // The run of build-alpha ended with an execution failure, so its row for the armor capture (no candidate capture) says nothing.
          if (item.name === "build-alpha") writeRun(runFolder, [{ case: "build-alpha", capture: "armor", passed: false, candidate: null }]);
          else {
            writeRun(runFolder, [{ case: "career-beta", capture: "armor", passed: false, candidate: [3], mode: "career" }]);
            writeCoverage(runFolder, true);
          }
          return { case: item.name, status: 1 as const, runFolder, key: "k", reusedFrom: null };
        },
      },
    },
  });
  equal(await run.start(), 1);
  const labels = run.wideningHost.labels().filter((label) => label.startsWith(`widen ${first} `));
  deepStrictEqual(labels, [`widen ${first} narrow`, `widen ${first} character`, `widen ${first} character baseline`, `widen ${first} mode`, `widen ${first} suite`]);
  const widening = (await run.state(run.threadId())).widenings[first]!;
  equal(widening.status, "promoted");
  deepStrictEqual(widening.levels[1]!.findings.map((finding) => finding.attribution), ["pre-existing"]);
  deepStrictEqual(widening.levels[3]!.findings.map((finding) => [finding.case, finding.attribution, finding.baselineRun === run.wideningHost.captures[2]!.runFolder]), [["career-beta", "pre-existing", false]]);
});

test("a widened source that stages the accepted tree is rejected at stage promote and the next cluster is widened", async () => {
  // The first cluster's widened worktree is set back to its start before the promotion stages it, as when the patch
  // differed only in line endings the repository normalises: it stages the accepted tree.
  const setBack = (inner: BranchGit): BranchGit => (args, options) => {
    if (args[0] === "add" && options?.worktree?.includes(join("widening", first)) === true) inner(["checkout", "--quiet", "HEAD", "--", "."], options);
    return inner(args, options);
  };
  const run = harness({ git: setBack });
  equal(await run.start(), 1);
  const threadId = run.threadId();
  const state = await run.state(threadId);
  deepStrictEqual(state.widenings[first]!.rejection, {
    stage: "promote", reason: "the widened source stages the same tree as the accepted source, so there is nothing to commit", executionFailure: false,
  });
  equal(state.widenings[first]!.status, "rejected");
  ok(!existsSync(join(state.widenings[first]!.folder, "source")));
  equal(state.widenings[second]!.status, "promoted");
  deepStrictEqual(state.accepted?.promoted, [second]);
  equal(git(run.sourceRepository, "log", "--format=%s", `accepted/${threadId}`), `Fix discrepancy ${second}\nSource captured by thread ${threadId}\ninitial`);
  const label = EvalRecordSchema.parse((await run.store.get(recordNamespace("repair"), `${threadId}/${first}/repair/1`))!.value).labels.widening;
  deepStrictEqual([label?.outcome, label?.stage], ["rejected", "promote"]);
});

test("a rollback does not need the accepted branch, which a user may have deleted", async () => {
  let moved = 0;
  const deleteAfterPromotion = (inner: BranchGit): BranchGit => (args, options) => {
    const output = inner(args, options);
    if (args[0] === "update-ref" && args[3]?.startsWith("refs/heads/accepted/") === true && ++moved === 1) inner(["update-ref", "-d", args[3]!], options);
    return output;
  };
  const run = harness({ git: deleteAfterPromotion, script: { observe: failAt(`widen ${second} suite`, "build-gamma", "armor") } });
  equal(await run.start(), 1);
  const state = await run.state(run.threadId());
  equal(state.widenings[first]!.status, "promoted");
  deepStrictEqual([state.widenings[second]!.status, state.widenings[second]!.rejection?.stage], ["rejected", "suite"]);
});

test("level and baseline captures stop when an input of the thread changed since it started", async () => {
  const environment = harness({
    spots: [twoClusters[0]!],
    // The thread started under environment-1.
    inputs: { environment: async () => "environment-2", changed: async () => [] },
  });
  equal(await environment.start(), 3);
  equal(environment.wideningHost.captures.length, 0);
  ok(environment.lines.some((line) => line.includes(`widen ${first} narrow: inputs changed since the thread started (environment); start a new thread.`)));
  const files = harness({ spots: [twoClusters[0]!], inputs: { environment: async () => "environment-1", changed: async () => ["overlay", "captureTools"] } });
  equal(await files.start(), 3);
  equal(files.wideningHost.captures.length, 0);
  ok(files.lines.some((line) => line.includes("inputs changed since the thread started (overlay, captureTools)")));
});

test("a level run that covered a case that was not selected is a setup error", async () => {
  const run = harness({ spots: [twoClusters[0]!], script: { alsoCovered: (request) => (request.label === `widen ${first} narrow` ? ["build-delta"] : []) } });
  equal(await run.start(), 3);
  ok(run.lines.some((line) => line.includes(`widen ${first} narrow ran 2 cases (build-alpha, build-delta)`)));
  equal((await run.state(run.threadId())).widenings[first]!.levels.length, 0);
});
