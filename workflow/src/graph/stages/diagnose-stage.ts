import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { nextDiagnosisRoute } from "../../diagnosis/cluster-diagnosis.js";
import type { JobInput, JobStep } from "../../diagnosis/diagnosis-service.js";
import { hypothesesOf, usesFixChanges } from "../../options/run-options.js";
import type { DiagnosisSteps } from "../workflow-graph.js";
import { WorkflowState, type ClusterTask, type WorkflowStateValue } from "../workflow-state.js";

/** The payload `Send` gives a diagnosis job node: a cluster task and the hypothesis it runs; a task stored with one hypothesis per cluster has none and runs the first. */
type VariantTask = ClusterTask & { readonly variant?: number };
import { requireStore } from "./stage-support.js";

function jobInput(state: VariantTask, config: LangGraphRunnableConfig): JobInput {
  const cluster = state.clusters[state.clusterId];
  if (cluster === undefined) throw new Error(`No diagnosis for cluster ${state.clusterId}.`);
  return {
    threadId: state.threadId, options: state.options, cluster, variant: state.variant ?? 1, spentMs: state.agentMilliseconds,
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  };
}

function applyJob(step: JobStep) {
  return { clusters: { [step.update.clusterId]: step.update }, agentMilliseconds: step.chargedMs };
}

/**
 * The `diagnose` stage: it seals a context per cluster, then `route_diagnosis` sends one job per hypothesis of each
 * cluster (hypotheses, then challenges) and waits for quota when a job hit a usage limit; each job is one task, so a
 * resumed thread repeats only unfinished jobs. The check runs once after the challenges, and `finish_diagnosis` writes `diagnosis.json`.
 */
export function buildDiagnoseStage(diagnosis: DiagnosisSteps) {
  return new StateGraph(WorkflowState)
    .addNode("prepare_diagnosis", async (state: WorkflowStateValue) => {
      if (state.triageSummary === null || state.fingerprints === null) throw new Error("Diagnosis ran before triage.");
      const clusters = await diagnosis.prepare({
        threadId: state.threadId, triagePath: state.triageSummary.path, caseFile: state.options.caseFile, candidate: state.fingerprints.candidate, candidateSource: state.fingerprints.candidateSource,
        fixChanges: usesFixChanges(state.options), hypotheses: hypothesesOf(state.options),
      });
      return { clusters };
    })
    .addNode("route_diagnosis", () => ({}))
    .addNode("hypothesize", async (state: VariantTask, config: LangGraphRunnableConfig) =>
      applyJob(await diagnosis.hypothesize(jobInput(state, config), requireStore(config))))
    .addNode("challenge", async (state: VariantTask, config: LangGraphRunnableConfig) =>
      applyJob(await diagnosis.challenge(jobInput(state, config), requireStore(config))))
    .addNode("wait_for_quota", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => {
      const waiting = Object.values(state.clusters).filter((cluster) => cluster.waiting !== null);
      await diagnosis.waitForQuota(waiting.map((cluster) => cluster.waiting!), config.signal);
      return { clusters: Object.fromEntries(waiting.map((cluster) => [cluster.clusterId, { clusterId: cluster.clusterId, waiting: null }])) };
    })
    .addNode("check", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => ({
      diagnosisCheck: await diagnosis.check({ options: state.options, clusters: state.clusters, ...(config.signal === undefined ? {} : { signal: config.signal }) }, requireStore(config)),
    }))
    .addNode("finish_diagnosis", (state: WorkflowStateValue) => ({ diagnosisPath: diagnosis.finish(state.threadId, state.clusters, state.diagnosisCheck) }))
    .addEdge(START, "prepare_diagnosis")
    .addEdge("prepare_diagnosis", "route_diagnosis")
    .addConditionalEdges("route_diagnosis", (state: WorkflowStateValue) => {
      const route = nextDiagnosisRoute(state.clusters, (state.diagnosisCheck ?? null) !== null);
      switch (route.kind) {
        case "hypothesize":
        case "challenge": return route.jobs.map((job) => new Send(route.kind, { ...state, clusterId: job.clusterId, variant: job.variant }));
        case "end": return "finish_diagnosis";
        default: return route.kind;
      }
    }, ["wait_for_quota", "hypothesize", "challenge", "check", "finish_diagnosis"])
    // Plain edges: the router runs once after every job of the step finished, and sees all their writes.
    .addEdge("hypothesize", "route_diagnosis")
    .addEdge("challenge", "route_diagnosis")
    .addEdge("wait_for_quota", "route_diagnosis")
    .addEdge("check", "route_diagnosis")
    .addEdge("finish_diagnosis", END);
}
