import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { copyFileSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryStore } from "@langchain/langgraph";
import type { BenchmarkItem } from "../src/evals/benchmark.js";
import { datasetFolders, freezeDataset, loadDataset, mergeObservations, partitionOf, type FreezeInput } from "../src/evals/dataset.js";
import { listRecords, setLabels } from "../src/evals/eval-record.js";
import { SetupError } from "../src/host/setup-error.js";
import { diagnosisHarness, twoClusters } from "./diagnosis-harness.js";
import { scratch } from "./diagnosis-fixtures.js";

export function benchmarkItem(clusterId: string, committedUtc: string): BenchmarkItem {
  return {
    schemaVersion: 1, itemId: `${clusterId}-fix`, kind: "fix",
    discrepancy: { clusterId, imageHash: "h", cases: ["build-alpha"], captures: ["skills"], members: [{ case: "build-alpha", capture: "skills" }] },
    base: { commit: "a".repeat(40) },
    fix: { commit: "b".repeat(40), committedUtc, mechanism: "layout", patch: "p", files: [{ path: "Chummer/frmCreate.cs", hunks: [{ oldStart: 1, oldLines: 1, header: "class frmCreate", removed: ["a"], added: ["b"] }] }] },
    regression: null, provenance: { threadId: "wf-x" },
  };
}

/** Two finished threads over the same fixture runs in one store: both diagnosed the same two clusters. */
export async function twoThreads() {
  const root = scratch();
  const store = new InMemoryStore();
  // The fake triage step writes triage.json beside the threads; the real one writes it into the thread folder.
  const run = async () => {
    const harness = diagnosisHarness({ spots: twoClusters, root, store });
    equal(await harness.start(), 1);
    copyFileSync(join(root, "triage.json"), join(root, "threads", harness.threadId(), "triage.json"));
    return harness;
  };
  const first = await run();
  const second = await run();
  const lines: string[] = [];
  const input = async (overrides: Partial<FreezeInput> = {}): Promise<FreezeInput> => ({
    name: "diag", jobKind: "hypothesis", seed: "s", testPercent: 50, reason: null, datasetsFolder: join(root, "datasets"),
    threadFolder: (id) => join(root, "threads", id), records: await listRecords(store), benchmark: [], now: () => new Date("2026-10-02T11:00:00Z"),
    log: (line) => lines.push(line), ...overrides,
  });
  return { root, store, input, lines, threads: [first.threadId(), second.threadId()] };
}

test("a frozen dataset holds one item per context with copies, observations and the partition of its cluster", async () => {
  const fixture = await twoThreads();
  const { folder, dataset } = await freezeDataset(await fixture.input());
  equal(folder, join(fixture.root, "datasets", "diag", "v1"));
  // Each thread sealed its own context of each cluster (their snapshots name different commits): four items.
  deepStrictEqual([dataset.version, dataset.previousHash, dataset.jobKind, dataset.items.length], [1, null, "hypothesis", 4]);
  for (const item of dataset.items) {
    equal(item.records.length, 1);
    // Both threads diagnosed the cluster; its items lie in one partition.
    equal(item.partition, partitionOf("s", item.clusterId, 50));
    equal(dataset.items.filter((other) => other.clusterId === item.clusterId && other.partition === item.partition).length, 2);
    equal(item.gold, null);
    equal(item.hypothesis, null);
    ok(existsSync(join(datasetFolders(folder).context(item.contextHash), "context.json")));
    ok(existsSync(join(datasetFolders(folder).source(item.sourceIdentity), "Chummer", "frmCreate.cs")));
    const seen = (key: string) => item.observations.find((row) => `${row.case}/${row.capture}` === key)?.observation;
    equal(seen("build-alpha/skills"), "differs");
    equal(seen("career-beta/common"), "matches");
    equal(seen("build-example/skills"), "differs");
  }
  const loaded = await loadDataset(folder);
  deepStrictEqual(loaded.dataset, dataset);
  equal(loaded.manifests.size, 4);
  const challenges = await freezeDataset(await fixture.input({ name: "challenges", jobKind: "challenge" }));
  ok(challenges.dataset.items.every((item) => item.hypothesis?.claim === "The Skills tab label moved in frmCreate."));
});

test("partitions follow the cluster, and runs that disagree leave a capture not observed", () => {
  const clusters = Array.from({ length: 40 }, (_, index) => `d-${index}`);
  const test = clusters.filter((id) => partitionOf("seed", id, 30) === "test").length;
  ok(test > 0 && test < 40);
  ok(clusters.every((id) => partitionOf("seed", id, 0) === "development" && partitionOf("seed", id, 100) === "test"));
  deepStrictEqual(mergeObservations([
    { case: "b", capture: "x", observation: "differs" }, { case: "b", capture: "x", observation: "matches" },
    { case: "a", capture: "y", observation: "not-observed" }, { case: "a", capture: "y", observation: "matches" },
    { case: "a", capture: "z", observation: "not-observed" },
  ]), [
    { case: "a", capture: "y", observation: "matches" }, { case: "a", capture: "z", observation: "not-observed" }, { case: "b", capture: "x", observation: "not-observed" },
  ]);
});

test("gold comes from the earliest covering benchmark item, else from a correct review verdict", async () => {
  const fixture = await twoThreads();
  const records = await listRecords(fixture.store);
  const reviewed = records.find((record) => record.jobKind === "hypothesis" && record.subject.id === "d-0000000000000400")!;
  await setLabels(fixture.store, reviewed, { review: { verdict: "correct", note: null, reviewer: "me", reviewedUtc: "t" } });
  const benchmark = [benchmarkItem("d-0000000000000100", "2026-10-03T00:00:00.000Z"), { ...benchmarkItem("d-0000000000000100", "2026-10-02T00:00:00.000Z"), itemId: "earlier" }];
  const { dataset } = await freezeDataset(await fixture.input({ benchmark }));
  const gold = (cluster: string) => dataset.items.find((item) => item.clusterId === cluster && (cluster !== "d-0000000000000400" || item.records.includes(reviewed.recordId)))!.gold;
  equal(gold("d-0000000000000100")?.source, "benchmark:earlier");
  deepStrictEqual(gold("d-0000000000000100")?.files[0]?.ranges, [{ start: 1, end: 1 }]);
  equal(gold("d-0000000000000400")?.source, `review:${reviewed.recordId}`);
  deepStrictEqual(gold("d-0000000000000400")?.files.map((file) => file.path), ["Chummer/frmCreate.cs"]);
});

test("versions are added, never changed, and a changed copy is refused on load", async () => {
  const fixture = await twoThreads();
  const first = await freezeDataset(await fixture.input());
  const second = await freezeDataset(await fixture.input({ reason: "again" }));
  deepStrictEqual([second.dataset.version, second.dataset.previousHash, second.dataset.reason], [2, first.dataset.datasetHash, "again"]);
  deepStrictEqual(readdirSync(join(fixture.root, "datasets", "diag")).sort(), ["v1", "v2"]);
  const item = first.dataset.items[0]!;
  writeFileSync(join(datasetFolders(first.folder).context(item.contextHash), "evidence", "1-canonical.png"), "edited");
  await rejects(loadDataset(first.folder), (error: unknown) => error instanceof SetupError && error.message.includes(item.itemId));
  writeFileSync(join(datasetFolders(second.folder).source(item.sourceIdentity), "Chummer", "frmCreate.cs"), "edited");
  await rejects(loadDataset(second.folder), (error: unknown) => error instanceof SetupError && /snapshot copy/.test(error.message));
});

test("records without their context are left out, and nothing to freeze is a setup error", async () => {
  const fixture = await twoThreads();
  rmSync(join(fixture.root, "threads", fixture.threads[0]!), { recursive: true, force: true });
  const { dataset } = await freezeDataset(await fixture.input());
  ok(dataset.items.every((item) => item.records.length === 1));
  equal(fixture.lines.filter((line) => line.includes("is left out")).length, 2);
  rmSync(join(fixture.root, "threads"), { recursive: true, force: true });
  await rejects(freezeDataset(await fixture.input()), /there is nothing to freeze/);
  await rejects(freezeDataset(await fixture.input({ name: "Bad Name" })), /lower-case letters/);
});
