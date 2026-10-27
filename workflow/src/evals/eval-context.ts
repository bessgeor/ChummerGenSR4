import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { join } from "node:path";
import type { AgentRunners } from "../agents/agent-runners.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import type { Git } from "../diagnosis/source-snapshot.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import type { WorkflowPaths } from "../paths.js";
import type { AutoTuningSettings } from "../tuning/auto-tuning.js";
import { newEvalRunId, type EvalRunDependencies } from "./eval-run.js";

/** What the evaluation commands use; the composition root makes the real ones. */
export type EvalContext = {
  readonly paths: WorkflowPaths;
  readonly store: BaseStore;
  readonly git: Git;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** The agent settings of the local profile, read when a command needs them. */
  readonly agentSettings: () => AgentSettings;
  /** The certificates folder of the local profile, or the repository's. */
  readonly certificatesFolder: () => string;
  /** The tuning folder of the local profile, or the repository's. */
  readonly tuningFolder: () => string;
  /** The local profile's `autoTuning` with its defaults. */
  readonly autoTuning: () => AutoTuningSettings;
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly signal?: AbortSignal;
};

/** What an eval run needs from the evaluation context. */
export function runDependencies(context: EvalContext): EvalRunDependencies {
  return {
    store: context.store, agents: context.agents, quota: context.quota, runsFolder: join(context.paths.evalsFolder, "runs"),
    createScratchFolder: context.createScratchFolder, now: context.now, log: context.log,
    newRunId: () => newEvalRunId(context.now()),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  };
}