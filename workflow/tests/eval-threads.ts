import { equal } from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryStore } from "@langchain/langgraph";
import type { BenchmarkItem } from "../src/evals/benchmark.js";
import type { FreezeInput } from "../src/evals/dataset.js";
import { listRecords } from "../src/evals/eval-record.js";
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
