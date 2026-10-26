import { END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { ThreadDiscoverySteps } from "../../discovery/thread-discovery.js";
import { WorkflowState, type WorkflowStateValue } from "../workflow-state.js";

/**
 * The `discovery` stage: the thread's discovery thread, started, resumed or read by its ID, with the thread's inventory as the
 * baseline. The discovery thread has its own checkpoints, so a resumed stage continues it where it stopped.
 */
export function buildDiscoveryStage(discovery: ThreadDiscoverySteps) {
  return new StateGraph(WorkflowState)
    .addNode("discover", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => ({
      threadDiscovery: await discovery.discover({ threadId: state.threadId, options: state.options }, config.signal),
    }))
    .addEdge(START, "discover")
    .addEdge("discover", END);
}
