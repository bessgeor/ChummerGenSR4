import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GitCommandError, processBranchGit, type BranchGit } from "../src/git/branch-git.js";
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
  // The conflicting fix's branch holds the fix commit.
  equal(repo.run("rev-parse", "workflow/wf-1/fix/d-1"), first);
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

test("the checked-out branch's files are written with the repository's line-ending settings when it is fast-forwarded", () => {
  const repo = repositoryOnMain();
  repo.run("config", "core.autocrlf", "true");
  const fix = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create\nfixed\n" });
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  equal(repo.run("rev-parse", "main"), result.after);
  equal(readFileSync(join(repo.root, "Chummer/frmCreate.cs"), "utf8"), "create\r\nfixed\r\n");
  equal(repo.run("status", "--porcelain"), "");
});

test("headBranch names the checked-out branch, or none when HEAD is detached", () => {
  const repo = repositoryOnMain();
  deepStrictEqual(headBranch(repo.git), { branch: "main", commit: repo.start });
  // A tag of the same name makes git's short name `heads/main`.
  repo.run("tag", "main");
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

test("a worktree git refuses to remove and that stays registered is an error with git's message, and one whose folder could be deleted is not", () => {
  const repo = repositoryOnMain();
  const refusing: BranchGit = (args, options) => {
    if (args[0] === "worktree" && args[1] === "remove") throw new GitCommandError("git worktree remove failed: refused", 128, "", "refused");
    return repo.git(args, options);
  };
  const worktrees = new Worktrees(refusing, repo.root);
  const free = join(scratch(), "free");
  repo.worktrees.add(free, "workflow/wf-1/free", repo.start);
  worktrees.remove(free);
  equal(existsSync(free), false);
  equal(repo.worktrees.list().length, 1);
  const locked = join(scratch(), "locked");
  repo.worktrees.add(locked, "workflow/wf-1/locked", repo.start);
  repo.run("worktree", "lock", locked);
  throws(() => worktrees.remove(locked), (error) => error instanceof GitCommandError && /refused/.test(error.message));
  equal(repo.worktrees.list().some((item) => item.branch === "workflow/wf-1/locked"), true);
});
test("fixes made on a source that held uncommitted edits are not merged into a branch that lacks the edits, and are once it has them", () => {
  const repo = repositoryOnMain();
  const source = repo.commitOn(repo.start, "Source captured by thread wf-1", { "Core/XmlManager.cs": "xml edited\n" });
  // The fix changes another file than the edit.
  const fix = repo.commitOn(source, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  const later = repo.commitOn(fix, "Fix d-2", { "Chummer/added.cs": "added\n" });
  const items = [repo.item("d-1", fix), repo.item("d-2", later)];
  const blocked = integrate(repo.git, repo.worktrees, repo.request(items));
  deepStrictEqual(blocked.items.map((item) => [item.name, item.status, item.mergeCommit]), [["d-1", "blocked", null], ["d-2", "blocked", null]]);
  ok(blocked.items[0]!.reason!.includes("Core/XmlManager.cs") && blocked.items[0]!.reason!.includes("main lacks"));
  deepStrictEqual([blocked.after, blocked.integrationBranch], [repo.start, null]);
  equal(repo.run("rev-parse", "main"), repo.start);
  equal(repo.worktrees.list().length, 1);

  // The edits are committed on the branch, in whatever commit: the fixes are merged.
  write(repo.root, "Core/XmlManager.cs", "xml edited\n");
  repo.run("commit", "-q", "-am", "the edits");
  const merged = integrate(repo.git, repo.worktrees, repo.request(items));
  deepStrictEqual(merged.items.map((item) => item.status), ["merged", "merged"]);
  equal(repo.run("show", "main:Core/XmlManager.cs"), "xml edited");
  equal(repo.run("show", "main:Chummer/frmCreate.cs"), "create fixed");
});

test("a fix whose change the branch has already gets a merge commit of its own, and is not merged twice", () => {
  const repo = repositoryOnMain();
  const fix = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  write(repo.root, "Chummer/frmCreate.cs", "create fixed\n");
  repo.run("commit", "-q", "-am", "the same change by hand");
  const before = repo.run("rev-parse", "main");
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  const merge = result.items[0]!;
  equal(merge.status, "merged");
  ok(merge.mergeCommit !== null && merge.mergeCommit !== before);
  equal(result.after, merge.mergeCommit);
  equal(repo.run("rev-parse", `${merge.mergeCommit}^1`), before);
  equal(repo.run("rev-parse", `${merge.mergeCommit}^2`), fix);
  equal(repo.run("rev-parse", `${merge.mergeCommit}^{tree}`), repo.run("rev-parse", `${before}^{tree}`));
  equal(repo.run("log", "-1", "--format=%(trailers:key=Merged-Fix,valueonly)", "main"), "wf-1/d-1");
  equal(repo.run("rev-parse", "main"), merge.mergeCommit);

  const again = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  deepStrictEqual([again.items[0]!.reason, again.items[0]!.mergeCommit, again.after], ["merged before", merge.mergeCommit, merge.mergeCommit]);
});

test("a resumed merge checks the source edits against the last fix merged before, which may have changed an edited file itself", () => {
  const repo = repositoryOnMain();
  const source = repo.commitOn(repo.start, "Source captured by thread wf-1", { "Core/XmlManager.cs": "xml edited\n" });
  const fix = repo.commitOn(source, "Fix d-1", { "Core/XmlManager.cs": "xml edited and fixed\n" });
  const later = repo.commitOn(fix, "Fix d-2", { "Chummer/added.cs": "added\n" });
  write(repo.root, "Core/XmlManager.cs", "xml edited\n");
  repo.run("commit", "-q", "-am", "the edits");
  const first = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  equal(first.items[0]!.status, "merged");
  // The edit the fixes were verified on stays on the branch: the later fix merges although the first changed the file.
  const kept = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix), repo.item("d-2", later)]));
  deepStrictEqual(kept.items.map((item) => item.status), ["merged", "merged"]);
  equal(repo.run("show", "main:Core/XmlManager.cs"), "xml edited and fixed");

  // The branch loses another edit before the resume: the unmerged fix is not merged.
  const other = repositoryOnMain();
  const otherSource = other.commitOn(other.start, "Source captured by thread wf-1", { "Core/XmlManager.cs": "xml edited\n", "README.md": "edited\n" });
  const one = other.commitOn(otherSource, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  const two = other.commitOn(one, "Fix d-2", { "Chummer/added.cs": "added\n" });
  write(other.root, "Core/XmlManager.cs", "xml edited\n");
  write(other.root, "README.md", "edited\n");
  other.run("add", "-A");
  other.run("commit", "-q", "-m", "the edits");
  equal(integrate(other.git, other.worktrees, other.request([other.item("d-1", one)])).items[0]!.status, "merged");
  write(other.root, "README.md", "edited again\n");
  other.run("commit", "-q", "-am", "the edit is gone");
  const tipBefore = other.run("rev-parse", "main");
  const resumed = integrate(other.git, other.worktrees, other.request([other.item("d-1", one), other.item("d-2", two)]));
  deepStrictEqual(resumed.items.map((item) => item.status), ["merged", "blocked"]);
  ok(resumed.items[1]!.reason!.includes("README.md"));
  equal(other.run("rev-parse", "main"), tipBefore);
});

test("a fix the branch holds in its history already still gets a merge commit with two parents that records it", () => {
  const repo = repositoryOnMain();
  const fix = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  // The branch is advanced to the fix commit itself, then moves on.
  repo.run("merge", "-q", "--ff-only", fix);
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  const recorded = result.items[0]!;
  equal(recorded.status, "merged");
  ok(recorded.mergeCommit !== null && recorded.mergeCommit !== fix);
  deepStrictEqual([repo.run("rev-parse", `${recorded.mergeCommit}^1`), repo.run("rev-parse", `${recorded.mergeCommit}^2`)], [fix, repo.start]);
  equal(repo.run("rev-parse", `${recorded.mergeCommit}^{tree}`), repo.run("rev-parse", `${fix}^{tree}`));
  equal(repo.run("log", "-1", "--format=%(trailers:key=Merged-Fix,valueonly)", "main"), "wf-1/d-1");

  const other = repositoryOnMain();
  const fixed = other.commitOn(other.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  other.run("merge", "-q", "--ff-only", fixed);
  write(other.root, "README.md", "moved on\n");
  other.run("add", "README.md");
  other.run("commit", "-q", "-m", "main moved");
  const moved = other.run("rev-parse", "main");
  const behind = integrate(other.git, other.worktrees, other.request([other.item("d-1", fixed)]));
  const commit = behind.items[0]!.mergeCommit!;
  deepStrictEqual([other.run("rev-parse", `${commit}^1`), other.run("rev-parse", `${commit}^2`)], [moved, fixed]);
  equal(other.run("rev-parse", `${commit}^{tree}`), other.run("rev-parse", `${moved}^{tree}`));
  equal(other.run("rev-parse", "main"), commit);
});

test("a source that captured a checkout git converts holds no edit, and its fixes are merged as the branch's own commits hold their files", () => {
  const repo = repositoryOnMain();
  const blob = (revision: string) => execFileSync("git", ["-C", repo.root, "cat-file", "blob", revision], { encoding: "utf8" });
  // A file the branch holds with CRLF, then the person's checkout converts line endings.
  write(repo.root, "Chummer/frmCreate.Designer.cs", "designer\r\n");
  repo.run("add", "Chummer/frmCreate.Designer.cs");
  repo.run("commit", "-q", "-m", "designer");
  repo.run("config", "core.autocrlf", "true");
  const base = repo.run("rev-parse", "main");
  // The clean checkout's bytes, as the thread's source commit captures them, and two fixes made on them.
  const source = repo.commitOn(base, "Source captured by thread wf-1", { "Chummer/frmCreate.cs": "create\r\n", "Core/XmlManager.cs": "xml\r\n" });
  equal(blob(`${source}:Core/XmlManager.cs`), "xml\r\n");
  const first = repo.commitOn(source, "Fix d-1", { "Chummer/frmCreate.cs": "create\r\nfixed\r\n" });
  const second = repo.commitOn(first, "Fix d-2", { "Chummer/frmCreate.Designer.cs": "designer\r\nfixed\r\n", "Chummer/added.cs": "added\r\n" });
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", first), repo.item("d-2", second)]));
  deepStrictEqual(result.items.map((item) => [item.name, item.status, item.reason]), [["d-1", "merged", null], ["d-2", "merged", null]]);
  equal(repo.run("rev-parse", "main"), result.after);
  // Each fix changes only what it fixed, in the form the branch holds the file: LF where the branch has LF, CRLF where it has CRLF.
  deepStrictEqual(repo.run("diff", "--name-only", base, "main").split("\n"), ["Chummer/added.cs", "Chummer/frmCreate.Designer.cs", "Chummer/frmCreate.cs"]);
  equal(blob("main:Chummer/frmCreate.cs"), "create\nfixed\n");
  equal(blob("main:Chummer/frmCreate.Designer.cs"), "designer\r\nfixed\r\n");
  equal(blob("main:Chummer/added.cs"), "added\n");
  equal(blob("main:Core/XmlManager.cs"), "xml\n");
  equal(repo.run("log", "-1", "--format=%an %s", "workflow/wf-1/fix/d-1"), "Test Fix d-1");
  // The checkout gets the bytes the fixes were verified with, and nothing is left uncommitted or behind.
  equal(readFileSync(join(repo.root, "Chummer/frmCreate.cs"), "utf8"), "create\r\nfixed\r\n");
  equal(readFileSync(join(repo.root, "Chummer/frmCreate.Designer.cs"), "utf8"), "designer\r\nfixed\r\n");
  equal(repo.run("status", "--porcelain=v1"), "");
  equal(repo.worktrees.list().length, 1);
});

test("a converted source's real edit still keeps its fixes from a branch that lacks it", () => {
  const repo = repositoryOnMain();
  repo.run("config", "core.autocrlf", "true");
  const source = repo.commitOn(repo.start, "Source captured by thread wf-1", { "Chummer/frmCreate.cs": "create\r\n", "Core/XmlManager.cs": "xml edited\r\n" });
  const fix = repo.commitOn(source, "Fix d-1", { "Chummer/frmCreate.cs": "create\r\nfixed\r\n" });
  const blocked = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  deepStrictEqual(blocked.items.map((item) => [item.status, item.reason]), [["blocked", "the thread's source held edits of Core/XmlManager.cs that main lacks; commit them first (the fixes were verified on top of them)"]]);
  equal(repo.run("rev-parse", "main"), repo.start);

  // The person commits the edit from their checkout: the fix is merged.
  write(repo.root, "Core/XmlManager.cs", "xml edited\r\n");
  repo.run("commit", "-q", "-am", "the edit");
  const merged = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  deepStrictEqual(merged.items.map((item) => item.status), ["merged"]);
  equal(execFileSync("git", ["-C", repo.root, "cat-file", "blob", "main:Chummer/frmCreate.cs"], { encoding: "utf8" }), "create\nfixed\n");
  equal(repo.run("status", "--porcelain=v1"), "");
});

test("a source's edits are read against the commit it was captured on, so a file the branch changed meanwhile is no edit", () => {
  for (const change of ["deleted", "committed with LF"] as const) {
    const repo = repositoryOnMain();
    // The branch holds a file with CRLF and the checkout converts line endings: the file is checked out as it is.
    write(repo.root, "Chummer/frmCreate.Designer.cs", "designer\r\n");
    repo.run("add", "Chummer/frmCreate.Designer.cs");
    repo.run("commit", "-q", "-m", "designer");
    repo.run("config", "core.autocrlf", "true");
    const source = repo.commitOn(repo.run("rev-parse", "main"), "Source captured by thread wf-1", { "Chummer/frmCreate.cs": "create\r\n" });
    const fix = repo.commitOn(source, "Fix d-1", { "Core/XmlManager.cs": "xml fixed\r\n" });
    // While the thread runs, the branch moves.
    if (change === "deleted") repo.run("rm", "-q", "Chummer/frmCreate.Designer.cs");
    else {
      write(repo.root, "Chummer/frmCreate.Designer.cs", "designer\n");
      repo.run("-c", "core.autocrlf=false", "add", "--renormalize", "Chummer/frmCreate.Designer.cs");
    }
    repo.run("commit", "-q", "-m", `the designer file is ${change}`);
    const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
    deepStrictEqual(result.items.map((item) => [item.status, item.reason]), [["merged", null]], change);
    equal(execFileSync("git", ["-C", repo.root, "cat-file", "blob", "main:Core/XmlManager.cs"], { encoding: "utf8" }), "xml fixed\n", change);
    equal(repo.run("diff", "--name-only", "main~1", "main"), "Core/XmlManager.cs", change);
  }
});

test("a converted fix follows a file the branch renamed while the thread ran", () => {
  const repo = repositoryOnMain();
  const lines = (end: string, third: string) => ["one", "two", third, "four", "five", "six", ""].join(end);
  // A file the branch holds with CRLF in a checkout that converts line endings, which the branch renames meanwhile.
  write(repo.root, "Chummer/frmCreate.Designer.cs", lines("\r\n", "three"));
  repo.run("add", "Chummer/frmCreate.Designer.cs");
  repo.run("commit", "-q", "-m", "designer");
  repo.run("config", "core.autocrlf", "true");
  const source = repo.commitOn(repo.run("rev-parse", "main"), "Source captured by thread wf-1", { "Chummer/frmCreate.cs": "create\r\n" });
  const fix = repo.commitOn(source, "Fix d-1", { "Chummer/frmCreate.Designer.cs": lines("\r\n", "fixed") });
  repo.run("mv", "Chummer/frmCreate.Designer.cs", "Chummer/renamed.cs");
  repo.run("commit", "-q", "-m", "renamed");
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  deepStrictEqual(result.items.map((item) => [item.status, item.files]), [["merged", []]]);
  equal(execFileSync("git", ["-C", repo.root, "cat-file", "blob", "main:Chummer/renamed.cs"], { encoding: "utf8" }), lines("\r\n", "fixed"));
  equal(repo.run("diff", "--name-only", "main~1", "main"), "Chummer/renamed.cs");
  equal(repo.run("status", "--porcelain=v1"), "");
});

test("a converted fix that conflicts leaves its branch at the fix commit", () => {
  const repo = repositoryOnMain();
  repo.run("config", "core.autocrlf", "true");
  const source = repo.commitOn(repo.start, "Source captured by thread wf-1", { "Chummer/frmCreate.cs": "create\r\n" });
  const fix = repo.commitOn(source, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\r\n" });
  write(repo.root, "Chummer/frmCreate.cs", "create changed on main\n");
  repo.run("commit", "-q", "-am", "main changed the same line");
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  deepStrictEqual(result.items.map((item) => [item.status, item.files]), [["conflict", ["Chummer/frmCreate.cs"]]]);
  equal(repo.run("rev-parse", "workflow/wf-1/fix/d-1"), fix);
  equal(repo.worktrees.list().length, 1);
});

test("replayed files are named literally, staged whatever core.safecrlf says, and keep the fix's file modes", () => {
  const repo = repositoryOnMain();
  write(repo.root, "Core/ab.cs", "ab\n");
  write(repo.root, "Core/run.sh", "run\n");
  repo.run("add", "Core");
  repo.run("commit", "-q", "-m", "more files");
  repo.run("config", "core.autocrlf", "true");
  repo.run("config", "core.safecrlf", "true");
  repo.run("config", "core.filemode", "false");
  const base = repo.run("rev-parse", "main");
  // A fix that adds a file whose name is also a pattern matching another file, leaves one with mixed line endings, which
  // `core.safecrlf` would refuse to stage, and makes a file it changes executable.
  const folder = join(scratch(), "fix");
  repo.worktrees.add(folder, "workflow/wf-1/attempt", base);
  write(folder, "Core/a[b].cs", "bracket\r\n");
  write(folder, "Chummer/frmCreate.cs", "create\r\nfixed\n");
  write(folder, "Core/run.sh", "run fixed\r\n");
  repo.worktrees.stage(folder);
  execFileSync("git", ["-C", folder, "update-index", "--chmod=+x", "Core/run.sh"]);
  const fix = repo.worktrees.commitStaged(folder, "Fix d-1\n");
  repo.worktrees.remove(folder);
  const result = integrate(repo.git, repo.worktrees, repo.request([repo.item("d-1", fix)]));
  deepStrictEqual(result.items.map((item) => [item.status, item.reason]), [["merged", null]]);
  deepStrictEqual(repo.run("diff", "--name-status", base, "main").split("\n"), ["M\tChummer/frmCreate.cs", "A\tCore/a[b].cs", "M\tCore/run.sh"]);
  equal(repo.run("ls-tree", "main", "Core/run.sh").split(" ")[0], "100755");
  equal(execFileSync("git", ["-C", repo.root, "cat-file", "blob", "main:Chummer/frmCreate.cs"], { encoding: "utf8" }), "create\nfixed\n");
  // The executable file is converted like the others.
  equal(execFileSync("git", ["-C", repo.root, "cat-file", "blob", "main:Core/run.sh"], { encoding: "utf8" }), "run fixed\n");
});

test("a temporary folder that cannot be removed is named and keeps neither the merge worktree nor the result", () => {
  const repo = repositoryOnMain();
  const fix = repo.commitOn(repo.start, "Fix d-1", { "Chummer/frmCreate.cs": "create fixed\n" });
  const folder = scratch("workflow-stuck-");
  const lines: string[] = [];
  const request = repo.request([repo.item("d-1", fix)]);
  const result = integrate(repo.git, repo.worktrees, request, {
    log: (line) => lines.push(line),
    createScratchFolder: () => ({ path: folder, remove: () => { throw new Error("the folder is in use"); } }),
  });
  equal(result.items[0]!.status, "merged");
  equal(repo.run("rev-parse", "main"), result.after);
  equal(repo.worktrees.list().length, 1);
  deepStrictEqual(lines, [`The scratch copy ${folder} could not be removed: the folder is in use`]);
});
