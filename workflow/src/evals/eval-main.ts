// Composition root of `npm run eval -- <command>`: labels, benchmark items, datasets, eval runs and certificates
// over the workflow's store. Exits with 0, 1, 2 or 3 (see --help).
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { agentRunners } from "../agents/agent-runners.js";
import { resolveAgentSettings } from "../agents/agent-settings.js";
import { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { processGit } from "../diagnosis/source-snapshot.js";
import { processBranchGit } from "../git/branch-git.js";
import { createScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { loadProfile } from "../options/profile.js";
import { tuningFolder } from "../options/run-options.js";
import { workflowPaths } from "../paths.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { resolveAutoTuning } from "../tuning/auto-tuning.js";
import { tuningCheckpoints } from "../tuning/tuning-runner.js";
import { runEvalCommand } from "./eval-commands.js";

const setupErrorStatus = 3;

/** Ctrl+C and closing the console stop the running model job; the command ends with the setup-error status. */
function interruptSignal(): AbortSignal {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGHUP", "SIGBREAK"] as const) process.once(signal, () => controller.abort());
  return controller.signal;
}

async function main(): Promise<number> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const paths = workflowPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  const log = (line: string) => console.log(line);
  const store = new SqliteStore(paths.store);
  let checkpointer: SqliteSaver | null = null;
  try {
    return await runEvalCommand(process.argv.slice(2), {
      paths, store, git: processGit(repositoryRoot), branchGit: processBranchGit(repositoryRoot), now: () => new Date(), log,
      agentSettings: () => resolveAgentSettings(loadProfile(process.env).agents),
      certificatesFolder: () => resolve(repositoryRoot, loadProfile(process.env).certificates ?? paths.certificates),
      tuningFolder: () => tuningFolder(loadProfile(process.env), repositoryRoot),
      autoTuning: () => resolveAutoTuning(loadProfile(process.env).autoTuning),
      tuningCheckpointer: () => {
        if (checkpointer === null) {
          const path = tuningCheckpoints(paths.evalsFolder);
          mkdirSync(dirname(path), { recursive: true });
          checkpointer = SqliteSaver.fromConnString(path);
        }
        return checkpointer;
      },
      agents: agentRunners(process.env), quota: new QuotaWaiter(randomBytes(8).toString("hex"), undefined, log),
      createScratchFolder, signal: interruptSignal(),
    });
  } finally {
    store.close();
    (checkpointer as SqliteSaver | null)?.db.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run eval failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
