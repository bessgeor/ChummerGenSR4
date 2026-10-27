import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { nextRepairRoute } from "../../repair/cluster-repair.js";
import type { RepairInput } from "../../repair/repair-service.js";
import type { RepairSteps } from "../workflow-graph.js";
import { WorkflowState, type ClusterTask, type WorkflowStateValue } from "../workflow-state.js";
import { requireStore, retries, retryRepair, widens } from "./stage-support.js";

function repairInput(state: ClusterTask, config: LangGraphRunnableConfig): RepairInput {
  const repair = state.repairs[state.clusterId];
  const cluster = state.clusters[state.clusterId];
  if (repair === undefined || cluster === undefined || state.diagnosisCheck === null) throw new Error(`No confirmed diagnosis to repair for cluster ${state.clusterId}.`);
  return {
    threadId: state.threadId, options: state.options, repair, diagnosis: cluster, check: state.diagnosisCheck, spentMs: state.agentMilliseconds,
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  };
}

/**
 * The `repair` stage: a pending repair for each confirmed cluster on the first entry, then `route_repair` sends one
 * attempt per pending cluster and waits for quota the same way diagnosis does, and `finish_repair` writes `repair.json`.
 * A next entry (next attempts) starts at `route_repair`. When the thread does not widen, `retry_repair` sets the next
 * attempts at the end of the stage.
 */
export function buildRepairStage(repair: RepairSteps) {
  return new StateGraph(WorkflowState)
    .addNode("prepare_repair", (state: WorkflowStateValue) => ({ repairs: repair.prepare(state.threadId, state.clusters, state.diagnosisCheck) }))
    .addNode("route_repair", () => ({}))
    .addNode("repair", async (state: ClusterTask, config: LangGraphRunnableConfig) => {
      const step = await repair.repair(repairInput(state, config), requireStore(config));
      return { repairs: { [step.update.clusterId]: step.update }, agentMilliseconds: step.chargedMs };
    })
    .addNode("wait_for_repair_quota", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => {
      const waiting = Object.values(state.repairs).filter((item) => item.waiting !== null);
      await repair.waitForQuota(waiting.map((item) => item.waiting!), config.signal);
      return { repairs: Object.fromEntries(waiting.map((item) => [item.clusterId, { clusterId: item.clusterId, waiting: null }])) };
    })
    .addNode("finish_repair", (state: WorkflowStateValue) => ({ repairPath: repair.finish(state.threadId, state.repairs) }))
    .addNode("retry_repair", retryRepair)
    // `repair.json` is written at the end of every entry, so a thread that has one was prepared before.
    .addConditionalEdges(START, (state: WorkflowStateValue) => ((state.repairPath ?? null) === null ? "prepare_repair" : "route_repair"), ["prepare_repair", "route_repair"])
    .addEdge("prepare_repair", "route_repair")
    .addConditionalEdges("route_repair", (state: WorkflowStateValue) => {
      const route = nextRepairRoute(state.repairs);
      switch (route.kind) {
        case "repair": return route.clusters.map((clusterId) => new Send("repair", { ...state, clusterId }));
        case "end": return "finish_repair";
        default: return route.kind;
      }
    }, ["wait_for_repair_quota", "repair", "finish_repair"])
    // As with diagnosis, the router runs once after every attempt of the step finished.
    .addEdge("repair", "route_repair")
    .addEdge("wait_for_repair_quota", "route_repair")
    .addConditionalEdges("finish_repair", (state: WorkflowStateValue) => (!widens(state.options) && retries(state) ? "retry_repair" : END), ["retry_repair", END])
    .addEdge("retry_repair", END);
}
