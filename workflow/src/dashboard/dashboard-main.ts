// Composition root of `npm run dashboard`: serves the loop dashboard on 127.0.0.1 until Ctrl+C.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CommandOptions } from "../evals/command-options.js";
import { SetupError } from "../host/setup-error.js";
import { workflowPaths } from "../paths.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { bundleClient } from "./bundle.js";
import { createDashboardServer } from "./dashboard-server.js";
import { graphSources } from "./graph-sources.js";
import { GraphReader } from "./graphs.js";

async function main(): Promise<number> {
  const options = CommandOptions.parse("dashboard", process.argv.slice(2), ["port"], [], "npm run dashboard -- [--port <n>]");
  const port = options.number("port", 4318, 0, 65_535, true);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const paths = workflowPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  const bundle = await bundleClient();
  const store = new SqliteStore(paths.store);
  const graphs = graphSources(repositoryRoot).map((source) => new GraphReader(source));
  const server = createDashboardServer({
    loopRoot: join(repositoryRoot, "out", "loop"), threadFolder: paths.threadFolder, threadsRoot: join(paths.workflowFolder, "threads"),
    tuningCycles: join(paths.evalsFolder, "tuning", "cycles"), store, graphs, bundle, now: () => new Date(), log: (line) => console.log(line),
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", (error) => reject(new SetupError(`The dashboard cannot listen on 127.0.0.1:${port}: ${error.message}`)));
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  console.log(`Loop dashboard: http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : port}/ (Ctrl+C ends it)`);
  await new Promise<void>((resolveStop) => {
    for (const signal of ["SIGINT", "SIGHUP", "SIGBREAK"] as const) process.once(signal, () => resolveStop());
  });
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  for (const reader of graphs) reader.close();
  store.close();
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run dashboard failed: ${(error as Error).stack ?? String(error)}`);
  return 3;
});
