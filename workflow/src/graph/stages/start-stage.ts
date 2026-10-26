import { END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { WorkflowSteps } from "../workflow-graph.js";
import { WorkflowState, type WorkflowStateValue } from "../workflow-state.js";

/** The `start` stage: the build of the candidate (unless a later node was asked for alone) and the tools. */
export function buildStartStage(steps: WorkflowSteps) {
  return new StateGraph(WorkflowState)
    .addNode("build", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => {
      const only = state.options.only;
      return { fingerprints: await steps.build(state.options, only === null || only === "capture", config.signal) };
    })
    .addEdge(START, "build")
    .addEdge("build", END);
}
