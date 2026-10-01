import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecutionCoverage } from "../../contracts/generated/typescript/parity-execution-coverage.js";
import type { CompareReport, Discrepancy, ReportRow } from "../../contracts/generated/typescript/parity-compare-report.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import { SetupError } from "../src/host/setup-error.js";
import { readCaseDetails } from "../src/steps/case-details.js";
import type { StepOutcome } from "../src/steps/step-outcome.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { clusterMembers, positionMatch, type Member } from "../src/triage/clusters.js";
import { assignIdentities, IdentityRecordSchema, namespaceFor, newIdentityId } from "../src/triage/identity.js";
import { runTriage } from "../src/triage/triage.js";
import { TriageDocumentSchema } from "../src/triage/triage-document.js";

const examples = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "contracts", "examples");
const exampleReport = JSON.parse(readFileSync(join(examples, "parity-compare-report.example.json"), "utf8")) as CompareReport;

type Spot = { capture: string; hash: string; x: number; y: number };

function discrepancy(caseName: string, spot: Spot, index: number): Discrepancy {
  const id = `${caseName}/${spot.capture}#${index}`;
  return {
    id, case: caseName, capture: spot.capture, core: { x: spot.x, y: spot.y, width: 20, height: 10 },
    crop: { x: spot.x - 5, y: spot.y - 5, width: 30, height: 20 }, differingPixels: 50, imageHash: spot.hash,
    canonicalCrop: `compare/crops/${caseName}/${spot.capture}.${index}.canonical.png`,
    candidateCrop: `compare/crops/${caseName}/${spot.capture}.${index}.candidate.png`,
    canonicalOcr: { status: "disabled" }, candidateOcr: { status: "disabled" }, representative: id,
  };
}

function row(caseName: string, capture: string, status: ReportRow["status"]): ReportRow {
  return {
    case: caseName, characterFile: `${caseName}.chum`, mode: "build", capture, status, difference: 0.1,
    canonicalSize: { width: 1000, height: 600 }, candidateSize: { width: 1000, height: 600 }, discrepancies: [],
  };
}

/** Writes a run folder with the example coverage and results and a report holding the given discrepancies. */
function runFolder(root: string, caseName: string, spots: Spot[], extraRows: ReportRow[] = []): string {
  const folder = join(root, caseName);
  mkdirSync(join(folder, "compare"), { recursive: true });
  copyFileSync(join(examples, "parity-execution-coverage.example.json"), join(folder, "coverage.json"));
  copyFileSync(join(examples, "parity-capture-results.example.json"), join(folder, "results.json"));
  const discrepancies = spots.map((spot, index) => discrepancy(caseName, spot, index + 1));
  const captures = [...new Set(spots.map((spot) => spot.capture))];
  const report: CompareReport = {
    ...exampleReport,
    rows: [...captures.map((capture) => ({ ...row(caseName, capture, "analyzed"), discrepancies: discrepancies.filter((item) => item.capture === capture).map((item) => item.id) })), ...extraRows],
    discrepancies,
    groups: discrepancies.map((item) => ({ representative: item.id, members: [item.id] })),
    completeness: { complete: true, entries: [], totals: exampleReport.completeness.totals },
  };
  writeFileSync(join(folder, "compare", "report.json"), JSON.stringify(report));
  return folder;
}

function input(threadId: string, folders: Record<string, string>) {
  const plan = Object.keys(folders).map((name): PlannedCase => ({
    name, characterFile: `${name}.chum`, fixturePath: "", mode: "build", actions: [], startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null,
  }));
  const outcomes: Record<string, StepOutcome> = Object.fromEntries(Object.entries(folders).map(([name, folder]) =>
    [name, { case: name, status: 1, runFolder: folder, key: "k", reusedFrom: null }]));
  return { threadId, plan, captures: outcomes, compares: outcomes };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "workflow-triage-"));
}

const now = new Date("2026-10-01T00:00:00Z");

test("the same change in two cases is one cluster; the same hash far away is another", async () => {
  const root = scratch();
  const store = new SqliteStore(join(root, "store.sqlite"));
  const summary = await runTriage(input("t1", {
    a: runFolder(root, "a", [{ capture: "common", hash: "h1", x: 100, y: 100 }, { capture: "skills", hash: "h1", x: 800, y: 400 }]),
    b: runFolder(root, "b", [{ capture: "gear", hash: "h1", x: 103, y: 101 }, { capture: "gear", hash: "h2", x: 100, y: 100 }]),
  }), store, join(root, "thread"), now);
  const document = TriageDocumentSchema.parse(JSON.parse(readFileSync(summary.path, "utf8")));
  deepStrictEqual(document.clusters.map((cluster) => [cluster.imageHash, cluster.cases, cluster.captures, cluster.members.length]), [
    ["h1", ["a", "b"], ["common", "gear"], 2], ["h1", ["a"], ["skills"], 1], ["h2", ["b"], ["gear"], 1],
  ]);
  deepStrictEqual([summary.discrepancies, summary.clusters, summary.newClusters], [4, 3, 3]);
  ok(document.clusters[0]!.members[0]!.canonicalCrop.startsWith(join(root, "a")));
  deepStrictEqual(document.cases.map((item) => [item.case, item.execution.coverageValid, item.visual.reportStatus]),
    [["a", exampleCoverageValid(), exampleReport.status], ["b", exampleCoverageValid(), exampleReport.status]]);
  store.close();
});

function exampleCoverageValid(): boolean {
  return (JSON.parse(readFileSync(join(examples, "parity-execution-coverage.example.json"), "utf8")) as { valid: boolean }).valid;
}

test("a later thread gets the stored identity for the same change, also a few pixels away", async () => {
  const root = scratch();
  const storePath = join(root, "store.sqlite");
  const first = new SqliteStore(storePath);
  await runTriage(input("t1", { a: runFolder(join(root, "1"), "a", [{ capture: "common", hash: "h1", x: 100, y: 100 }]) }), first, join(root, "t1"), now);
  first.close();
  const second = new SqliteStore(storePath);
  const later = await runTriage(input("t2", {
    b: runFolder(join(root, "2"), "b", [{ capture: "other", hash: "h1", x: 104, y: 102 }, { capture: "other", hash: "h3", x: 1, y: 1 }]),
  }), second, join(root, "t2"), now);
  const firstDocument = TriageDocumentSchema.parse(JSON.parse(readFileSync(join(root, "t1", "triage.json"), "utf8")));
  const laterDocument = TriageDocumentSchema.parse(JSON.parse(readFileSync(later.path, "utf8")));
  equal(laterDocument.clusters[0]!.id, firstDocument.clusters[0]!.id);
  deepStrictEqual(laterDocument.clusters.map((cluster) => cluster.known), [true, false]);
  deepStrictEqual([laterDocument.totals.knownClusters, laterDocument.totals.newClusters], [1, 1]);
  ok(/^d-[0-9a-f]{16}$/.test(laterDocument.clusters[1]!.id));
  second.close();
});

test("rows without pixel analysis and lost captures are listed apart from the clusters", async () => {
  const root = scratch();
  const folder = runFolder(root, "a", [], [row("a", "spells", "missing-candidate"), { ...row("a", "gear", "failed"), failure: "unreadable" }]);
  const reportFile = join(folder, "compare", "report.json");
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as CompareReport;
  report.completeness.entries = [{ case: "a", capture: "magic", state: "execution-lost", detail: "failed on canonical" }];
  writeFileSync(reportFile, JSON.stringify(report));
  const summary = await runTriage(input("t1", { a: folder }), new SqliteStore(":memory:"), join(root, "thread"), now);
  const document = TriageDocumentSchema.parse(JSON.parse(readFileSync(summary.path, "utf8")));
  deepStrictEqual(document.otherFindings, [
    { case: "a", capture: "spells", kind: "missing-candidate" },
    { case: "a", capture: "gear", kind: "failed", detail: "unreadable" },
    { case: "a", capture: "magic", kind: "execution-lost", detail: "failed on canonical" },
  ]);
  equal(summary.clusters, 0);
});

test("a report that does not match its schema is a setup error", async () => {
  const root = scratch();
  const folder = runFolder(root, "a", []);
  writeFileSync(join(folder, "compare", "report.json"), JSON.stringify({ status: "clear" }));
  await rejects(runTriage(input("t1", { a: folder }), new SqliteStore(":memory:"), join(root, "thread"), now), SetupError);
});

test("clusters follow the comparer's position rule", () => {
  const size = { width: 1000, height: 600 };
  const at = (x: number) => ({ core: { x, y: 0, width: 10, height: 10 }, captureSize: size });
  equal(positionMatch(at(0), at(0)), 100);
  // Only x moves: two of the four coordinates lose |Δ| / 1000 each.
  equal(positionMatch(at(0), at(60)), 97);
  ok(positionMatch(at(0), at(61)) < 97);
  equal(clusterMembers([]).length, 0);
});

test("the store gets, puts, deletes and searches by namespace prefix", async () => {
  const store = new SqliteStore(":memory:");
  await store.put(["discrepancy", "h1"], "d-1", { n: 1 });
  await store.put(["discrepancy", "h1"], "d-2", { n: 2 });
  await store.put(["discrepancy", "h10"], "d-3", { n: 3 });
  await store.put(["discrepancy", "h1"], "d-1", { n: 11 });
  deepStrictEqual((await store.get(["discrepancy", "h1"], "d-1"))?.value, { n: 11 });
  deepStrictEqual((await store.search(["discrepancy", "h1"])).map((item) => item.key), ["d-1", "d-2"]);
  deepStrictEqual((await store.search(["discrepancy"], { limit: 2, offset: 1 })).map((item) => item.key), ["d-2", "d-3"]);
  await store.delete(["discrepancy", "h1"], "d-2");
  equal(await store.get(["discrepancy", "h1"], "d-2"), null);
  await rejects(store.search(["discrepancy"], { filter: { n: 1 } }), /prefix search only/);
  await rejects(store.listNamespaces(), /listing namespaces/);
  store.close();
});

test("the canonical source of a case is live, cache or mixed, and the run's contiguity and failures are read", async () => {
  const root = scratch();
  const folder = runFolder(root, "a", []);
  const coverage = JSON.parse(readFileSync(join(folder, "coverage.json"), "utf8")) as ExecutionCoverage;
  const setSources = (...sources: ("cache" | "live")[]) => {
    const [first] = coverage.cases;
    coverage.cases = sources.map((source) => ({
      ...first!, sides: first!.sides.map((side) => ({ ...side, source: side.side === "canonical" ? source : "live" })),
    }));
    writeFileSync(join(folder, "coverage.json"), JSON.stringify(coverage));
    return readCaseDetails(folder, true);
  };
  equal(setSources("live").execution.canonicalSource, "live");
  equal(setSources("cache").execution.canonicalSource, "cache");
  equal(setSources("cache", "live").execution.canonicalSource, "mixed");
  const details = setSources("live");
  deepStrictEqual([details.execution.contiguous, details.execution.failures, details.visual.report?.status], [true, coverage.totals.failures, exampleReport.status]);
  equal(readCaseDetails(folder, false).visual.report, null);

  const summary = await runTriage(input("t1", { a: folder }), new SqliteStore(join(root, "store.sqlite")), join(root, "thread"), now);
  const triage = TriageDocumentSchema.parse(JSON.parse(readFileSync(summary.path, "utf8")));
  equal(triage.cases[0]!.execution.canonicalSource, "live");
  setSources("cache", "live");
  const mixed = await runTriage(input("t2", { a: folder }), new SqliteStore(join(root, "store2.sqlite")), join(root, "thread2"), now);
  equal(TriageDocumentSchema.parse(JSON.parse(readFileSync(mixed.path, "utf8"))).cases[0]!.execution.canonicalSource, "mixed");
});
test("triage run again in the same thread keeps its identities and still reports them as new", async () => {
  const root = scratch();
  const store = new SqliteStore(join(root, "store.sqlite"));
  const folders = { a: runFolder(root, "a", [{ capture: "common", hash: "h1", x: 100, y: 100 }]) };
  const first = TriageDocumentSchema.parse(JSON.parse(readFileSync((await runTriage(input("t1", folders), store, join(root, "thread"), now)).path, "utf8")));
  const again = await runTriage(input("t1", folders), store, join(root, "thread"), now);
  const second = TriageDocumentSchema.parse(JSON.parse(readFileSync(again.path, "utf8")));
  deepStrictEqual(second.clusters.map((cluster) => [cluster.id, cluster.known]), [[first.clusters[0]!.id, false]]);
  equal(again.newClusters, 1);
  const later = TriageDocumentSchema.parse(JSON.parse(readFileSync((await runTriage(input("t2", folders), store, join(root, "thread2"), now)).path, "utf8")));
  deepStrictEqual(later.clusters.map((cluster) => [cluster.id, cluster.known]), [[first.clusters[0]!.id, true]]);
});
test("a derived identity that already names another identity is never overwritten", async () => {
  const root = scratch();
  const store = new SqliteStore(join(root, "store.sqlite"));
  const member: Member = {
    case: "a", capture: "common", runFolder: root, discrepancy: "a/common#1", imageHash: "h1", core: { x: 100, y: 100, width: 20, height: 10 },
    crop: { x: 95, y: 95, width: 30, height: 20 }, captureSize: { width: 1000, height: 600 }, differingPixels: 50, canonicalCrop: "c", candidateCrop: "d",
  };
  const [cluster] = clusterMembers([member]);
  const taken = newIdentityId(cluster!);
  const earlier = IdentityRecordSchema.parse({
    core: { x: 900, y: 500, width: 20, height: 10 }, captureSize: { width: 1000, height: 600 }, case: "z", capture: "other",
    firstThread: "t0", firstSeenUtc: "2026-01-01T00:00:00.000Z",
  });
  await store.put(namespaceFor("h1"), taken, earlier);
  const [identity] = await assignIdentities([cluster!], store, "t1", now);
  equal(identity!.known, false);
  ok(identity!.id !== taken && /^d-[0-9a-f]{16}$/.test(identity!.id), identity!.id);
  deepStrictEqual((await store.get(namespaceFor("h1"), taken))?.value, earlier);
  equal((await store.get(namespaceFor("h1"), identity!.id))?.value["firstThread"], "t1");
});