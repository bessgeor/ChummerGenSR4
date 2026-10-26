import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { NodeName } from "../../options/arguments.js";
import type { RunOptions } from "../../options/run-options.js";
import { nextAttempts, retryLimits, retryPlan } from "../../loop/retry.js";
import type { StepMode } from "../../steps/step-outcome.js";
import type { WorkflowStateValue } from "../workflow-state.js";

const order: readonly NodeName[] = ["capture", "compare", "triage", "diagnose"];

/** Whether a thread repairs its confirmed clusters: repair is on and no single node was asked for. */
export function repairs(options: RunOptions): boolean {
  return options.repair !== null && options.only === null;
}

/** Whether a thread widens its passed repair attempts; a thread whose stored options lack the field was started without widening. */
export function widens(options: RunOptions): boolean {
  return repairs(options) && options.widening === true;
}

/** Whether a node runs its steps, only reuses recorded ones (it comes before `--only`), or is skipped. */
export function nodeMode(node: NodeName, only: NodeName | null): StepMode | "skip" {
  if (only === null || only === node) return "run";
  return order.indexOf(node) < order.indexOf(only) ? "reuse-only" : "skip";
}

export function requireStore(config: LangGraphRunnableConfig): BaseStore {
  if (config.store === undefined) throw new Error("The graph was compiled without a store.");
  return config.store;
}

/** After the last widening (or repair, when widening is off): whether a cluster may have a next attempt. */
export function retries(state: WorkflowStateValue): boolean {
  return retryPlan(state.repairs, state.widenings, retryLimits(state.options, state.agentMilliseconds)).retry.length > 0;
}

/** The `retry_repair` node: each cluster that may have a next attempt is pending again. */
export function retryRepair(state: WorkflowStateValue) {
  const plan = retryPlan(state.repairs, state.widenings, retryLimits(state.options, state.agentMilliseconds));
  return nextAttempts(plan.retry, state.repairs, state.widenings);
}
