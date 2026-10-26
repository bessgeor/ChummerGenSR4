import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { nextWideningRoute } from "../../widening/cluster-widening.js";
import type { WideningInput, WideningStep } from "../../widening/widening-service.js";
import type { WideningSteps } from "../workflow-graph.js";
import { WorkflowState, type ClusterTask, type WorkflowStateValue } from "../workflow-state.js";
import { requireStore, retries, retryRepair } from "./stage-support.js";

function wideningInput(state: ClusterTask, config: LangGraphRunnableConfig): WideningInput {
  const widening = state.widenings[state.clusterId];
  if (widening === undefined || state.accepted === null || state.fingerprints === null) throw new Error(`No widening of cluster ${state.clusterId}.`);
  return {
    threadId: state.threadId, options: state.options, fingerprints: state.fingerprints, widening, accepted: state.accepted,
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  };
}

function applyWidening(step: WideningStep) {
  return { widenings: { [step.update.clusterId]: step.update }, ...(step.accepted === null ? {} : { accepted: step.accepted }) };
}

/**
 * The `widen` stage: it takes the passed attempts one at a time, and `route_widening` sends the first unfinished one
 * to its next step (the widened candidate or one level, the promotion or the rollback), so every step is checkpointed
 * on its own. `finish_widening` writes `widening.json`, and `retry_repair` sets the next attempts of the clusters
 * whose attempt was rejected and may have another.
 */
export function buildWidenStage(widening: WideningSteps) {
  return new StateGraph(WorkflowState)
    .addNode("prepare_widening", (state: WorkflowStateValue) => {
      if (state.triageSummary === null) throw new Error("Widening ran before triage.");
      const captured = state.plan.flatMap((item) => (state.captures[item.name] === undefined ? [] : [state.captures[item.name]!]));
      const check = state.diagnosisCheck;
      return widening.prepare({
        threadId: state.threadId, repairs: state.repairs, clusters: state.clusters, triagePath: state.triageSummary.path, widenings: state.widenings, accepted: state.accepted ?? null,
        candidateRuns: [
          ...captured.map((outcome) => ({ runFolder: outcome.runFolder, status: outcome.status })),
          ...(check === null ? [] : [{ runFolder: check.runFolder, status: check.execution.status }]),
        ],
      });
    })
    .addNode("route_widening", () => ({}))
    .addNode("widen", async (state: ClusterTask, config: LangGraphRunnableConfig) => applyWidening(await widening.widen(wideningInput(state, config))))
    .addNode("promote", async (state: ClusterTask, config: LangGraphRunnableConfig) =>
      applyWidening(await widening.promote(wideningInput(state, config), requireStore(config))))
    .addNode("roll_back", async (state: ClusterTask, config: LangGraphRunnableConfig) =>
      applyWidening(await widening.rollBack(wideningInput(state, config), requireStore(config))))
    .addNode("finish_widening", (state: WorkflowStateValue) => ({ wideningPath: widening.finish(state.threadId, state.widenings, state.accepted, state.earlierWidenings ?? []) }))
    .addNode("retry_repair", retryRepair)
    .addEdge(START, "prepare_widening")
    .addEdge("prepare_widening", "route_widening")
    .addConditionalEdges("route_widening", (state: WorkflowStateValue) => {
      const route = nextWideningRoute(state.widenings);
      return route.kind === "end" ? "finish_widening" : [new Send(route.kind, { ...state, clusterId: route.clusterId })];
    }, ["widen", "promote", "roll_back", "finish_widening"])
    .addEdge("widen", "route_widening")
    .addEdge("promote", "route_widening")
    .addEdge("roll_back", "route_widening")
    .addConditionalEdges("finish_widening", (state: WorkflowStateValue) => (retries(state) ? "retry_repair" : END), ["retry_repair", END])
    .addEdge("retry_repair", END);
}
