import { deepStrictEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore } from "@langchain/langgraph";
import { processGit } from "../src/diagnosis/source-snapshot.js";
import { addBenchmarkItem, checkBenchmarkItem, isRevert, parsePatch, readBenchmark, rootCauseOfItem, type BenchmarkItem } from "../src/evals/benchmark.js";
import { getRecord, listRecords, noLabels, putRecord, readRecord, recordNamespace, setLabels } from "../src/evals/eval-record.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { labelHindsight } from "../src/evals/hindsight.js";
import { gradeExplanation, rootCauseOfExplanation, type RootCause } from "../src/evals/root-cause.js";
import { SetupError } from "../src/host/setup-error.js";
import { workflowPaths } from "../src/paths.js";
import { challengeOutput, evalContext, explanation, fixRepository, hypothesisOutput, record } from "./eval-fixtures.js";

const root: RootCause = {
  source: "benchmark:x", mechanism: "layout",
  files: [{ path: "Chummer/frmCreate.cs", ranges: [{ start: 50, end: 52 }], symbols: ["private void InitializeComponent()"], changedLines: ["this.lblSource.Location = new Point(628, 32);"] }],
};

test("a version-1 record is read as a workflow record with empty labels, and setting a label keeps the rest", async () => {
  const { schemaVersion: _version, origin: _origin, labels: _labels, ...rest } = record();
  const old = { ...rest, schemaVersion: 1, labels: { check: "confirmed" } };
  const upgraded = readRecord(old);
  equal(upgraded.schemaVersion, 2);
  equal(upgraded.origin, "workflow");
  deepStrictEqual(upgraded.labels, { ...noLabels, check: "confirmed" });
  const store = new InMemoryStore();
  await store.put(recordNamespace("hypothesis"), upgraded.recordId, old);
  await setLabels(store, upgraded, { review: { verdict: "correct", note: null, reviewer: "me", reviewedUtc: "t" } });
  const stored = (await store.get(recordNamespace("hypothesis"), upgraded.recordId))!.value as Record<string, unknown>;
  equal(stored["schemaVersion"], 2);
  const after = await getRecord(store, "hypothesis", upgraded.recordId);
  deepStrictEqual(after.labels, { ...noLabels, check: "confirmed", review: { verdict: "correct", note: null, reviewer: "me", reviewedUtc: "t" } });
  deepStrictEqual({ ...after, labels: null }, { ...upgraded, labels: null });
  throws(() => readRecord({ ...record(), labels: { ...noLabels, grader: { score: 1.5, rationale: "r", record: "g", gradedUtc: "t" } } }));
});

test("records are listed across job kinds and pages", async () => {
  const store = new InMemoryStore();
  for (let index = 0; index < 205; index++) await putRecord(store, record({ recordId: `r${index}` }));
  await putRecord(store, record({ recordId: "c", jobKind: "challenge", output: challengeOutput(null) }));
  equal((await listRecords(store)).length, 206);
});

test("grades: a line near a changed range or a named symbol, a file, a mechanism, wrong and abstained", () => {
  const at = (line: number | null, symbol: string | null = null, path = "Chummer/frmCreate.cs", mechanism: "layout" | "data" = "layout") =>
    gradeExplanation(explanation({ mechanism, locations: [{ path, symbol, line }] }), root);
  equal(at(53), "symbol");
  equal(at(55), "symbol");
  equal(at(56), "file");
  equal(at(null, "InitializeComponent"), "symbol");
  equal(at(null, "lblSource"), "symbol");
  // Right file, wrong line: 40 lines away and a symbol the fix does not mention.
  equal(at(92, "frmCareer"), "file");
  equal(at(50, null, "Chummer\\frmCreate.cs"), "symbol");
  equal(at(50, null, "Chummer/frmCareer.cs"), "mechanism");
  equal(at(50, null, "Chummer/frmCareer.cs", "data"), "wrong");
  equal(gradeExplanation(null, root), "abstained");
  const reviewed = rootCauseOfExplanation("review:r", explanation({ locations: [{ path: "Chummer/a.cs", symbol: "Foo", line: 10 }] }));
  equal(gradeExplanation(explanation({ locations: [{ path: "Chummer/a.cs", symbol: null, line: 12 }] }), reviewed), "symbol");
  equal(gradeExplanation(explanation({ locations: [{ path: "Chummer/a.cs", symbol: "Bar", line: 30 }] }), reviewed), "file");
});

test("a diff is parsed into files and hunks, and a fix that undoes its regression is a revert", () => {
  const patch = [
    "diff --git a/Chummer/a.cs b/Chummer/a.cs", "index 1..2 100644", "--- a/Chummer/a.cs", "+++ b/Chummer/a.cs",
    "@@ -5,3 +5,3 @@ class A", " keep", "-old line", "+new line", " keep", "@@ -40 +40 @@", "--- x", "+-- y",
    "diff --git a/Chummer/gone.cs b/Chummer/gone.cs", "deleted file mode 100644", "--- a/Chummer/gone.cs", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a", "-b", "",
  ].join("\r\n");
  deepStrictEqual(parsePatch(patch), [
    { path: "Chummer/a.cs", hunks: [
      { oldStart: 5, oldLines: 3, header: "class A", removed: ["old line"], added: ["new line"] },
      { oldStart: 40, oldLines: 1, header: "", removed: ["-- x"], added: ["-- y"] },
    ] },
    { path: "Chummer/gone.cs", hunks: [{ oldStart: 1, oldLines: 2, header: "", removed: ["a", "b"], added: [] }] },
  ]);
  const regression = parsePatch(["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -1 +1 @@", "-x = 1", "+x = 2"].join("\n"));
  equal(isRevert(parsePatch(["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -1 +1 @@", "-x = 2", "+x = 1"].join("\n")), regression), true);
  equal(isRevert(parsePatch(["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -1 +1 @@", "-x = 2", "+x = 3"].join("\n")), regression), false);
  equal(isRevert(parsePatch(["diff --git a/g b/g", "--- a/g", "+++ b/g", "@@ -1 +1 @@", "-x = 2", "+x = 1"].join("\n")), regression), false);
});

test("benchmark add writes a replayable item from git and the thread's triage", async () => {
  const repo = fixRepository();
  const git = processGit(repo.root);
  const input = { clusterId: "d-0000000000000100", fix: repo.fix, mechanism: "layout", regression: null, threadId: null, threadsFolder: repo.threads, benchmarkFolder: repo.benchmark };
  const item = addBenchmarkItem(git, input);
  equal(item.kind, "fix");
  equal(item.itemId, `d-0000000000000100-${repo.fix.slice(0, 12)}`);
  equal(item.base.commit, repo.regression);
  equal(item.fix.committedUtc, "2026-10-02T00:00:00.000Z");
  equal(item.provenance.threadId, "wf-1");
  deepStrictEqual(item.discrepancy.members, [{ case: "build-alpha", capture: "skills" }]);
  deepStrictEqual(item.fix.files.map((file) => file.path), ["Chummer/frmCreate.cs"]);
  deepStrictEqual(item.fix.files[0]!.hunks[0]!.removed, ["    Point location = new Point(640, 32);"]);
  deepStrictEqual(rootCauseOfItem(item).files[0]!.ranges, [{ start: 2, end: 8 }]);
  deepStrictEqual(readBenchmark(repo.benchmark), [item]);
  deepStrictEqual(checkBenchmarkItem(git, item), []);
  throws(() => addBenchmarkItem(git, input), /exists already/);

  const revert = addBenchmarkItem(git, { ...input, regression: repo.regression, benchmarkFolder: join(repo.root, "other") });
  equal(revert.kind, "revert");
  equal(revert.regression?.commit, repo.regression);
});

test("benchmark add refuses an unknown cluster, commit or mechanism, a merge and an empty patch, and writes nothing", () => {
  const repo = fixRepository();
  const git = processGit(repo.root);
  const input = { clusterId: "d-0000000000000100", fix: repo.fix, mechanism: "layout", regression: null, threadId: null, threadsFolder: repo.threads, benchmarkFolder: repo.benchmark };
  throws(() => addBenchmarkItem(git, { ...input, clusterId: "d-ffff" }), /No thread's triage.json has the cluster d-ffff/);
  throws(() => addBenchmarkItem(git, { ...input, fix: "0123456789" }), /does not know the commit '0123456789'/);
  throws(() => addBenchmarkItem(git, { ...input, mechanism: "magic" }), /--mechanism must be one of/);
  throws(() => addBenchmarkItem(git, { ...input, fix: repo.docs }), /changes nothing under Chummer/);
  repo.git("checkout", "-q", "-b", "side", repo.regression);
  repo.git("commit", "-q", "--allow-empty", "-m", "side");
  repo.git("checkout", "-q", "-");
  repo.git("merge", "-q", "--no-ff", "-m", "merge", "side");
  throws(() => addBenchmarkItem(git, { ...input, fix: "HEAD" }), /has 2 parents/);
  equal(existsSync(repo.benchmark), false);
});

test("benchmark check names an item whose patch git no longer gives or whose commit is missing", async () => {
  const repo = fixRepository();
  const git = processGit(repo.root);
  const item = addBenchmarkItem(git, { clusterId: "d-0000000000000100", fix: repo.fix, mechanism: "layout", regression: null, threadId: "wf-1", threadsFolder: repo.threads, benchmarkFolder: repo.benchmark });
  const changed: BenchmarkItem = { ...item, fix: { ...item.fix, patch: `${item.fix.patch}\n` } };
  match(checkBenchmarkItem(git, changed).join(), /differs from the stored patch/);
  match(checkBenchmarkItem(git, { ...item, base: { commit: "f".repeat(40) } }).join(), /base commit f+ is missing/);
  const path = join(repo.benchmark, `${item.itemId}.json`);
  writeFileSync(path, JSON.stringify(changed));
  const paths = { ...workflowPaths(repo.root), benchmark: repo.benchmark };
  await rejects(runEvalCommand(["benchmark", "check"], evalContext({ paths, git })),
    (error: unknown) => error instanceof SetupError && /differs from the stored patch/.test(error.message));
  ok(readFileSync(path, "utf8").length > 0);
});

test("hindsight grades the answers before the earliest fix of their cluster, and nothing after it", async () => {
  const repo = fixRepository();
  const item = addBenchmarkItem(processGit(repo.root), { clusterId: "d-0000000000000100", fix: repo.fix, mechanism: "layout", regression: null, threadId: null, threadsFolder: repo.threads, benchmarkFolder: repo.benchmark });
  const later: BenchmarkItem = { ...item, itemId: "later", fix: { ...item.fix, committedUtc: "2026-11-01T00:00:00.000Z", mechanism: "data" } };
  const store = new InMemoryStore();
  await putRecord(store, record({ recordId: "right" }));
  await putRecord(store, record({ recordId: "file", output: hypothesisOutput(explanation({ locations: [{ path: "Chummer/frmCreate.cs", symbol: null, line: 19 }] })) }));
  await putRecord(store, record({ recordId: "abstained", output: hypothesisOutput(null) }));
  await putRecord(store, record({ recordId: "alt", jobKind: "challenge", output: challengeOutput(explanation({ mechanism: "data", locations: [{ path: "bin/data/x.xml", symbol: null, line: 1 }] })) }));
  await putRecord(store, record({ recordId: "after-first", finishedUtc: "2026-10-15T00:00:00.000Z" }));
  await putRecord(store, record({ recordId: "after-all", finishedUtc: "2026-12-01T00:00:00.000Z" }));
  await putRecord(store, record({ recordId: "failed", result: { status: "invalid_output", message: "m" }, output: null }));
  await putRecord(store, record({ recordId: "eval", origin: "eval-run" }));
  await putRecord(store, record({ recordId: "other", subject: { kind: "discrepancy-cluster", id: "d-other" } }));
  const summary = await labelHindsight(store, [later, item], () => new Date("2026-12-02T00:00:00Z"));
  const grade = async (id: string, kind: "hypothesis" | "challenge" = "hypothesis") => (await getRecord(store, kind, id)).labels.hindsight;
  deepStrictEqual(await grade("right"), { grade: "symbol", item: item.itemId, labelledUtc: "2026-12-02T00:00:00.000Z" });
  equal((await grade("file"))?.grade, "file");
  equal((await grade("abstained"))?.grade, "abstained");
  equal((await grade("alt", "challenge"))?.grade, "wrong");
  // Finished after the first fix: graded by the later item only.
  deepStrictEqual(await grade("after-first"), { grade: "symbol", item: "later", labelledUtc: "2026-12-02T00:00:00.000Z" });
  for (const id of ["after-all", "failed", "eval", "other"]) equal(await grade(id), null, id);
  deepStrictEqual(summary, { graded: 5, changed: 5, grades: { symbol: 2, file: 1, mechanism: 0, wrong: 1, abstained: 1 } });
  equal((await labelHindsight(store, [later, item], () => new Date())).changed, 0);
});

test("eval records counts records by origin and job kind with their labels", async () => {
  const store = new InMemoryStore();
  await putRecord(store, record({ labels: { ...noLabels, check: "confirmed" } }));
  await putRecord(store, record({ recordId: "e", origin: "eval-run" }));
  const context = evalContext({ store });
  const lines = context.lines;
  equal(await runEvalCommand(["records"], context), 0);
  deepStrictEqual(lines, [
    "Eval records: 2.",
    "eval-run hypothesis: 1; results succeeded 1", "  check none; hindsight none; review none; graded 0",
    "workflow hypothesis: 1; results succeeded 1", "  check confirmed 1; hindsight none; review none; graded 0",
  ]);
  await rejects(runEvalCommand(["records", "--x"], context), /Unknown option '--x' for 'records'/);
  await rejects(runEvalCommand(["nope"], context), /Unknown command 'nope'/);
});
