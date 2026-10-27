import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { join } from "node:path";
import { threadConfig } from "../graph/run-workflow.js";
import { SetupError } from "../host/setup-error.js";
import type { Cycle } from "./cycle.js";
import { buildTuningGraph, type TuningStateValue, type TuningSteps } from "./tuning-graph.js";
import type { TuningRun } from "./tuning-steps.js";

export type TuningGraph = ReturnType<ReturnType<typeof buildTuningGraph>["compile"]>;

/** Where the tuning threads are checkpointed. */
export function tuningCheckpoints(evalsFolder: string): string {
  return join(evalsFolder, "tuning", "checkpoints.sqlite");
}

export function compileTuningGraph(steps: TuningSteps, checkpointer: BaseCheckpointSaver): TuningGraph {
  return buildTuningGraph(steps).compile({ checkpointer });
}

/** Whether a tuning thread has a checkpoint, and whether it still has a node to run. */
export async function tuningThread(graph: TuningGraph, tuningId: string): Promise<"absent" | "unfinished" | "finished"> {
  const snapshot = await graph.getState({ configurable: { thread_id: tuningId } });
  if (snapshot.config.configurable?.["checkpoint_id"] === undefined) return "absent";
  return snapshot.next.length > 0 ? "unfinished" : "finished";
}

/**
 * Runs a tuning thread to its conclusion: an unfinished thread continues from its checkpoint, without repeating a finished
 * node; otherwise the thread runs from its start with `input`, whose steps find what an earlier run recorded. Its cycle
 * is recovered first. An interruption is a setup error that names how to resume.
 */
export async function runTuningThread(graph: TuningGraph, steps: TuningRun, input: TuningStateValue, resume: string, signal?: AbortSignal): Promise<Cycle> {
  steps.recover(input);
  const unfinished = (await tuningThread(graph, input.tuningId)) === "unfinished";
  let final: TuningStateValue;
  try {
    final = await graph.invoke(unfinished ? null : input, threadConfig(input.tuningId, signal)) as TuningStateValue;
  } catch (error) {
    if (signal?.aborted === true) throw new SetupError(`Interrupted: tuning ${input.tuningId} stopped; resume it with ${resume}.`);
    throw error;
  }
  if (final.concluded === null || final.concluded === undefined) throw new SetupError(`Tuning ${input.tuningId} ended without its conclusion.`);
  return final.concluded;
}
