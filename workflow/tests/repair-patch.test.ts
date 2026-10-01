import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parsePatch } from "../src/evals/benchmark.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { computePatch, type Patch, type PatchFile } from "../src/repair/patch.js";
import { guardPatch, maximumChangedLines } from "../src/repair/patch-guard.js";
import { repairPrompt } from "../src/repair/repair-prompt.js";
import { repairPromptVersion, validateRepair, type RepairOutput } from "../src/repair/repair-schemas.js";
import { stageWorkspace, workspaceIn } from "../src/repair/workspace.js";
import { hypothesisAnswer } from "./diagnosis-harness.js";
import { scratch, write } from "./diagnosis-fixtures.js";
import type { ContextManifest } from "../src/diagnosis/context.js";

/** A snapshot folder like the thread's: source, data and translations, no history. */
function snapshot(): string {
  const root = scratch("workflow-repair-snapshot-");
  write(root, "Chummer/frmCreate.cs", "class frmCreate\r\n{\r\n    int x = 628;\r\n}\r\n");
  write(root, "Chummer/frmCareer.cs", "class frmCareer {}\n");
  write(root, "Chummer/old.cs", "class Old {}\n");
  write(root, "bin/data/skills.xml", "<skills/>\n");
  return root;
}

function copyOf(folder: string): string {
  const copy = scratch("workflow-repair-copy-");
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name).slice(folder.length + 1);
    write(copy, path, readFileSync(join(folder, path), "utf8"));
  }
  return copy;
}

test("the workspace is a copy of the context and the snapshot in a scratch folder, without history", () => {
  const base = snapshot();
  const context = scratch("workflow-repair-context-");
  write(context, "context.json", "{}");
  write(context, "evidence/1-canonical.png", "png");
  const folder = createScratchFolder("workflow-repair-");
  const workspace = workspaceIn(folder, "d-1");
  ok(!existsSync(workspace.source) && !existsSync(workspace.context));
  stageWorkspace(workspace, context, base);
  deepStrictEqual(readdirSync(folder.path).sort(), ["d-1", "source"]);
  equal(readFileSync(join(workspace.source, "Chummer", "frmCreate.cs"), "utf8"), readFileSync(join(base, "Chummer", "frmCreate.cs"), "utf8"));
  ok(existsSync(join(workspace.context, "evidence", "1-canonical.png")));
  ok(!existsSync(join(workspace.source, ".git")));
  // An edit of one copy leaves the snapshot and every other copy as they were.
  const other = workspaceIn(createScratchFolder("workflow-repair-"), "d-1");
  stageWorkspace(other, context, base);
  writeFileSync(join(workspace.source, "Chummer", "frmCreate.cs"), "edited");
  ok(readFileSync(join(other.source, "Chummer", "frmCreate.cs"), "utf8").includes("628"));
  ok(readFileSync(join(base, "Chummer", "frmCreate.cs"), "utf8").includes("628"));
  folder.remove();
});

test("the patch lists added, modified and deleted files with a diff that parses like a benchmark patch", () => {
  const base = snapshot();
  const copy = copyOf(base);
  write(copy, "Chummer/frmCreate.cs", "class frmCreate\r\n{\r\n    int x = 640;\r\n}\r\n");
  write(copy, "Chummer/Added.cs", "class Added {}\nclass More {}\n");
  rmSync(join(copy, "Chummer", "old.cs"));
  const layout = scratch("workflow-repair-layout-");
  const patch = computePatch(base, copy, layout);
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

test("an unchanged copy has an empty patch, and a NUL byte marks a file as binary", () => {
  const base = snapshot();
  const copy = copyOf(base);
  deepStrictEqual(computePatch(base, copy, scratch("workflow-repair-layout-")).files, []);
  mkdirSync(join(copy, "Chummer", "res"), { recursive: true });
  writeFileSync(join(copy, "Chummer", "res", "icon.bin"), Buffer.from([1, 0, 2]));
  const patch = computePatch(base, copy, scratch("workflow-repair-layout-"));
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
});

test("the guard names every rule a patch breaks", () => {
  const cases: [Patch, string[], RegExp][] = [
    [patchOf([]), [], /the patch is empty/],
    [patchOf([file("Chummer/a.cs"), file("Chummer/b.cs")]), ["Chummer/a.cs"], /changed but not listed in the answer: Chummer\/b\.cs/],
    [patchOf([file("Chummer/a.cs")]), ["Chummer/a.cs", "Chummer/c.cs"], /listed in the answer but not changed: Chummer\/c\.cs/],
    [patchOf([file("bin/data/skills.xml")]), ["bin/data/skills.xml"], /bin\/data\/skills\.xml is outside Chummer\//],
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
  const prompt = repairPrompt({ manifest, hypothesis, challenge: null, observations: [{ case: "build-alpha", capture: "skills", observation: "differs", detail: "visual difference (0.01)" }] },
    { sourceFolder: "C:/scratch/source", contextFolder: "C:/scratch/d-1" });
  ok(prompt.startsWith(`PROMPT_VERSION=${repairPromptVersion}\n`));
  for (const text of ["C:/scratch/source", "C:/scratch/d-1", "untrusted data", "Chummer/", "no_patch", hypothesis.claim, "visual difference (0.01)", manifest.cluster.id]) {
    ok(prompt.includes(text), text);
  }
});
