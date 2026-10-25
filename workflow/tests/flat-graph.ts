import { END, Send, START, StateGraph } from "@langchain/langgraph";
import type { WorkflowSteps } from "../src/graph/workflow-graph.js";
import { WorkflowState, type CaseTask, type WorkflowStateValue } from "../src/graph/workflow-state.js";
import type { StepContext } from "../src/steps/step-outcome.js";

function context(state: WorkflowStateValue): StepContext {
  if (state.fingerprints === null) throw new Error("The flat graph ran without the thread's inputs.");
  return { threadId: state.threadId, options: state.options, fingerprints: state.fingerprints, mode: "run" };
}

/**
 * The capture part of the workflow graph before it had stages: build → route_cases → capture and compare → … →
 * triage → inventory, every node in the thread's own namespace. Its threads are used to test what the staged graph
 * does with a thread checkpointed that way.
 */
export function buildFlatGraph(steps: WorkflowSteps) {
  return new StateGraph(WorkflowState)
    .addNode("build", async (state: WorkflowStateValue) => ({ fingerprints: await steps.build(state.options, true) }))
    .addNode("route_cases", () => ({}))
    .addNode("capture", async (state: CaseTask) => {
      const outcome = await steps.capture(context(state), state.plan[state.index]!);
      return { captures: { [outcome.case]: outcome } };
    })
    .addNode("compare", async (state: CaseTask) => {
      const outcome = await steps.compare(context(state), state.captures[state.plan[state.index]!.name]!);
      return { compares: { [outcome.case]: outcome } };
    })
    .addNode("triage", async (state: WorkflowStateValue) => ({
      triageSummary: await steps.triage({ threadId: state.threadId, plan: state.plan, captures: state.captures, compares: state.compares }, undefined as never),
    }))
    .addNode("inventory", async (state: WorkflowStateValue) => ({
      inventorySummary: await steps.inventory({ threadId: state.threadId, plan: state.plan, captures: state.captures, candidateSource: state.fingerprints!.candidateSource }),
    }))
    .addEdge(START, "build")
    .addEdge("build", "route_cases")
    .addEdge("capture", "route_cases")
    .addEdge("compare", "route_cases")
    .addConditionalEdges("route_cases", (state: WorkflowStateValue) => {
      const sends = state.plan.flatMap((item, index): Send[] => {
        if (state.captures[item.name] === undefined) return [new Send("capture", { ...state, index })];
        return state.compares[item.name] === undefined ? [new Send("compare", { ...state, index })] : [];
      }).slice(0, 1);
      return sends.length > 0 ? sends : "triage";
    }, ["capture", "compare", "triage"])
    .addEdge("triage", "inventory")
    .addEdge("inventory", END);
}
