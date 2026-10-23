import { join } from "node:path";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { freezeDataset } from "../src/evals/dataset.js";
import type { EvalRunDependencies } from "../src/evals/eval-run.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import type { FakeAgents } from "./diagnosis-harness.js";
import { evalContext } from "./eval-fixtures.js";
import { twoThreads } from "./eval-threads.js";

/**
 * A hypothesis dataset frozen from the fixture threads (four items in two clusters; `testPercent` 0 puts every item
 * in development, 100 in test), an evaluation context over the threads' store, and eval-run dependencies with run IDs
 * `er-1`, `er-2`, … over a fake agent runner.
 */
export async function tuningFixture(testPercent: number, seed = "s") {
  const threads = await twoThreads();
  const { folder } = await freezeDataset(await threads.input({ name: "tune", testPercent, seed }));
  const context = evalContext({ store: threads.store });
  let counter = 0;
  const lines: string[] = [];
  const dependencies = (agents: FakeAgents, signal?: AbortSignal): EvalRunDependencies => ({
    store: threads.store, agents: () => agents, quota: new QuotaWaiter("p", async () => undefined), runsFolder: join(context.paths.evalsFolder, "runs"), createScratchFolder,
    now: () => new Date("2026-10-02T12:00:00Z"), log: (line) => lines.push(line), newRunId: () => `er-${++counter}`,
    ...(signal === undefined ? {} : { signal }),
  });
  return { threads, dataset: folder, context, dependencies, lines };
}
