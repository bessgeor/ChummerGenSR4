// The evaluation context composed on this machine: the store, git, the agents and the tuning threads' checkpointer.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { agentRunners } from "../agents/agent-runners.js";
import { resolveAgentSettings } from "../agents/agent-settings.js";
import { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { processGit } from "../diagnosis/source-snapshot.js";
import { processBranchGit } from "../git/branch-git.js";
import { createScratchFolder } from "../host/scratch-folder.js";
import { loadProfile } from "../options/profile.js";
import { tuningFolder } from "../options/run-options.js";
import { workflowPaths } from "../paths.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { resolveAutoTuning } from "../tuning/auto-tuning.js";
import { tuningCheckpoints } from "../tuning/tuning-runner.js";
import type { EvalContext } from "./eval-context.js";

/** An evaluation context and the closing of the databases it opened. */
export type ComposedEvalContext = { readonly context: EvalContext; readonly close: () => void };

/** Composes the context of `npm run eval` for the repository; the local profile is read when a command needs it. */
export function composeEvalContext(repositoryRoot: string, log: (line: string) => void, signal?: AbortSignal): ComposedEvalContext {
  const paths = workflowPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  const store = new SqliteStore(paths.store);
  let checkpointer: SqliteSaver | null = null;
  const context: EvalContext = {
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
    createScratchFolder, ...(signal === undefined ? {} : { signal }),
  };
  return {
    context,
    close: () => {
      store.close();
      (checkpointer as SqliteSaver | null)?.db.close();
    },
  };
}
