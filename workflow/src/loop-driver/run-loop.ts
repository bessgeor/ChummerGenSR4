import { mkdirSync } from "node:fs";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { ComposedWorkflow } from "../compose-workflow.js";
import type { EvalContext } from "../evals/eval-context.js";
import { newThreadId, recursionLimit, setupErrorStatus } from "../graph/run-workflow.js";
import { SetupError } from "../host/setup-error.js";
import { runAutoTuning } from "../tuning/tune-commands.js";
import type { LoopCommand } from "./loop-arguments.js";
import { readThreadSummary, writeLoopDocument, type LoopDocument, type LoopPaths } from "./loop-document.js";
import { buildLoopGraph, loopInput, type LoopStateValue, type LoopSteps } from "./loop-graph.js";

/** The loop's checkpointer, `out/loop/checkpoints.sqlite`. */
export function openLoopCheckpointer(paths: LoopPaths): SqliteSaver {
  mkdirSync(paths.root, { recursive: true });
  return SqliteSaver.fromConnString(paths.checkpoints);
}

export type LoopHost = {
  readonly paths: LoopPaths;
  readonly workflow: ComposedWorkflow;
  readonly threadFolder: (threadId: string) => string;
  /** The evaluation context the automatic tuning runs in; its git is the repository's. */
  readonly evalContext: EvalContext;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/**
 * The steps of a loop on this machine: threads of the composed workflow, the eval CLI's automatic tuning, the trees of
 * the commits of a thread's merges from the repository, and `loop.json` in the loop's folder.
 */
export function hostLoopSteps(loopId: string, host: LoopHost): LoopSteps {
  const { paths, workflow, evalContext, now, log } = host;
  const treeOf = (commit: string) => evalContext.branchGit(["rev-parse", "--verify", `${commit}^{tree}`]).trim();
  return {
    newThreadId: () => newThreadId(now()),
    runThread: (threadId, args) => workflow.run({ kind: "start", arguments: args }, { threadId }),
    threadSummary: (threadId) => readThreadSummary(threadId, host.threadFolder(threadId), treeOf),
    tune: (onStart) => runAutoTuning(evalContext, false, onStart),
    writeLoop: (document) => writeLoopDocument(paths.document(loopId), document),
    now,
    log,
  };
}

export type LoopDependencies = {
  readonly paths: LoopPaths;
  readonly checkpointer: BaseCheckpointSaver;
  /** The steps of the loop `loopId`. */
  readonly steps: (loopId: string) => LoopSteps;
  readonly newLoopId: (now: Date) => string;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly signal?: AbortSignal;
};

/** Exit status of a loop that ended: 0 converged or limit, 2 failed. */
export function loopExitStatus(document: LoopDocument): number {
  if (document.status === "running") throw new Error(`Loop ${document.loopId} ended while it is running.`);
  return document.status === "failed" ? 2 : 0;
}

/**
 * Starts a loop: records it in `loop.json` as running and runs its graph, checkpointed under the loop's ID, to its end.
 * A setup error or an interruption ends the process with status 3 and leaves the loop running.
 */
export async function runLoop(command: Extract<LoopCommand, { kind: "start" }>, dependencies: LoopDependencies): Promise<number> {
  const { log } = dependencies;
  const startedUtc = dependencies.now();
  const loopId = dependencies.newLoopId(startedUtc);
  const steps = dependencies.steps(loopId);
  const document: LoopDocument = {
    schemaVersion: 1, loopId, startedUtc: startedUtc.toISOString(), options: { arguments: [...command.options], maxRuns: command.maxRuns }, status: "running", iterations: [],
  };
  log(`Loop ${loopId}: ${dependencies.paths.document(loopId)}`);
  try {
    steps.writeLoop(document);
    const graph = buildLoopGraph(steps).compile({ checkpointer: dependencies.checkpointer });
    const final = await graph.invoke(loopInput(document, command.arguments), {
      configurable: { thread_id: loopId }, recursionLimit, durability: "sync", ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
    }) as LoopStateValue;
    const status = loopExitStatus(final.document);
    log(`Loop ${loopId} ${final.document.status} after ${final.document.iterations.length} threads: exit ${status}.`);
    return status;
  } catch (error) {
    if (dependencies.signal?.aborted === true) log("Interrupted: the running step was stopped.");
    else log(`Setup error: ${error instanceof SetupError ? error.message : (error as Error).stack ?? String(error)}`);
    log(`Loop ${loopId} stopped; it stays running.`);
    return setupErrorStatus;
  }
}
