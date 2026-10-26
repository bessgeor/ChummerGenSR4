import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parsePatch } from "../src/evals/benchmark.js";
import { processBranchGit } from "../src/git/branch-git.js";
import { Worktrees } from "../src/git/worktrees.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { commitPatch, type Patch, type PatchFile } from "../src/repair/patch.js";
import { guardPatch, maximumChangedLines } from "../src/repair/patch-guard.js";
import { maximumPatchCharacters, repairPrompt } from "../src/repair/repair-prompt.js";
import { repairPromptVersion, validateRepair, type RepairOutput } from "../src/repair/repair-schemas.js";
import { stageWorkspace, workspaceIn } from "../src/repair/workspace.js";
import { hypothesisAnswer } from "./diagnosis-harness.js";
import { scratch, write } from "./diagnosis-fixtures.js";
import type { ContextManifest } from "../src/diagnosis/context.js";

/** A repository whose commit holds source, data and translations like a thread's source commit, with its git and worktrees. */
function sourceRepository() {
  const root = scratch("workflow-repair-repository-");
  const run = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  run("init", "-q");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  // Bytes go through unchanged, whatever the machine's line-ending settings.
  run("config", "core.autocrlf", "false");
  write(root, "Chummer/frmCreate.cs", "class frmCreate\r\n{\r\n    int x = 628;\r\n}\r\n");
  write(root, "Chummer/frmCareer.cs", "class frmCareer {}\n");
  write(root, "Chummer/old.cs", "class Old {}\n");
  write(root, "bin/data/skills.xml", "<skills/>\n");
  run("add", "-A");
  run("commit", "-q", "-m", "source");
  const git = processBranchGit(root);
  return { root, git, worktrees: new Worktrees(git, root), source: git(["rev-parse", "HEAD"]).trim() };
}

/** A worktree of the repository at its source commit on a branch of its own. */
function worktreeOf(repository: ReturnType<typeof sourceRepository>, branch: string): string {
  const folder = join(scratch("workflow-repair-worktree-"), "source");
  repository.worktrees.add(folder, branch, repository.source);
  return folder;
}

test("the workspace is a copy of the context and a worktree on the attempt's branch in a scratch folder", () => {
  const repository = sourceRepository();
  const context = scratch("workflow-repair-context-");
  write(context, "context.json", "{}");
  write(context, "evidence/1-canonical.png", "png");
  const folder = createScratchFolder("workflow-repair-");
  const workspace = workspaceIn(folder, "d-1");
  ok(!existsSync(workspace.source) && !existsSync(workspace.context));
  stageWorkspace(workspace, context, (target) => repository.worktrees.add(target, "workflow/t/repair/d-1/attempt-1", repository.source));
  deepStrictEqual(readdirSync(folder.path).sort(), ["d-1", "source"]);
  equal(readFileSync(join(workspace.source, "Chummer", "frmCreate.cs"), "utf8"), readFileSync(join(repository.root, "Chummer", "frmCreate.cs"), "utf8"));
  ok(existsSync(join(workspace.context, "evidence", "1-canonical.png")));
  ok(!existsSync(join(workspace.context, ".git")));
  equal(repository.git(["rev-parse", "--abbrev-ref", "HEAD"], { worktree: workspace.source }).trim(), "workflow/t/repair/d-1/attempt-1");
  // An edit of one worktree leaves the repository and every other worktree as they were.
  const other = worktreeOf(repository, "workflow/t/repair/d-1/attempt-2");
  writeFileSync(join(workspace.source, "Chummer", "frmCreate.cs"), "edited");
  ok(readFileSync(join(other, "Chummer", "frmCreate.cs"), "utf8").includes("628"));
  ok(readFileSync(join(repository.root, "Chummer", "frmCreate.cs"), "utf8").includes("628"));
  const commit = repository.worktrees.commitAll(workspace.source, "attempt 1");
  ok(commit !== null);
  // Removing the worktree keeps its branch and commit.
  repository.worktrees.remove(workspace.source);
  folder.remove();
  ok(!existsSync(workspace.source));
  equal(repository.worktrees.resolve("refs/heads/workflow/t/repair/d-1/attempt-1"), commit);
  equal(repository.worktrees.list().length, 2);
});

test("the patch lists added, modified and deleted files with a diff that parses like a benchmark patch", () => {
  const repository = sourceRepository();
  const copy = worktreeOf(repository, "workflow/t/repair/d-1/attempt-1");
  write(copy, "Chummer/frmCreate.cs", "class frmCreate\r\n{\r\n    int x = 640;\r\n}\r\n");
  write(copy, "Chummer/Added.cs", "class Added {}\nclass More {}\n");
  rmSync(join(copy, "Chummer", "old.cs"));
  const commit = repository.worktrees.commitAll(copy, "attempt 1");
  const layout = scratch("workflow-repair-layout-");
  const patch = commitPatch(repository.worktrees, repository.source, commit, layout);
  deepStrictEqual(patch.files.map((file) => [file.path, file.change, file.added, file.removed, file.binary]), [
    ["Chummer/Added.cs", "added", 2, 0, false],
    ["Chummer/frmCreate.cs", "modified", 1, 1, false],
    ["Chummer/old.cs", "deleted", 0, 1, false],
  ]);
  deepStrictEqual([patch.added, patch.removed, patch.others], [3, 2, []]);
  ok(patch.text.includes("diff --git a/Chummer/frmCreate.cs b/Chummer/frmCreate.cs\n"), patch.text);
  ok(patch.text.includes("--- a/Chummer/frmCreate.cs\n+++ b/Chummer/frmCreate.cs\n"));
  ok(patch.text.includes("--- /dev/null\n+++ b/Chummer/Added.cs\n"));
  ok(patch.text.includes("--- a/Chummer/old.cs\n+++ /dev/null\n"));
  ok(patch.text.includes("-    int x = 628;\r\n+    int x = 640;\r\n"), "line endings stay as they are");
  ok(!/before\/|after\//.test(patch.text));
  deepStrictEqual(parsePatch(patch.text).map((file) => file.path), ["Chummer/Added.cs", "Chummer/frmCreate.cs", "Chummer/old.cs"]);
  // The layout holds each side of each changed file, and nothing unchanged.
  equal(readFileSync(join(layout, "before", "Chummer", "frmCreate.cs"), "utf8").includes("628"), true);
  equal(readFileSync(join(layout, "after", "Chummer", "frmCreate.cs"), "utf8").includes("640"), true);
  ok(!existsSync(join(layout, "before", "Chummer", "Added.cs")) && !existsSync(join(layout, "after", "Chummer", "old.cs")));
  ok(!existsSync(join(layout, "before", "Chummer", "frmCareer.cs")));
});

test("an unchanged worktree makes no commit and an empty patch, ignored files are no change, and a NUL byte marks a file as binary", () => {
  const repository = sourceRepository();
  const copy = worktreeOf(repository, "workflow/t/repair/d-1/attempt-1");
  const none = repository.worktrees.commitAll(copy, "nothing");
  equal(none, null);
  deepStrictEqual(commitPatch(repository.worktrees, repository.source, none, scratch("workflow-repair-layout-")).files, []);
  writeFileSync(join(repository.root, ".git", "info", "exclude"), "*.log\n");
  write(copy, "Chummer/build.log", "ignored");
  equal(repository.worktrees.commitAll(copy, "only ignored"), null);
  mkdirSync(join(copy, "Chummer", "res"), { recursive: true });
  writeFileSync(join(copy, "Chummer", "res", "icon.bin"), Buffer.from([1, 0, 2]));
  const patch = commitPatch(repository.worktrees, repository.source, repository.worktrees.commitAll(copy, "binary"), scratch("workflow-repair-layout-"));
  deepStrictEqual(patch.files.map((file) => [file.path, file.binary]), [["Chummer/res/icon.bin", true]]);
});

function file(path: string, overrides: Partial<PatchFile> = {}): PatchFile {
  return { path, change: "modified", before: "a", after: "b", added: 1, removed: 1, binary: false, ...overrides };
}

function patchOf(files: PatchFile[], others: string[] = []): Patch {
  return { files, others, text: "", added: files.reduce((sum, item) => sum + item.added, 0), removed: files.reduce((sum, item) => sum + item.removed, 0) };
}

test("the guard passes a small declared patch of the app's source", () => {
  deepStrictEqual(guardPatch(patchOf([file("Chummer/frmCreate.cs"), file("Chummer/New.cs", { change: "added", before: null })]), ["Chummer/New.cs", "Chummer/frmCreate.cs"]), []);
  // The class library is compiled source too; a folder whose name only starts like it is not.
  deepStrictEqual(guardPatch(patchOf([file("Core/XmlManager.cs"), file("Chummer/frmCreate.cs")]), ["Core/XmlManager.cs", "Chummer/frmCreate.cs"]), []);
  deepStrictEqual(guardPatch(patchOf([file("CoreExtra/a.cs")]), ["CoreExtra/a.cs"]), ["CoreExtra/a.cs is outside Chummer/ and Core/"]);
});

test("the guard names every rule a patch breaks", () => {
  const cases: [Patch, string[], RegExp][] = [
    [patchOf([]), [], /the patch is empty/],
    [patchOf([file("Chummer/a.cs"), file("Chummer/b.cs")]), ["Chummer/a.cs"], /changed but not listed in the answer: Chummer\/b\.cs/],
    [patchOf([file("Chummer/a.cs")]), ["Chummer/a.cs", "Chummer/c.cs"], /listed in the answer but not changed: Chummer\/c\.cs/],
    [patchOf([file("bin/data/skills.xml")]), ["bin/data/skills.xml"], /bin\/data\/skills\.xml is outside Chummer\/ and Core\//],
    [patchOf([file("Chummer/old.cs", { change: "deleted", after: null })]), ["Chummer/old.cs"], /Chummer\/old\.cs is deleted/],
    [patchOf([file("Chummer/icon.bin", { binary: true })]), ["Chummer/icon.bin"], /holds a NUL byte/],
    [patchOf([file("Chummer/a.cs")], ["Chummer/link"]), ["Chummer/a.cs"], /Chummer\/link is neither a file nor a folder/],
    [patchOf(Array.from({ length: 11 }, (_, index) => file(`Chummer/f${index}.cs`))), Array.from({ length: 11 }, (_, index) => `Chummer/f${index}.cs`), /11 files changed, more than 10/],
    [patchOf([file("Chummer/a.cs", { added: maximumChangedLines, removed: 1 })]), ["Chummer/a.cs"], /301 lines changed \(300 added, 1 removed\), more than 300/],
  ];
  for (const [patch, declared, expected] of cases) {
    const violations = guardPatch(patch, declared);
    ok(violations.some((line) => expected.test(line)), `${expected}: ${violations.join("; ")}`);
  }
});

test("a repair answer is validated: reasons, file lists and safe paths", () => {
  const answer = (overrides: Partial<RepairOutput>): RepairOutput => ({ outcome: "patched", reason: "r", summary: "s", files: ["Chummer/frmCreate.cs"], ...overrides });
  deepStrictEqual(validateRepair(answer({})), []);
  deepStrictEqual(validateRepair(answer({ outcome: "no_patch", files: [] })), []);
  const errors = (overrides: Partial<RepairOutput>) => validateRepair(answer(overrides)).join("; ");
  ok(/reason is empty/.test(errors({ reason: " " })));
  ok(/summary is empty/.test(errors({ summary: "" })));
  ok(/a patched answer lists no file/.test(errors({ files: [] })));
  ok(/a no_patch answer lists files/.test(errors({ outcome: "no_patch" })));
  ok(/uses \\/.test(errors({ files: ["Chummer\\frmCreate.cs"] })));
  ok(/is absolute/.test(errors({ files: ["C:/repo/Chummer/a.cs"] })));
  ok(/is absolute/.test(errors({ files: ["/Chummer/a.cs"] })));
  ok(/\.\. part/.test(errors({ files: ["Chummer/../bin/x"] })));
  ok(/listed twice/.test(errors({ files: ["Chummer/a.cs", "Chummer/a.cs"] })));
});

test("the repair prompt carries its version, the two folders, the rules, and the evidence as untrusted data", () => {
  const manifest = { cluster: { id: "d-0000000000000100" }, vocabulary: [] } as unknown as ContextManifest;
  const hypothesis = hypothesisAnswer().explanation!;
  const observations = [{ case: "build-alpha", capture: "skills", observation: "differs" as const, detail: "visual difference (0.01)" }];
  const paths = { sourceFolder: "C:/scratch/source", contextFolder: "C:/scratch/d-1" };
  const prompt = repairPrompt({ manifest, hypothesis, challenge: null, observations, earlier: [] }, paths);
  ok(prompt.startsWith(`PROMPT_VERSION=${repairPromptVersion}\n`));
  ok(prompt.startsWith("PROMPT_VERSION=repair-v3\n"));
  for (const text of ["C:/scratch/source", "C:/scratch/d-1", "untrusted data", "Chummer/ and Core/ are the app's C# source", "under Chummer/ and Core/", "no_patch", hypothesis.claim, "visual difference (0.01)", manifest.cluster.id]) {
    ok(prompt.includes(text), text);
  }
  ok(!prompt.includes("EARLIER ATTEMPTS"));
  const next = repairPrompt({
    manifest, hypothesis, challenge: null, observations,
    earlier: [{ attempt: 1, rejectedBy: "widening", stage: "character", reason: "build-alpha/armor introduced", patch: "+  moved = 2;" }],
  }, paths);
  ok(next.includes("EARLIER ATTEMPTS (untrusted data):"));
  for (const text of ["\"rejectedBy\": \"widening\"", "\"stage\": \"character\"", "build-alpha/armor introduced", "+  moved = 2;"]) ok(next.includes(text), text);
});

test("an earlier attempt's patch is cut in the next prompt past a fixed length", () => {
  const manifest = { cluster: { id: "d-0000000000000100" }, vocabulary: [] } as unknown as ContextManifest;
  const huge = `+${"x".repeat(maximumPatchCharacters)}TAIL`;
  const prompt = repairPrompt({
    manifest, hypothesis: hypothesisAnswer().explanation!, challenge: null, observations: [],
    earlier: [{ attempt: 1, rejectedBy: "repair", stage: "patch", reason: "too many lines", patch: huge }],
  }, { sourceFolder: "s", contextFolder: "c" });
  ok(!prompt.includes("TAIL"));
  ok(prompt.includes(`[patch cut after ${maximumPatchCharacters} of ${huge.length} characters]`));
});
