import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSourceSnapshot, processGit } from "../src/diagnosis/source-snapshot.js";
import { SetupError } from "../src/host/setup-error.js";
import { AcceptedBranch, processBranchGit, promote } from "../src/widening/accepted-branch.js";
import { prepareWidenedSource } from "../src/widening/widened-source.js";
import { repository, scratch, write } from "./diagnosis-fixtures.js";
import { archiveWithPatch } from "./widening-fixtures.js";

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** What a promotion must leave alone: the checked-out commit, the index and the working tree's status. */
/** A promotion that is expected to make a commit. */
function committed(promotion: Parameters<typeof promote>[0]): string {
  const commit = promote(promotion);
  if (commit === null) throw new Error("The promotion had nothing to commit.");
  return commit;
}

function untouched(root: string) {
  return { head: git(root, "rev-parse", "HEAD"), index: git(root, "write-tree"), status: git(root, "status", "--porcelain=v1", "--untracked-files=all") };
}

test("the widened source is the accepted Chummer/ with the patch's after sides", () => {
  const root = scratch("workflow-widened-");
  write(root, "accepted/Chummer/frmCreate.cs", "class frmCreate { int moved; }");
  write(root, "accepted/Chummer/other.cs", "other");
  write(root, "accepted/Core/XmlManager.cs", "class XmlManager {}");
  write(root, "accepted/bin/data/skills.xml", "<skills/>");
  const { archive, files } = archiveWithPatch(join(root, "attempt-1"), {
    "Chummer/frmCreate.cs": { before: "class frmCreate { int moved; }", after: "class frmCreate { int restored; }" },
    "Chummer/added.cs": { before: null, after: "added" },
  });
  const target = join(root, "widened", "source");
  write(root, "widened/source/Chummer/stale.cs", "left by a killed step");
  deepStrictEqual(prepareWidenedSource(join(root, "accepted"), archive, files, target), []);
  equal(readFileSync(join(target, "Chummer/frmCreate.cs"), "utf8"), "class frmCreate { int restored; }");
  equal(readFileSync(join(target, "Chummer/added.cs"), "utf8"), "added");
  equal(readFileSync(join(target, "Chummer/other.cs"), "utf8"), "other");
  equal(readFileSync(join(target, "Core/XmlManager.cs"), "utf8"), "class XmlManager {}");
  ok(!existsSync(join(target, "Chummer/stale.cs")));
  ok(!existsSync(join(target, "bin")));
  equal(readFileSync(join(root, "accepted/Chummer/frmCreate.cs"), "utf8"), "class frmCreate { int moved; }");
});

test("a patch does not apply when an accepted file differs from its before side or an added file exists", () => {
  const root = scratch("workflow-widened-");
  write(root, "accepted/Chummer/frmCreate.cs", "class frmCreate { int changedByAnEarlierFix; }");
  write(root, "accepted/Chummer/added.cs", "already here");
  write(root, "accepted/Core/XmlManager.cs", "class XmlManager {}");
  const { archive, files } = archiveWithPatch(join(root, "attempt-1"), {
    "Chummer/frmCreate.cs": { before: "class frmCreate { int moved; }", after: "class frmCreate { int restored; }" },
    "Chummer/added.cs": { before: null, after: "added" },
    "Chummer/missing.cs": { before: "was there", after: "changed" },
  });
  const target = join(root, "widened", "source");
  deepStrictEqual(prepareWidenedSource(join(root, "accepted"), archive, files, target), ["Chummer/frmCreate.cs", "Chummer/added.cs", "Chummer/missing.cs"]);
  equal(readFileSync(join(target, "Chummer/frmCreate.cs"), "utf8"), "class frmCreate { int changedByAnEarlierFix; }");
});

test("an accepted source without Core/ cannot be widened, because the candidate cannot be built from it", () => {
  const root = scratch("workflow-widened-");
  write(root, "accepted/Chummer/frmCreate.cs", "a");
  const { archive, files } = archiveWithPatch(join(root, "attempt-1"), { "Chummer/frmCreate.cs": { before: "a", after: "b" } });
  throws(() => prepareWidenedSource(join(root, "accepted"), archive, files, join(root, "w")), (error) => error instanceof SetupError && /has no Core\/, which the candidate is compiled from/.test(error.message));
});

test("an archive whose after side is missing or a patch outside Chummer/ is a setup error", () => {
  const root = scratch("workflow-widened-");
  write(root, "accepted/Chummer/frmCreate.cs", "a");
  write(root, "accepted/Core/XmlManager.cs", "class XmlManager {}");
  const { archive, files } = archiveWithPatch(join(root, "attempt-1"), { "Chummer/frmCreate.cs": { before: "a", after: "b" } });
  writeFileSync(join(archive, "files", "after", "Chummer", "frmCreate.cs"), "tampered");
  throws(() => prepareWidenedSource(join(root, "accepted"), archive, files, join(root, "w")), SetupError);
  throws(() => prepareWidenedSource(join(root, "accepted"), archive, [{ ...files[0]!, path: "bin/data/skills.xml" }], join(root, "w")), SetupError);
});

test("the first promotion commits the snapshot's source, then the fix, and leaves the working tree, index and HEAD alone", async () => {
  const repo = repository();
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  const widened = join(scratch(), "widened");
  write(widened, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  write(widened, "Chummer/untracked.cs", "new");
  write(widened, "Core/XmlManager.cs", "class XmlManager {}");
  const before = untouched(repo);
  const branch = new AcceptedBranch(processBranchGit(repo), "wf-1", join(scratch(), "promote.index"));
  const trailers = { thread: "wf-1", cluster: "d-1", record: "wf-1/d-1/repair/1" };
  const fix = committed({ branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, widenedSource: widened, trailers, summary: "Restored the field." });
  deepStrictEqual(untouched(repo), before);
  equal(branch.tip(), fix);
  equal(git(repo, "log", "--format=%s", "accepted/wf-1"), "Fix discrepancy d-1\nSource captured by thread wf-1\ninitial");
  equal(git(repo, "show", `${fix}:Chummer/frmCreate.cs`), "class frmCreate { int restored; }");
  equal(git(repo, "show", `${fix}~1:Chummer/frmCreate.cs`), "class frmCreate { int moved; }");
  // The snapshot did not have the deleted file, and has the untracked one; the data folders keep the commit's content.
  equal(git(repo, "ls-tree", "-r", "--name-only", fix), [".gitignore", "Chummer/frmCreate.cs", "Chummer/untracked.cs", "Core/XmlManager.cs", "README.md", "bin/ChummerGenSR4.exe", "bin/data/skills.xml", "bin/lang/en-us.xml"].join("\n"));
  equal(branch.repairRecord(fix), "wf-1/d-1/repair/1");
  ok(git(repo, "log", "-1", "--format=%B", fix).includes("Restored the field.\n\nWorkflow-Thread: wf-1\nDiscrepancy: d-1\nRepair-Record: wf-1/d-1/repair/1"));

  // Resumed after the branch moved: the same commit, nothing new.
  equal(promote({ branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, widenedSource: widened, trailers, summary: "Restored the field." }), fix);
  equal(git(repo, "rev-list", "--count", "accepted/wf-1"), "3");

  // A second promotion stacks on the first.
  const second = join(scratch(), "widened");
  write(second, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  write(second, "Chummer/untracked.cs", "fixed too");
  write(second, "Core/XmlManager.cs", "class XmlManager {}");
  const next = committed({ branch, base: snapshot.commit, accepted: fix, snapshotFolder: snapshot.folder, widenedSource: second, trailers: { ...trailers, cluster: "d-2", record: "wf-1/d-2/repair/1" }, summary: "Second." });
  equal(git(repo, "rev-parse", `${next}~1`), fix);
  deepStrictEqual(untouched(repo), before);
});

test("a snapshot equal to its commit gets no source commit, and a branch moved by something else is a setup error", async () => {
  const repo = repository();
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "everything");
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  const widened = join(scratch(), "widened");
  write(widened, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  write(widened, "Chummer/untracked.cs", "new");
  write(widened, "Core/XmlManager.cs", "class XmlManager {}");
  const branch = new AcceptedBranch(processBranchGit(repo), "wf-2", join(scratch(), "promote.index"));
  const trailers = { thread: "wf-2", cluster: "d-1", record: "wf-2/d-1/repair/1" };
  const fix = committed({ branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, widenedSource: widened, trailers, summary: "s" });
  equal(git(repo, "rev-parse", `${fix}~1`), snapshot.commit);
  git(repo, "update-ref", branch.ref, snapshot.commit);
  throws(() => promote({ branch, base: snapshot.commit, accepted: fix, snapshotFolder: snapshot.folder, widenedSource: widened, trailers: { ...trailers, record: "wf-2/d-2/repair/1" }, summary: "s" }),
    (error) => error instanceof SetupError && /something else moved it/.test(error.message));
  notEqual(branch.tip(), fix);
});

test("a widened source that stages the accepted tree has nothing to commit", async () => {
  const repo = repository();
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  const branch = new AcceptedBranch(processBranchGit(repo), "wf-3", join(scratch(), "promote.index"));
  equal(promote({ branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, widenedSource: snapshot.folder, trailers: { thread: "wf-3", cluster: "d-1", record: "r" }, summary: "s" }), null);
  equal(branch.tip(), null);
});

test("a widened source without Core/ is a setup error, and so is a folder to commit that it lacks", async () => {
  const repo = repository();
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  const branch = new AcceptedBranch(processBranchGit(repo), "wf-6", join(scratch(), "promote.index"));
  const promotion = { branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, trailers: { thread: "wf-6", cluster: "d-1", record: "r" }, summary: "s" };
  const withoutCore = join(scratch(), "widened");
  cpSync(join(snapshot.folder, "Chummer"), join(withoutCore, "Chummer"), { recursive: true });
  throws(() => promote({ ...promotion, widenedSource: withoutCore }), (error) => error instanceof SetupError && /has no Core\/, which the candidate is compiled from/.test(error.message));
  const complete = join(scratch(), "widened");
  cpSync(snapshot.folder, complete, { recursive: true });
  write(complete, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  throws(() => promote({ ...promotion, widenedSource: complete, alsoCommitted: ["fixes"] }), SetupError);
  equal(branch.tip(), null);
});

test("a folder committed beside Chummer/ does not make an unchanged Chummer/ a change", async () => {
  const repo = repository();
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  const branch = new AcceptedBranch(processBranchGit(repo), "wf-4", join(scratch(), "promote.index"));
  const widened = join(scratch(), "widened");
  cpSync(snapshot.folder, widened, { recursive: true });
  write(widened, "fixes/openspec/changes/archive/2026-10-02-fix-d-1/fix.json", "{}");
  const promotion = { branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, widenedSource: widened, trailers: { thread: "wf-4", cluster: "d-1", record: "r" }, summary: "s" };
  equal(promote({ ...promotion, alsoCommitted: ["fixes"] }), null);
  equal(branch.tip(), null);
  // With a change in Chummer/ the folder goes into the fix commit.
  write(widened, "Chummer/frmCreate.cs", "class frmCreate { int restored; }");
  const commit = committed({ ...promotion, alsoCommitted: ["fixes"] });
  deepStrictEqual(git(repo, "diff", "--name-only", `${commit}~1`, commit).split("\n").sort(), ["Chummer/frmCreate.cs", "fixes/openspec/changes/archive/2026-10-02-fix-d-1/fix.json"]);
});

test("the widened source and the accepted branch hold Core/ beside Chummer/, and a patch of Core/ applies and is committed", async () => {
  const root = scratch("workflow-widened-");
  write(root, "accepted/Chummer/frmCreate.cs", "class frmCreate {}");
  write(root, "accepted/Core/XmlManager.cs", "class XmlManager { int moved; }");
  const { archive, files } = archiveWithPatch(join(root, "attempt-1"), { "Core/XmlManager.cs": { before: "class XmlManager { int moved; }", after: "class XmlManager { int restored; }" } });
  const target = join(root, "widened", "source");
  deepStrictEqual(prepareWidenedSource(join(root, "accepted"), archive, files, target), []);
  equal(readFileSync(join(target, "Core/XmlManager.cs"), "utf8"), "class XmlManager { int restored; }");
  equal(readFileSync(join(target, "Chummer/frmCreate.cs"), "utf8"), "class frmCreate {}");

  const repo = repository();
  write(repo, "Core/XmlManager.cs", "class XmlManager { int moved; }");
  const snapshot = await createSourceSnapshot(repo, join(scratch(), "source"), processGit(repo));
  ok(existsSync(join(snapshot.folder, "Core/XmlManager.cs")));
  const widened = join(scratch(), "widened");
  cpSync(join(snapshot.folder, "Chummer"), join(widened, "Chummer"), { recursive: true });
  write(widened, "Core/XmlManager.cs", "class XmlManager { int restored; }");
  const branch = new AcceptedBranch(processBranchGit(repo), "wf-5", join(scratch(), "promote.index"));
  const fix = committed({ branch, base: snapshot.commit, accepted: null, snapshotFolder: snapshot.folder, widenedSource: widened, trailers: { thread: "wf-5", cluster: "d-1", record: "r" }, summary: "s" });
  // The snapshot's untracked library is in the source commit, the fix changes only it.
  equal(git(repo, "show", `${fix}~1:Core/XmlManager.cs`), "class XmlManager { int moved; }");
  equal(git(repo, "diff", "--name-only", `${fix}~1`, fix), "Core/XmlManager.cs");
});
