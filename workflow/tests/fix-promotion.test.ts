import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { openSpecArchiver, processOpenSpecCli, type FixChangeArchiver } from "../src/fixes/fix-archiver.js";
import { FixRecordSchema } from "../src/fixes/fix-record.js";
import { SetupError } from "../src/host/setup-error.js";
import type { BranchGit } from "../src/git/branch-git.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters, type JobCall, type Reply } from "./diagnosis-harness.js";
import { repositoryRoot } from "./fix-fixtures.js";
import { FakeRepairHost, patchedReply, repairedSource } from "./repair-fixtures.js";
import { FakeWideningHost, type WideningScript } from "./widening-fixtures.js";

const cluster = "d-0000000000000100";

/** Diagnosis confirms the cluster; a plan with one subtask, or the single repair job, restores frmCreate.cs. */
function agents(): FakeAgents {
  return new FakeAgents((call: JobCall): Reply => {
    if (call.kind !== "repair") return { answer: call.kind === "challenge" ? challengeAnswer() : hypothesisAnswer() };
    if (call.prompt.startsWith("PROMPT_VERSION=repair-plan-v2")) {
      return { answer: { outcome: "planned", reason: "One location.", summary: "Restore the label.", tasks: [{ id: 1, title: "Restore", instructions: "Move it back.", files: ["Chummer/frmCreate.cs"], blockedBy: [] }] } };
    }
    return patchedReply({ "Chummer/frmCreate.cs": repairedSource })(call);
  });
}

type Options = {
  readonly script?: WideningScript;
  readonly git?: (git: BranchGit) => BranchGit;
  readonly archive?: FixChangeArchiver;
  readonly extra?: Partial<Parameters<typeof diagnosisHarness>[0]>;
};

function harness(options: Options = {}) {
  return diagnosisHarness({
    spots: [twoClusters[0]!], agents: agents(),
    repair: { deadlineMinutes: 60, host: (root) => new FakeRepairHost(root) },
    widening: {
      host: (root, names) => new FakeWideningHost(root, names, options.script ?? {}), extraCases: ["gamma"],
      ...(options.git === undefined ? {} : { git: options.git }), ...(options.archive === undefined ? {} : { archive: options.archive }),
    },
    ...options.extra,
  });
}

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

test("with fix changes the fix commit holds the archived fix change beside Chummer/, and the working tree stays as it was", async () => {
  const run = harness();
  const repository = run.sourceRepository;
  const before = { head: git(repository, "rev-parse", "HEAD"), status: git(repository, "status", "--porcelain=v1") };
  equal(await run.start({ fixChanges: true }), 1);
  const threadId = run.threadId();
  const branch = `accepted/${threadId}`;
  const name = `fix-${cluster}-${threadId.slice(-8)}`;
  const files = git(repository, "ls-tree", "-r", "--name-only", branch).split("\n");
  const archived = files.filter((path) => path.startsWith("fixes/"));
  equal(archived.length, 5);
  const folder = archived[0]!.split("/").slice(0, 5).join("/");
  match(folder, new RegExp(`^fixes/openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${name}$`));
  deepStrictEqual(archived.map((path) => path.slice(folder.length + 1)).sort(), [".openspec.yaml", "fix.json", "proposal.md", "tasks.md", "verification.md"]);
  // Only the fix commit holds it; the commit of the snapshot does not.
  equal(git(repository, "diff", "--name-only", `${branch}~1`, branch), [`Chummer/frmCreate.cs`, ...archived.sort()].sort().join("\n"));
  equal(git(repository, "show", `${branch}:Chummer/frmCreate.cs`), repairedSource);
  const record = FixRecordSchema.parse(JSON.parse(git(repository, "show", `${branch}:${folder}/fix.json`)));
  deepStrictEqual(record.widening?.map((level) => [level.level, level.outcome]), [["narrow", "passed"], ["character", "passed"], ["mode", "passed"], ["suite", "passed"]]);
  deepStrictEqual([record.name, record.tasks.length, record.plan.recordId], [name, 1, `${threadId}/${cluster}/repair/1`]);
  match(git(repository, "show", `${branch}:${folder}/verification.md`), /### suite\n\n- Cases: `career-beta`; captures: all\.\n- Level run `\d+`: execution status 0/);
  match(git(repository, "show", `${branch}:${folder}/tasks.md`), /- \[x\] 1\.1 "Restore"\. Files: `Chummer\/frmCreate\.cs`\. Blocked by: none\./);
  deepStrictEqual({ head: git(repository, "rev-parse", "HEAD"), status: git(repository, "status", "--porcelain=v1") }, before);
  // The CLI's own check of the archive it wrote: every task is done.
  const staging = join(run.root, "threads", threadId, "widening", cluster, "attempt-1", "fix-change");
  match(processOpenSpecCli(repositoryRoot)(["validate", "--archived"], staging), /1 passed, 0 failed/);
  ok(run.lines.some((line) => line.startsWith(`widen ${cluster}: fix change `) && line.endsWith(`${name} archived for the fix commit.`)));
});

test("without fix changes the fix commit holds Chummer/ only", async () => {
  const run = harness();
  equal(await run.start(), 1);
  const branch = `accepted/${run.threadId()}`;
  equal(git(run.sourceRepository, "diff", "--name-only", `${branch}~1`, branch), "Chummer/frmCreate.cs");
  ok(!run.agents.calls.some((call) => call.prompt.startsWith("PROMPT_VERSION=repair-plan-v2")));
});

/** Kills the run at the accepted branch's first move: after the ref update, or before it, once the fix commit was made. */
function crashAtMove(after: boolean): (inner: BranchGit) => BranchGit {
  let crashed = false;
  return (inner) => (args, options) => {
    if (args[0] !== "update-ref" || args[3]?.startsWith("refs/heads/accepted/") !== true || crashed) return inner(args, options);
    crashed = true;
    if (after) inner(args, options);
    throw new SetupError(`the process died ${after ? "after" : "before"} the branch moved`);
  };
}

test("a promotion resumed after its commit takes the commit and archives nothing again", async () => {
  for (const after of [true, false]) {
    const checkpointer = new MemorySaver();
    const store = new InMemoryStore();
    const killed = harness({ git: crashAtMove(after), extra: { checkpointer, store } });
    equal(await killed.start({ fixChanges: true }), 3);
    const threadId = killed.threadId();
    const widened = `workflow/${threadId}/widening/${cluster}/attempt-1`;
    // The fix commit is on the widening's branch; the accepted branch has it only when the ref was updated.
    const fix = git(killed.sourceRepository, "rev-parse", widened);
    equal(git(killed.sourceRepository, "for-each-ref", "--format=%(objectname)", `refs/heads/accepted/${threadId}`), after ? fix : "");
    let archived = 0;
    const real = openSpecArchiver(processOpenSpecCli(repositoryRoot));
    const counting: FixChangeArchiver = (request) => {
      archived++;
      return real(request);
    };
    const resumed = harness({ archive: counting, extra: { checkpointer, store, root: killed.root, repository: killed.sourceRepository } });
    equal(await resumed.resume(threadId), 1);
    equal(archived, 0, `after: ${after}`);
    equal(git(killed.sourceRepository, "rev-parse", `accepted/${threadId}`), fix);
    equal(git(killed.sourceRepository, "rev-parse", widened), fix);
    equal(git(killed.sourceRepository, "rev-list", "--count", `accepted/${threadId}`), "3");
    ok(git(killed.sourceRepository, "ls-tree", "-r", "--name-only", fix).includes("fixes/openspec/changes/archive/"));
  }
});

test("a passed attempt without its draft cannot be promoted with fix changes", async () => {
  const run = harness({
    script: {
      // Before the widened build: the attempt's draft goes missing.
      build: (request) => {
        rmSync(join(request.source, "..", "..", "..", "..", "repair", cluster, "attempt-1", "fix"), { recursive: true, force: true });
        return 0;
      },
    },
  });
  equal(await run.start({ fixChanges: true }), 3);
  ok(run.lines.some((line) => /has no fix change draft \(fix\/fix\.json\)/.test(line)), run.lines.join("\n"));
  equal(git(run.sourceRepository, "branch", "--list", `accepted/${run.threadId()}`), "");
});
