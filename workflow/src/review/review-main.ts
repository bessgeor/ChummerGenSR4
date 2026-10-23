// Composition root of `npm run review`: serves the review page on 127.0.0.1 until Ctrl+C.
import { mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBenchmark } from "../evals/benchmark.js";
import { CommandOptions } from "../evals/command-options.js";
import { defaultQueueOptions } from "../evals/review-queue.js";
import { SetupError } from "../host/setup-error.js";
import { workflowPaths } from "../paths.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { createReviewServer } from "./review-server.js";

async function main(): Promise<number> {
  const options = CommandOptions.parse("review", process.argv.slice(2), ["port", "seed", "per-stratum"]);
  const port = options.number("port", 4317, 0, 65_535, true);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const paths = workflowPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  const store = new SqliteStore(paths.store);
  const server = createReviewServer({
    store, threadFolder: paths.threadFolder, benchmark: () => readBenchmark(paths.benchmark),
    queue: { seed: options.text("seed") ?? defaultQueueOptions.seed, perStratum: options.number("per-stratum", defaultQueueOptions.perStratum, 0, 1000, true) },
    reviewer: userInfo().username, now: () => new Date(), log: (line) => console.log(line),
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", (error) => reject(new SetupError(`The review page cannot listen on 127.0.0.1:${port}: ${error.message}`)));
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  console.log(`Review page: http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : port}/ (Ctrl+C ends it)`);
  await new Promise<void>((resolveStop) => {
    for (const signal of ["SIGINT", "SIGHUP", "SIGBREAK"] as const) process.once(signal, () => resolveStop());
  });
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  store.close();
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run review failed: ${(error as Error).stack ?? String(error)}`);
  return 3;
});
