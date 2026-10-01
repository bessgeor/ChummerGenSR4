// Composition root of `npm run eval -- <command>`: labels, benchmark items, datasets, eval runs and certificates
// over the workflow's store. Exits with 0, 1, 2 or 3 (see --help).
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processGit } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { workflowPaths } from "../paths.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { runEvalCommand } from "./eval-commands.js";

const setupErrorStatus = 3;

async function main(): Promise<number> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const paths = workflowPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  const store = new SqliteStore(paths.store);
  try {
    return await runEvalCommand(process.argv.slice(2), {
      paths, store, git: processGit(repositoryRoot), now: () => new Date(), log: (line) => console.log(line),
    });
  } finally {
    store.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run eval failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
