import { deepStrictEqual, equal, notEqual, ok, rejects, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { certificatePath } from "../src/evals/certificate.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { processBranchGit, processCheckoutGit } from "../src/git/branch-git.js";
import { SetupError } from "../src/host/setup-error.js";
import { readActiveFile, tuningFiles } from "../src/tuning/active-configuration.js";
import { autoTuningPath, readAutoTuning } from "../src/tuning/auto-tuning.js";
import { cycleFolder, readCycle } from "../src/tuning/cycle.js";
import { readLedger } from "../src/tuning/holdout.js";
import type { TuningStateValue } from "../src/tuning/tuning-graph.js";
import { compileTuningGraph } from "../src/tuning/tuning-runner.js";
import { autoCycleId } from "../src/tuning/tuning-steps.js";
import { TuningRepository } from "../src/tuning/tuning-workspace.js";
import type { JobCall } from "./diagnosis-harness.js";
import { scratch, write } from "./diagnosis-fixtures.js";
import { agents, dueTuning, proposal, refusingSteps, testCluster } from "./tuning-auto-fixtures.js";

/** A repository on `main` with the tuning and certificates folders of a checkout, `out/` ignored as in the repository. */
function tuningRepository(autocrlf = false) {
  const root = scratch("workflow-tuning-repo-");
  const run = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("config", "core.autocrlf", String(autocrlf));
  write(root, ".gitignore", "/out/\n");
  write(root, "README.md", "readme\n");
  write(root, "workflow/evals/certificates/README.md", "Certificates.\n");
  run("add", "-A");
  run("commit", "-q", "-m", "initial");
  const tuningFolder = join(root, "workflow", "evals", "tuning");
  const certificatesFolder = join(root, "workflow", "evals", "certificates");
  /** Commits `edits` on `main` in the repository's checkout. */
  const commit = (subject: string, edits: Readonly<Record<string, string>>) => {
    for (const [path, text] of Object.entries(edits)) write(root, path, text);
    run("add", "-A");
    run("commit", "-q", "-m", subject);
    return run("rev-parse", "HEAD");
  };
  return { root, run, tuningFolder, certificatesFolder, commit, folders: { tuningFolder: () => tuningFolder, certificatesFolder: () => certificatesFolder } };
}

type Repository = ReturnType<typeof tuningRepository>;

/** Agents for a cycle that activates its candidate; `during` runs once on the first hypothesis job of the holdout run. */
function activating(during?: (call: JobCall) => void) {
  let ran = false;
  return agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }, (call) => {
    if (!ran && during !== undefined && call.prompt.includes("+tuned-") && call.prompt.includes(testCluster)) {
      ran = true;
      during(call);
    }
    return false;
  });
}

function finished(evalsFolder: string) {
  const state = readAutoTuning(evalsFolder);
  equal(state.current, null);
  return state.tunings.at(-1)!;
}

const trailer = (repo: Repository, commit: string, key: string) => repo.run("log", "-1", `--format=%(trailers:key=${key},valueonly)`, commit);
const treeFiles = (repo: Repository, commit: string) => repo.run("ls-tree", "-r", "--name-only", commit, "--", "workflow/evals").split("\n").filter((line) => line.length > 0);

test("an automatic tuning on folders inside the repository activates in a worktree on tuning/<cycle> and merges its files into the branch HEAD names", async () => {
  const repo = tuningRepository();
  const seen: { main: boolean; worktree: boolean }[] = [];
  let moved = "";
  let evalsFolder = "";
  const fake = activating(() => {
    // While the holdout runs, the ledger is in the worktree, not in the checkout; and the branch moves on in another file.
    const worktree = join(cycleFolder(evalsFolder, readAutoTuning(evalsFolder).current!.cycle!), "worktree");
    seen.push({ main: existsSync(tuningFiles(repo.tuningFolder).holdout), worktree: existsSync(join(worktree, "workflow", "evals", "tuning", "holdout.json")) });
    moved = repo.commit("main moved", { "README.md": "moved on\n" });
    // A temporary file a stopped write left behind is not committed.
    write(worktree, "workflow/evals/tuning/holdout.json.999.tmp", "{");
  });
  const { context } = await dueTuning(fake, repo.root, repo.folders);
  evalsFolder = context.paths.evalsFolder;
  const before = repo.run("rev-parse", "main");
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  deepStrictEqual(seen, [{ main: false, worktree: true }]);

  const entry = finished(evalsFolder);
  const cycleId = autoCycleId(entry.tuningId);
  deepStrictEqual([entry.outcome, entry.cycle, entry.branch], ["activated", cycleId, `tuning/${cycleId}`]);
  const tip = repo.run("rev-parse", "main");
  equal(entry.merge, tip);
  equal(trailer(repo, tip, "Merged-Tuning"), cycleId);
  equal(trailer(repo, tip, "Tuning"), entry.tuningId);
  equal(repo.run("log", "-1", "--format=%s", tip), `Merge tuning/${cycleId}: hypothesis activated`);
  // The tuning's commit was rebased onto the tip the branch moved to, kept on tuning/<cycle>, and merged with a merge commit.
  deepStrictEqual([repo.run("rev-parse", `${tip}^1`), repo.run("rev-parse", `${tip}^2`), repo.run("rev-parse", `tuning/${cycleId}`)], [moved, entry.commit, entry.commit]);
  equal(repo.run("rev-parse", `${entry.commit}^`), moved);
  notEqual(moved, before);
  equal(trailer(repo, entry.commit!, "Tuning-Cycle"), cycleId);
  equal(repo.run("log", "-1", "--format=%s", entry.commit!), "Tune hypothesis: activated");
  deepStrictEqual(repo.run("diff-tree", "-r", "--name-only", "--no-commit-id", `${entry.commit}^`, entry.commit!).split("\n"),
    ["workflow/evals/certificates/hypothesis.json", "workflow/evals/tuning/active/hypothesis.json", "workflow/evals/tuning/holdout.json"]);
  // The checkout was fast-forwarded: it holds the active file, the ledger and the certificate, and nothing is uncommitted.
  equal(readActiveFile(repo.tuningFolder, "hypothesis")!.active.tuning?.guidance[0], "Cite the capture.");
  equal(readLedger(repo.tuningFolder).exposures.length, 1);
  ok(existsSync(certificatePath(repo.certificatesFolder, "hypothesis")));
  equal(repo.run("rev-parse", "HEAD"), tip);
  equal(repo.run("status", "--porcelain=v1"), "");
  // The worktree and the merge's worktree are gone; the tuning branch stays.
  equal(repo.run("worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
  equal(existsSync(join(cycleFolder(evalsFolder, cycleId), "worktree")), false);
  ok(context.lines.includes(`Automatic tuning ${entry.tuningId}: branch tuning/${cycleId}, commit ${entry.commit}, merge ${tip}.`), context.lines.join("\n"));

  // Merged again, as a resumed merge node would: the trailer is reachable, so the branch stays where it is.
  const { values } = await compileTuningGraph(refusingSteps(), context.tuningCheckpointer()).getState({ configurable: { thread_id: entry.tuningId } });
  const workspace = (values as TuningStateValue).workspace!;
  deepStrictEqual(new TuningRepository(context.branchGit, context.checkoutGit, repo.root).merge(workspace, cycleId, join(scratch(), "merge"), "again", []).merge, tip);
  equal(repo.run("rev-parse", "main"), tip);
});

test("a refused activation in a worktree still commits and merges the ledger's exposure, and ends rejected", async () => {
  const repo = tuningRepository();
  const { context } = await dueTuning(agents([proposal("Overfit.")], "test", { "Overfit.": "development" }), repo.root, repo.folders);
  equal(await runEvalCommand(["tune", "auto"], context), 1, context.lines.join("\n"));
  const entry = finished(context.paths.evalsFolder);
  const cycle = readCycle(context.paths.evalsFolder, entry.cycle!);
  deepStrictEqual([entry.outcome, cycle.outcome], ["rejected", "rejected"]);
  equal(repo.run("log", "-1", "--format=%s", entry.commit!), "Tune hypothesis: rejected");
  equal(trailer(repo, repo.run("rev-parse", "main"), "Merged-Tuning"), entry.cycle);
  deepStrictEqual(treeFiles(repo, "main"), ["workflow/evals/certificates/README.md", "workflow/evals/tuning/holdout.json"]);
  deepStrictEqual(readLedger(repo.tuningFolder).exposures.map((exposure) => exposure.testRun), [cycle.holdout!.run]);
  equal(readActiveFile(repo.tuningFolder, "hypothesis"), null);
});

test("a cycle in a worktree that changes nothing commits and merges nothing", async () => {
  const repo = tuningRepository();
  const before = repo.run("rev-parse", "main");
  const { context } = await dueTuning(agents([proposal("Same as before.")], "all", { "Same as before.": "all" }), repo.root, repo.folders);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const entry = finished(context.paths.evalsFolder);
  deepStrictEqual([entry.outcome, entry.branch, entry.commit, entry.merge], ["no_improvement", `tuning/${entry.cycle}`, null, null]);
  deepStrictEqual([repo.run("rev-parse", "main"), repo.run("rev-parse", `tuning/${entry.cycle}`)], [before, before]);
  equal(existsSync(join(cycleFolder(context.paths.evalsFolder, entry.cycle!), "worktree")), false);
});

test("a due tuning whose tuning folder has an uncommitted change is a setup error naming the folder that counts and starts nothing", async () => {
  const repo = tuningRepository();
  repo.commit("ledger", { "workflow/evals/tuning/holdout.json": "{\"schemaVersion\":1,\"exposures\":[]}\n" });
  write(repo.root, "workflow/evals/tuning/holdout.json", "{\"schemaVersion\":1,\"exposures\":[] }\n");
  const fake = activating();
  const { context } = await dueTuning(fake, repo.root, repo.folders);
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("workflow/evals/tuning/holdout.json") && error.message.includes("uncommitted changes"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
  deepStrictEqual(fake.calls, []);
  deepStrictEqual(repo.run("branch", "--list", "tuning/*"), "");
  // An untracked file in the certificates folder counts as well.
  repo.run("checkout", "--", "workflow/evals/tuning/holdout.json");
  write(repo.root, "workflow/evals/certificates/hypothesis.json", "{}\n");
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("workflow/evals/certificates/hypothesis.json"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
});

test("a due tuning on folders inside the repository with a detached HEAD is a setup error that counts nothing", async () => {
  const repo = tuningRepository();
  repo.run("checkout", "-q", "--detach");
  const { context } = await dueTuning(activating(), repo.root, repo.folders);
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("HEAD is detached"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
});

test("a tuning folder git ignores is a setup error", async () => {
  const repo = tuningRepository();
  const ignored = join(repo.root, "out", "tuning");
  const { context } = await dueTuning(activating(), repo.root, { ...repo.folders, tuningFolder: () => ignored });
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes("out/tuning/holdout.json") && error.message.includes("could not commit"));
  equal(existsSync(autoTuningPath(context.paths.evalsFolder)), false);
});

test("a merge that conflicts is a setup error naming the branch; resumed after the branch is rebased, the tuning merges", async () => {
  const repo = tuningRepository();
  // While the holdout runs, the branch gets a ledger of its own: the tuning's commit no longer rebases onto it.
  const ledger = "{\"schemaVersion\":1,\"exposures\":[]}\n";
  const { context } = await dueTuning(activating(() => repo.commit("a ledger on main", { "workflow/evals/tuning/holdout.json": ledger })), repo.root, repo.folders);
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && /tuning\/tc-\S+ does not merge into main/.test(error.message)
    && error.message.includes("workflow/evals/tuning/holdout.json"));
  const stopped = readAutoTuning(context.paths.evalsFolder).current!;
  const cycleId = stopped.cycle!;
  const branch = `tuning/${cycleId}`;
  deepStrictEqual([stopped.branch, stopped.commit !== null, stopped.merge, stopped.outcome], [branch, true, null, null]);
  deepStrictEqual([...(await compileTuningGraph(refusingSteps(), context.tuningCheckpointer()).getState({ configurable: { thread_id: stopped.tuningId } })).next], ["merge"]);
  equal(repo.run("show", "main:workflow/evals/tuning/holdout.json"), ledger.trim());
  equal(repo.run("status", "--porcelain=v1"), "");

  // Run again without a resolution: the same conflict, and the tuning stays in progress.
  await rejects(runEvalCommand(["tune", "auto"], context), (error: Error) => error instanceof SetupError && error.message.includes(`${branch} does not merge into main`));
  equal(readAutoTuning(context.paths.evalsFolder).current?.tuningId, stopped.tuningId);

  // A person rebases the tuning branch onto main, keeping the tuning's ledger, then runs tune auto again.
  const resolve = join(scratch(), "resolve");
  repo.run("worktree", "add", "-q", resolve, branch);
  const inResolve = (...args: string[]) => execFileSync("git", ["-C", resolve, ...args], { encoding: "utf8", env: { ...process.env, GIT_EDITOR: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  ok(((): boolean => {
    try {
      inResolve("rebase", "-q", "main");
      return false;
    } catch {
      return true;
    }
  })());
  inResolve("checkout", "--theirs", "--", "workflow/evals/tuning/holdout.json");
  inResolve("add", "workflow/evals/tuning/holdout.json");
  inResolve("rebase", "--continue");
  repo.run("worktree", "remove", resolve);
  const fake = agents([], "test", {});
  equal(await runEvalCommand(["tune", "auto"], { ...context, agents: () => fake }), 0, context.lines.join("\n"));
  deepStrictEqual(fake.calls, []);
  const entry = finished(context.paths.evalsFolder);
  const tip = repo.run("rev-parse", "main");
  deepStrictEqual([entry.tuningId, entry.outcome, entry.merge, entry.commit], [stopped.tuningId, "activated", tip, repo.run("rev-parse", branch)]);
  equal(trailer(repo, tip, "Merged-Tuning"), cycleId);
  equal(readLedger(repo.tuningFolder).exposures.length, 1);
  equal(readActiveFile(repo.tuningFolder, "hypothesis")!.active.tuning?.guidance[0], "Cite the capture.");
});

test("a tuning stopped during its holdout run in a worktree resumes there and merges", async () => {
  const repo = tuningRepository();
  const controller = new AbortController();
  let stop = true;
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }, (call) => {
    if (!stop || !call.prompt.includes("+tuned-") || !call.prompt.includes(testCluster)) return false;
    setTimeout(() => controller.abort(), 50);
    return true;
  });
  const { context } = await dueTuning(fake, repo.root, { ...repo.folders });
  await rejects(runEvalCommand(["tune", "auto"], { ...context, signal: controller.signal }), (error: Error) => error instanceof SetupError && error.message.includes("resume it with npm run eval -- tune auto"));
  const stopped = readAutoTuning(context.paths.evalsFolder).current!;
  const worktree = join(cycleFolder(context.paths.evalsFolder, stopped.cycle!), "worktree");
  ok(existsSync(join(worktree, "workflow", "evals", "tuning", "holdout.json")));
  equal(existsSync(tuningFiles(repo.tuningFolder).holdout), false);
  stop = false;
  equal(await runEvalCommand(["tune", "auto"], { ...context, signal: new AbortController().signal }), 0, context.lines.join("\n"));
  const entry = finished(context.paths.evalsFolder);
  deepStrictEqual([entry.tuningId, entry.outcome, entry.merge], [stopped.tuningId, "activated", repo.run("rev-parse", "main")]);
  equal(readLedger(repo.tuningFolder).exposures.length, 1);
  equal(existsSync(worktree), false);
});

test("a stopped tuning whose worktree was removed meanwhile is a setup error, and writes nothing in its place", async () => {
  const repo = tuningRepository();
  const controller = new AbortController();
  const fake = agents([proposal("Cite the capture.")], "test", { "Cite the capture.": "all" }, (call) => {
    if (!call.prompt.includes("+tuned-") || !call.prompt.includes(testCluster)) return false;
    setTimeout(() => controller.abort(), 50);
    return true;
  });
  const { context } = await dueTuning(fake, repo.root, repo.folders);
  await rejects(runEvalCommand(["tune", "auto"], { ...context, signal: controller.signal }), (error: Error) => error instanceof SetupError && error.message.includes("resume it with npm run eval -- tune auto"));
  const stopped = readAutoTuning(context.paths.evalsFolder).current!;
  const worktree = join(cycleFolder(context.paths.evalsFolder, stopped.cycle!), "worktree");
  repo.run("worktree", "remove", "--force", worktree);
  await rejects(runEvalCommand(["tune", "auto"], { ...context, signal: new AbortController().signal }), (error: Error) => error instanceof SetupError && error.message.includes(`The tuning's worktree ${worktree}`) && error.message.includes("is gone"));
  equal(existsSync(worktree), false);
  equal(readAutoTuning(context.paths.evalsFolder).current?.tuningId, stopped.tuningId);
});

test("a checkout made with core.autocrlf keeps its line endings: its status and fast-forward use the user's git configuration", async () => {
  const repo = tuningRepository(true);
  // The ledger is committed from a CRLF file, so the index has LF and the checkout CRLF; a newer time makes git look at its content.
  repo.commit("ledger", { "workflow/evals/tuning/holdout.json": "{\r\n  \"schemaVersion\": 1,\r\n  \"exposures\": []\r\n}\r\n" });
  const future = new Date(Date.now() + 60_000);
  utimesSync(tuningFiles(repo.tuningFolder).holdout, future, future);
  const { context } = await dueTuning(activating(), repo.root, repo.folders);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const entry = finished(context.paths.evalsFolder);
  equal(entry.merge, repo.run("rev-parse", "main"));
  equal(readLedger(repo.tuningFolder).exposures.length, 1);
  ok(readFileSync(tuningFiles(repo.tuningFolder).holdout, "utf8").includes("\r\n"));
  equal(repo.run("status", "--porcelain=v1"), "");
});

test("a tuning commit the branch has the changes of already is still merged with a merge commit that carries the trailer, and its branch keeps the commit", () => {
  const repo = tuningRepository();
  const start = repo.run("rev-parse", "main");
  const branchGit = processBranchGit(repo.root);
  const tuning = new TuningRepository(branchGit, processCheckoutGit(repo.root), repo.root);
  const workspace = tuning.open("tc-1", join(scratch(), "worktree"), { tuningFolder: repo.tuningFolder, certificatesFolder: repo.certificatesFolder });
  write(workspace.folder, "workflow/evals/tuning/holdout.json", "{}\n");
  const commit = tuning.commit(workspace, "tc-1", "Tune hypothesis: rejected\n\nTuning-Cycle: tc-1\n")!;
  equal(repo.run("rev-parse", `${commit}^`), start);
  tuning.remove(workspace);
  const moved = repo.commit("the same ledger", { "workflow/evals/tuning/holdout.json": "{}\n" });
  const first = tuning.merge(workspace, "tc-1", join(scratch(), "merge"), "Merge tuning/tc-1", []);
  deepStrictEqual(first.commit, commit);
  equal(repo.run("rev-parse", "main"), first.merge);
  deepStrictEqual([repo.run("rev-parse", `${first.merge}^1`), repo.run("rev-parse", `${first.merge}^2`), repo.run("rev-parse", "tuning/tc-1")], [moved, commit, commit]);
  equal(repo.run("rev-parse", `${first.merge}^{tree}`), repo.run("rev-parse", `${moved}^{tree}`));
  equal(trailer(repo, first.merge, "Merged-Tuning"), "tc-1");
  repo.run("merge-base", "--is-ancestor", commit, "main");
  equal(repo.run("status", "--porcelain=v1"), "");
  // Merged again, as a resumed merge node would: the trailer is reachable, so nothing changes.
  deepStrictEqual(tuning.merge(workspace, "tc-1", join(scratch(), "merge"), "Merge", []), first);
  deepStrictEqual([repo.run("rev-parse", "main"), repo.run("rev-parse", "tuning/tc-1")], [first.merge, commit]);
});

test("a commit whose message a hook rewrote without the trailer is a setup error, and nothing is merged", () => {
  const repo = tuningRepository();
  const before = repo.run("rev-parse", "main");
  const hook = join(repo.root, ".git", "hooks", "prepare-commit-msg");
  writeFileSync(hook, "#!/bin/sh\ngrep -v '^Tuning-Cycle:' \"$1\" > \"$1.new\"\nmv \"$1.new\" \"$1\"\n", { mode: 0o755 });
  const tuning = new TuningRepository(processBranchGit(repo.root), processCheckoutGit(repo.root), repo.root);
  const workspace = tuning.open("tc-2", join(scratch(), "worktree"), { tuningFolder: repo.tuningFolder, certificatesFolder: repo.certificatesFolder });
  write(workspace.folder, "workflow/evals/tuning/holdout.json", "{}\n");
  throws(() => tuning.commit(workspace, "tc-2", "Tune hypothesis: rejected\n\nTuning-Cycle: tc-2\n"),
    (error: Error) => error instanceof SetupError && error.message.includes("tuning/tc-2") && error.message.includes("does not carry Tuning-Cycle: tc-2") && error.message.includes("not merged"));
  equal(repo.run("rev-parse", "main"), before);
  notEqual(repo.run("rev-parse", "tuning/tc-2"), before);
});

test("an automatic tuning with both folders outside the repository uses them in place and commits nothing", async () => {
  const repo = tuningRepository();
  const before = repo.run("rev-parse", "main");
  const { context } = await dueTuning(activating(), repo.root);
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const entry = finished(context.paths.evalsFolder);
  deepStrictEqual([entry.outcome, entry.branch, entry.commit, entry.merge], ["activated", null, null, null]);
  equal(readActiveFile(context.tuningFolder(), "hypothesis")!.active.tuning?.guidance[0], "Cite the capture.");
  ok(existsSync(certificatePath(context.certificatesFolder(), "hypothesis")));
  deepStrictEqual([repo.run("rev-parse", "main"), repo.run("branch", "--list", "tuning/*"), repo.run("status", "--porcelain=v1")], [before, "", ""]);
  ok(context.lines.includes(`Automatic tuning ${entry.tuningId}: the tuning and certificates folders lie outside the repository; the cycle works on them in place.`), context.lines.join("\n"));
});

test("with only the tuning folder inside the repository, the certificate is written in place and the tuning files are merged", async () => {
  const repo = tuningRepository();
  const certificates = join(scratch(), "certificates");
  const { context } = await dueTuning(activating(), repo.root, { ...repo.folders, certificatesFolder: () => certificates });
  equal(await runEvalCommand(["tune", "auto"], context), 0, context.lines.join("\n"));
  const entry = finished(context.paths.evalsFolder);
  equal(entry.outcome, "activated");
  ok(existsSync(certificatePath(certificates, "hypothesis")));
  deepStrictEqual(treeFiles(repo, "main"), ["workflow/evals/certificates/README.md", "workflow/evals/tuning/active/hypothesis.json", "workflow/evals/tuning/holdout.json"]);
  equal(JSON.parse(readFileSync(tuningFiles(repo.tuningFolder).active("hypothesis"), "utf8")).active.tuning.guidance[0], "Cite the capture.");
});
