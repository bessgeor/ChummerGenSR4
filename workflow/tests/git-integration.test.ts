import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { processBranchGit, type BranchGit } from "../src/git/branch-git.js";
import { headBranch, integrate, type MergeItem } from "../src/git/integration.js";
import { Worktrees } from "../src/git/worktrees.js";
import { SetupError } from "../src/host/setup-error.js";
import { scratch, write } from "./diagnosis-fixtures.js";

/** A repository on `main` with two files, and a way to make a commit on a given parent that changes files. */
function repositoryOnMain() {
  const root = scratch("workflow-integration-");
  const run = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("config", "core.autocrlf", "false");
  write(root, "Chummer/frmCreate.cs", "create\n");
  write(root, "Core/XmlManager.cs", "xml\n");
  run("add", "-A");
  run("commit", "-q", "-m", "initial");
  const start = run("rev-parse", "HEAD");
  const git = processBranchGit(root);
  const worktrees = new Worktrees(git, root);
  /** A commit on `parent` with `edits`, made in a detached worktree, so the repository's checkout stays as it is. */
  const commitOn = (parent: string, subject: string, edits: Readonly<Record<string, string>>) => {
    const folder = join(scratch(), "commit");
    worktrees.addDetached(folder, parent);
    for (const [path, text] of Object.entries(edits)) write(folder, path, text);
    const commit = worktrees.commitAll(folder, `${subject}\n`)!;
    worktrees.remove(folder);
    return commit;
  };
  const item = (name: string, commit: string): MergeItem => ({
    name, commit, branch: `workflow/wf-1/fix/${name}`, subject: `Merge fix for discrepancy ${name}`,
    trailer: { key: "Merged-Fix", value: `wf-1/${name}` }, trailers: [{ key: "Workflow-Thread", value: "wf-1" }],
  });
  const request = (items: readonly MergeItem[], branch = "main") => ({ branch, items, worktree: join(scratch(), "merge"), integrationBranch: "workflow/wf-1/integration" });
  return { root, run, git, worktrees, start, commitOn, item, request };
}

test("each commit is rebased onto the branch's tip and merged with a merge commit, and the checked-out branch is fast-forwarded", () => {
  const repo = repositoryOnMain();
  // Two fixes made one on the other, while main moved on in another file.
  const first = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  const second = repo.commitOn(first, "Fix d-2", { "Chummer/added.cs": "added\n" });
  write(repo.root, "README.md", "moved on\n");
  repo.run("add", "README.md");
  repo.run("commit", "-q", "-m", "main moved");
  const before = repo.run("rev-parse", "main");
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", first), repo.item("d-2", second)]));
  deepStrictEqual(result.items.map((item) => [item.name, item.status]), [["d-1", "merged"], ["d-2", "merged"]]);
  deepStrictEqual([result.before, result.after, result.integrationBranch], [before, repo.run("rev-parse", "main"), "workflow/wf-1/integration"]);
  equal(repo.run("rev-parse", "workflow/wf-1/integration"), result.after);
  equal(result.items[1]!.mergeCommit, result.after);
  // Each merge commit has the tip before it as its first parent and the rebased fix as its second.
  equal(repo.run("rev-parse", `${result.items[0]!.mergeCommit}^1`), before);
  equal(repo.run("rev-parse", `${result.items[0]!.mergeCommit}^2`), repo.run("rev-parse", "workflow/wf-1/fix/d-1"));
  equal(repo.run("rev-parse", `${result.items[1]!.mergeCommit}^1`), result.items[0]!.mergeCommit);
  equal(repo.run("rev-parse", "workflow/wf-1/fix/d-2~1"), result.items[0]!.mergeCommit);
  equal(repo.run("log", "-1", "--format=%s%n%(trailers:only,unfold)", result.after), "Merge fix for discrepancy d-2\nWorkflow-Thread: wf-1\nMerged-Fix: wf-1/d-2");
  // The checked-out working tree has both fixes and the other change; nothing is left uncommitted.
  equal(repo.run("show", "HEAD:Chummer/frmCreate.cs"), "create fixed");
  equal(repo.run("status", "--porcelain=v1"), "");
  equal(repo.worktrees.list().length, 1);

  // Asked again, as a resumed thread would: both were merged before, and the branch stays.
  const again = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", first), repo.item("d-2", second)]));
  deepStrictEqual(again.items.map((item) => [item.status, item.reason, item.mergeCommit]), [["merged", "merged before", result.items[0]!.mergeCommit], ["merged", "merged before", result.after]]);
  deepStrictEqual([again.before, again.after, again.integrationBranch], [result.after, result.after, null]);
});

test("a commit that does not rebase cleanly is not merged, nor any after it", () => {
  const repo = repositoryOnMain();
  const first = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  const second = repo.commitOn(first, "Fix d-2", { "Core/XmlManager.cs": "xml fixed\n" });
  write(repo.root, "Chummer/frmCreate.cs", "create changed on main\n");
  repo.run("commit", "-q", "-am", "main changed the same line");
  const before = repo.run("rev-parse", "main");
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", first), repo.item("d-2", second)]));
  deepStrictEqual(result.items.map((item) => [item.name, item.status, item.files]), [["d-1", "conflict", ["Chummer/frmCreate.cs"]], ["d-2", "blocked", []]]);
  ok(result.items[0]!.reason!.includes("Chummer/frmCreate.cs"));
  ok(result.items[1]!.reason!.startsWith("d-1 did not merge"));
  deepStrictEqual([result.after, result.integrationBranch], [before, null]);
  equal(repo.run("rev-parse", "main"), before);
  equal(repo.run("status", "--porcelain=v1"), "");
  equal(repo.worktrees.list().length, 1);
});

test("a rebase that fails without a conflict is an error, not a conflict, and leaves no rebase behind", () => {
  const repo = repositoryOnMain();
  const first = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  write(repo.root, "README.md", "moved on\n");
  repo.run("add", "README.md");
  repo.run("commit", "-q", "-m", "main moved");
  const before = repo.run("rev-parse", "main");
  // The replay has to write a commit, and signing it fails.
  repo.run("config", "commit.gpgsign", "true");
  repo.run("config", "gpg.program", "node");
  const request = repo.request([repo.item("d-1", first)]);
  throws(() => integrate(repo.git, repo.worktrees, request), (error) => error instanceof SetupError && /rebase/.test(error.message));
  equal(repo.run("rev-parse", "main"), before);
  equal(repo.worktrees.list().length, 1);
  equal(repo.run("for-each-ref", "refs/heads/workflow/wf-1/integration"), "");
});

test("a branch no worktree has checked out is moved by compare-and-swap, and one that moved meanwhile is a setup error", () => {
  const repo = repositoryOnMain();
  repo.run("branch", "release");
  const fix = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)], "release"));
  equal(repo.run("rev-parse", "release"), result.after);
  equal(repo.run("rev-parse", "main"), repo.start);
  equal(repo.run("status", "--porcelain=v1"), "");

  // Another commit lands on the branch while the merges are made: they stay on the integration branch.
  const other = repo.commitOn(result.after, "Elsewhere", { "README.md": "other\n" });
  let moved = false;
  const moving: BranchGit = (args, options) => {
    const output = repo.git(args, options);
    if (args[0] === "update-ref" && args[3] === "refs/heads/workflow/wf-1/integration" && !moved) {
      moved = true;
      repo.git(["update-ref", "refs/heads/release", other]);
    }
    return output;
  };
  const next = repo.commitOn(repo.start, "Fix d-2", { "Core/XmlManager.cs": "xml fixed\n" });
  throws(() => integrate(moving, new Worktrees(moving, repo.root), repo.request([repo.item("d-1", fix), repo.item("d-2", next)], "release")),
    (error) => error instanceof SetupError && /moved to/.test(error.message) && error.message.includes("workflow/wf-1/integration"));
  equal(repo.run("rev-parse", "release"), other);
  equal(repo.run("log", "-1", "--format=%(trailers:key=Merged-Fix,valueonly)", "workflow/wf-1/integration"), "wf-1/d-2");
});

test("a fast-forward git refuses for local changes is a setup error naming the integration branch, and the branch stays", () => {
  const repo = repositoryOnMain();
  const fix = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  write(repo.root, "Chummer/frmCreate.cs", "local edit\n");
  throws(() => integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)])),
    (error) => error instanceof SetupError && /could not be advanced/.test(error.message) && error.message.includes("workflow/wf-1/integration"));
  equal(repo.run("rev-parse", "main"), repo.start);
  equal(repo.run("diff", "--name-only"), "Chummer/frmCreate.cs");
  // Once the local edit is gone, the same merges complete: the merge on the integration branch is made again on the same tip.
  repo.run("checkout", "--", "Chummer/frmCreate.cs");
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  equal(result.items[0]!.status, "merged");
  equal(repo.run("rev-parse", "main"), result.after);
});

test("headBranch names the checked-out branch, or none when HEAD is detached", () => {
  const repo = repositoryOnMain();
  deepStrictEqual(headBranch(repo.git), { branch: "main", commit: repo.start });
  repo.run("checkout", "-q", "--detach");
  deepStrictEqual(headBranch(repo.git), { branch: null, commit: repo.start });
});

test("a worktree is found by its folder whether the folder is named by its long or its 8.3 short name", { skip: process.platform !== "win32" ? "8.3 short names exist on Windows only" : false }, () => {
  const repo = repositoryOnMain();
  const folder = join(scratch("workflow-long-folder-name-"), "attempt-with-a-long-name");
  repo.worktrees.add(folder, "workflow/wf-1/attempt", repo.start);
  const short = execSync(`for %I in ("${folder}") do @echo %~sI`, { shell: "cmd.exe", encoding: "utf8" }).trim();
  if (short.toLowerCase() === folder.toLowerCase()) throw new Error(`The volume gives ${folder} no 8.3 short name.`);
  equal(repo.worktrees.state(short).branch, "workflow/wf-1/attempt");
  repo.worktrees.remove(short);
  equal(existsSync(folder), false);
  equal(repo.worktrees.list().length, 1);
});