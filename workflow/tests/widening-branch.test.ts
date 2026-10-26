import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSourceSnapshot, processGit } from "../src/diagnosis/source-snapshot.js";
import { processBranchGit } from "../src/git/branch-git.js";
import { threadBranches, threadSource } from "../src/git/thread-source.js";
import { Worktrees } from "../src/git/worktrees.js";
import { SetupError } from "../src/host/setup-error.js";
import { AcceptedBranch, promote, type Promotion } from "../src/widening/accepted-branch.js";
import { staleFiles } from "../src/widening/widening-service.js";
import { repository, scratch, write } from "./diagnosis-fixtures.js";

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** What a promotion must leave alone: the checked-out commit, the index and the working tree's status. */
function untouched(root: string) {
  return { head: git(root, "rev-parse", "HEAD"), index: git(root, "write-tree"), status: git(root, "status", "--porcelain=v1", "--untracked-files=all") };
}

/** A promotion that is expected to make a commit. */
function committed(promotion: Promotion): string {
  const commit = promote(promotion);
  if (commit === null) throw new Error("The promotion had nothing to commit.");
  return commit;
}

/** The fixture repository (with uncommitted edits unless `clean`), its snapshot, the thread's source commit and its worktrees. */
async function thread(threadId: string, clean = false) {
  const repo = repository();
  if (clean) {
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "everything");
  }
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  const branchGit = processBranchGit(repo);
  const worktrees = new Worktrees(branchGit, repo);
  const before = untouched(repo);
  const source = threadSource(branchGit, threadId, snapshot.commit, snapshot.folder, join(scratch(), "source.index"));
  const branch = new AcceptedBranch(branchGit, threadId);
  /** A widened worktree at `start` on the cluster's widening branch, with `edits` written into it. */
  const widened = (clusterId: string, start: string, edits: Readonly<Record<string, string>> = {}) => {
    const folder = join(scratch(), "source");
    worktrees.add(folder, threadBranches.widening(threadId, clusterId, 1), start);
    for (const [path, text] of Object.entries(edits)) write(folder, path, text);
    return folder;
  };
  const promotion = (clusterId: string, worktree: string, accepted: string | null, start = accepted ?? source): Promotion => ({
    branch, worktrees, accepted, start, worktree, trailers: { thread: threadId, cluster: clusterId, record: `${threadId}/${clusterId}/repair/1` }, summary: `Fixed ${clusterId}.`,
  });
  return { repo, snapshot, branchGit, worktrees, before, source, branch, widened, promotion };
}

test("the thread's source commit holds the snapshot's uncommitted edits on the snapshot's commit, without touching the repository", async () => {
  const run = await thread("wf-1");
  deepStrictEqual(untouched(run.repo), run.before);
  equal(git(run.repo, "rev-parse", "workflow/wf-1/source"), run.source);
  equal(git(run.repo, "rev-parse", `${run.source}~1`), run.snapshot.commit);
  equal(git(run.repo, "log", "-1", "--format=%s", run.source), "Source captured by thread wf-1");
  // The edit, the untracked file and the deletion are in it; the ignored file is not.
  equal(git(run.repo, "show", `${run.source}:Chummer/frmCreate.cs`), "class frmCreate { int moved; }");
  equal(git(run.repo, "ls-tree", "-r", "--name-only", run.source),
    [".gitignore", "Chummer/frmCreate.cs", "Chummer/untracked.cs", "Core/XmlManager.cs", "README.md", "bin/ChummerGenSR4.exe", "bin/data/skills.xml", "bin/lang/en-us.xml"].join("\n"));
  // Asked again, or with another snapshot, the existing branch is the source.
  write(run.snapshot.folder, "Chummer/frmCreate.cs", "class frmCreate { int later; }");
  equal(threadSource(run.branchGit, "wf-1", run.snapshot.commit, run.snapshot.folder, join(scratch(), "source.index")), run.source);
});

test("a snapshot equal to its commit is the source commit itself, and a snapshot without Core/ is a setup error", async () => {
  const run = await thread("wf-2", true);
  equal(run.source, run.snapshot.commit);
  equal(git(run.repo, "rev-parse", "workflow/wf-2/source"), run.snapshot.commit);
  rmSync(join(run.snapshot.folder, "Core"), { recursive: true });
  throws(() => threadSource(run.branchGit, "wf-3", run.snapshot.commit, run.snapshot.folder, join(scratch(), "source.index")),
    (error) => error instanceof SetupError && /has no Core\/, which the candidate is compiled from/.test(error.message));
  equal(git(run.repo, "for-each-ref", "refs/heads/workflow/wf-3"), "");
});

test("the first promotion commits the widened worktree on the source commit and moves the accepted branch, leaving the repository alone", async () => {
  const run = await thread("wf-4");
  const worktree = run.widened("d-1", run.source, { "Chummer/frmCreate.cs": "class frmCreate { int restored; }" });
  const fix = committed(run.promotion("d-1", worktree, null));
  deepStrictEqual(untouched(run.repo), run.before);
  equal(run.branch.tip(), fix);
  equal(git(run.repo, "rev-parse", threadBranches.widening("wf-4", "d-1", 1)), fix);
  equal(git(run.repo, "log", "--format=%s", "accepted/wf-4"), "Fix discrepancy d-1\nSource captured by thread wf-4\ninitial");
  equal(git(run.repo, "diff", "--name-only", run.source, fix), "Chummer/frmCreate.cs");
  equal(run.branch.repairRecord(fix), "wf-4/d-1/repair/1");
  ok(git(run.repo, "log", "-1", "--format=%B", fix).includes("Fixed d-1.\n\nWorkflow-Thread: wf-4\nDiscrepancy: d-1\nRepair-Record: wf-4/d-1/repair/1"));

  // Resumed after the branch moved: the same commit, nothing new.
  equal(promote(run.promotion("d-1", worktree, null)), fix);
  equal(git(run.repo, "rev-list", "--count", "accepted/wf-4"), "3");

  // A second promotion stacks on the first, in a worktree started at the accepted commit.
  const second = run.widened("d-2", fix, { "Core/XmlManager.cs": "class XmlManager { int restored; }" });
  const next = committed(run.promotion("d-2", second, fix));
  equal(git(run.repo, "rev-parse", `${next}~1`), fix);
  equal(git(run.repo, "diff", "--name-only", fix, next), "Core/XmlManager.cs");
  deepStrictEqual(untouched(run.repo), run.before);

  // A branch moved by something else is a setup error, and nothing is committed.
  git(run.repo, "update-ref", run.branch.ref, run.source);
  const third = run.widened("d-3", next, { "Chummer/untracked.cs": "fixed" });
  throws(() => promote(run.promotion("d-3", third, next)), (error) => error instanceof SetupError && /something else moved it/.test(error.message));
  equal(run.branch.tip(), run.source);
  equal(run.worktrees.head(third), next);
});

test("a promotion killed after its commit and before the branch moved takes the worktree's commit", async () => {
  const run = await thread("wf-5");
  const worktree = run.widened("d-1", run.source, { "Chummer/frmCreate.cs": "class frmCreate { int restored; }" });
  run.worktrees.stage(worktree);
  const made = run.worktrees.commitStaged(worktree, `Fix discrepancy d-1\n\nWorkflow-Thread: wf-5\nDiscrepancy: d-1\nRepair-Record: wf-5/d-1/repair/1\n`);
  equal(run.branch.tip(), null);
  equal(promote(run.promotion("d-1", worktree, null)), made);
  equal(run.branch.tip(), made);
  equal(git(run.repo, "rev-list", "--count", "accepted/wf-5"), "3");
});

test("a widened worktree that stages the accepted tree has nothing to commit", async () => {
  const run = await thread("wf-6");
  // The file written again with the content it had: the worktree stages the tree it started at.
  const worktree = run.widened("d-1", run.source, { "Chummer/frmCreate.cs": "class frmCreate { int moved; }" });
  equal(promote(run.promotion("d-1", worktree, null)), null);
  equal(run.branch.tip(), null);
  equal(run.worktrees.head(worktree), run.source);
});

test("a widened worktree without Core/ is a setup error and makes no commit", async () => {
  const run = await thread("wf-7");
  const worktree = run.widened("d-1", run.source, { "Chummer/frmCreate.cs": "class frmCreate { int restored; }" });
  rmSync(join(worktree, "Core"), { recursive: true });
  throws(() => promote(run.promotion("d-1", worktree, null)), (error) => error instanceof SetupError && /has no Core\/, which the candidate is compiled from/.test(error.message));
  equal(run.branch.tip(), null);
  equal(run.worktrees.head(worktree), run.source);
});

test("a fix change beside an unchanged Chummer/ makes no commit, and goes into the fix commit beside a change", async () => {
  const run = await thread("wf-8");
  const worktree = run.widened("d-1", run.source, { "fixes/openspec/changes/archive/2026-10-02-fix-d-1/fix.json": "{}" });
  equal(promote(run.promotion("d-1", worktree, null)), null);
  equal(run.branch.tip(), null);
  write(worktree, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  const fix = committed(run.promotion("d-1", worktree, null));
  deepStrictEqual(git(run.repo, "diff", "--name-only", run.source, fix).split("\n").sort(), ["Chummer/frmCreate.cs", "fixes/openspec/changes/archive/2026-10-02-fix-d-1/fix.json"]);
});

test("an attempt commit applies only where the accepted commit still has what it changed", async () => {
  const run = await thread("wf-9");
  // The attempt: an edit, an added file and a deletion on the source commit.
  const attempt = join(scratch(), "source");
  run.worktrees.add(attempt, threadBranches.attempt("wf-9", "d-2", 1), run.source);
  write(attempt, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  write(attempt, "Chummer/added.cs", "added");
  rmSync(join(attempt, "Chummer", "untracked.cs"));
  const commit = run.worktrees.commitAll(attempt, "Repair attempt 1 of discrepancy d-2\n")!;
  run.worktrees.remove(attempt);
  deepStrictEqual(staleFiles(run.worktrees, commit, run.source), []);
  // An earlier promotion changed frmCreate.cs, added added.cs and left untracked.cs alone.
  const earlier = run.widened("d-1", run.source, { "Chummer/frmCreate.cs": "class frmCreate { int other; }", "Chummer/added.cs": "other" });
  const accepted = committed(run.promotion("d-1", earlier, null));
  deepStrictEqual(staleFiles(run.worktrees, commit, accepted), ["Chummer/added.cs", "Chummer/frmCreate.cs"]);
  // A promotion that only touched another file leaves the attempt applicable.
  const unrelated = run.widened("d-3", run.source, { "Core/XmlManager.cs": "class XmlManager { int other; }" });
  const elsewhere = committed({ ...run.promotion("d-3", unrelated, null), branch: new AcceptedBranch(run.branchGit, "wf-9b") });
  notEqual(elsewhere, accepted);
  deepStrictEqual(staleFiles(run.worktrees, commit, elsewhere), []);
});
