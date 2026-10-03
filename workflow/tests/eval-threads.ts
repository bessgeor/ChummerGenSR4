import { equal } from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryStore } from "@langchain/langgraph";
import type { BenchmarkItem } from "../src/evals/benchmark.js";
import type { FreezeInput } from "../src/evals/dataset.js";
import { listRecords } from "../src/evals/eval-record.js";
import { runFolders, type RunSettings, type Sample } from "../src/evals/eval-run.js";
import { diagnosisHarness, twoClusters } from "./diagnosis-harness.js";
import { scratch } from "./diagnosis-fixtures.js";
import { archivedFix, fixRecord } from "./fix-fixtures.js";
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
export async function twoThreads(options: { priors?: boolean } = {}) {
  const root = scratch();
  const store = new InMemoryStore();
  // The fake triage step writes triage.json beside the threads; the real one writes it into the thread folder.
  // Each thread's fixture repository gets its own commit date, so the two snapshots, and so the contexts, always differ.
  const run = async (date: string) => {
    process.env["GIT_AUTHOR_DATE"] = date;
    process.env["GIT_COMMITTER_DATE"] = date;
    let harness;
    try {
      harness = diagnosisHarness({ spots: twoClusters, root, store });
    } finally {
      delete process.env["GIT_AUTHOR_DATE"];
      delete process.env["GIT_COMMITTER_DATE"];
    }
    // With priors the repository archives a fix that resembles the first cluster, and the thread works with fix changes.
    if (options.priors === true) archivedFix(join(harness.sourceRepository, "fixes", "openspec", "changes", "archive"), fixRecord({ clusterId: "d-similar", members: [{ case: "build-alpha", capture: "skills" }] }));
    equal(await harness.start(options.priors === true ? { fixChanges: true, noRepair: true } : undefined), 1);
    copyFileSync(join(root, "triage.json"), join(root, "threads", harness.threadId(), "triage.json"));
    return harness;
  };
  const first = await run("2026-09-01T00:00:00Z");
  const second = await run("2026-09-02T00:00:00Z");
  const lines: string[] = [];
  const input = async (overrides: Partial<FreezeInput> = {}): Promise<FreezeInput> => ({
    name: "diag", jobKind: "hypothesis", seed: "s", testPercent: 50, reason: null, datasetsFolder: join(root, "datasets"),
    threadFolder: (id) => join(root, "threads", id), records: await listRecords(store), benchmark: [], snapshotBase: () => null, now: () => new Date("2026-10-02T11:00:00Z"),
    log: (line) => lines.push(line), ...overrides,
  });
  return { root, store, input, lines, threads: [first.threadId(), second.threadId()] };
}

/** A run folder with the given settings and `repeat` samples per value (the value of both metrics of its job kind; null: no gold). */
export function writeRun(folder: string, settings: Partial<RunSettings>, values: readonly (boolean | null)[], repeat = 1): void {
  mkdirSync(runFolders(folder).samples, { recursive: true });
  const repetitions = Array.from({ length: repeat }, (_, index) => index + 1);
  const keys = values.flatMap((_, index) => repetitions.map((repetition) => `i${index}-${repetition}`));
  const full: RunSettings = {
    schemaVersion: 1, runId: folder.split(/[\\/]/).pop()!, name: null, dataset: { folder: "d", name: "d", version: 1, hash: "h" }, jobKind: "hypothesis", partition: "test",
    repeat, choice: { provider: "claude", model: null, effort: "medium", timeoutMinutes: 30 }, promptVersion: "hypothesis-v2", modelPool: 2,
    executables: { claude: "claude", codex: null }, samples: keys, startedUtc: "t", ...settings,
  };
  writeFileSync(runFolders(folder).settings, JSON.stringify(full));
  values.forEach((value, index) => {
    for (const repetition of repetitions) {
      const key = `i${index}-${repetition}`;
      const sample: Sample = {
        key, itemId: `i${index}`, clusterId: "d", repetition, recordId: "r", status: "succeeded", message: null, output: null,
        ...(full.jobKind === "rank" || full.jobKind === "scenario"
          ? { prediction: null, rootCause: null, valid: value ?? false, reached: value }
          : { prediction: value ?? false, rootCause: value, valid: null, reached: null }),
        durationMs: 1000 * (index + 1), costUsd: index === 0 ? null : 0.1,
      };
      writeFileSync(runFolders(folder).sample(key), JSON.stringify(sample));
    }
  });
}