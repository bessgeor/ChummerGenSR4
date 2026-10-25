import { END, START, StateGraph } from "@langchain/langgraph";
import type { LoopSteps } from "../workflow-graph.js";
import { WorkflowState, type WorkflowStateValue } from "../workflow-state.js";

/** The `conclude` stage: every cluster's disposition, the thread's outcome and `outcome.json`. */
export function buildConcludeStage(loop: LoopSteps) {
  return new StateGraph(WorkflowState)
    .addNode("conclude", (state: WorkflowStateValue) => {
      if (state.triageSummary === null) throw new Error("The thread concluded before triage.");
      const { document, path } = loop.conclude({
        threadId: state.threadId, options: state.options, plan: state.plan, captures: state.captures, compares: state.compares,
        triagePath: state.triageSummary.path, otherFindings: state.triageSummary.otherFindings, clusters: state.clusters ?? {}, check: state.diagnosisCheck ?? null,
        repairs: state.repairs ?? {}, widenings: state.widenings ?? {}, accepted: state.accepted ?? null, agentMilliseconds: state.agentMilliseconds ?? 0,
        startedUtc: state.startedUtc ?? null,
      });
      return { outcome: document, outcomePath: path };
    })
    .addEdge(START, "conclude")
    .addEdge("conclude", END);
}
