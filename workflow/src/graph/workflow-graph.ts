import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import { nextDiagnosisRoute, type ClusterDiagnosis, type QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { CheckResult } from "../diagnosis/check.js";
import type { CheckInput, JobInput, JobStep, PrepareInput } from "../diagnosis/diagnosis-service.js";
import { SetupError } from "../host/setup-error.js";
import type { NodeName } from "../options/arguments.js";
import type { RunOptions } from "../options/run-options.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { StepContext, StepMode, StepOutcome } from "../steps/step-outcome.js";
import { WorkflowState, type CaseTask, type ClusterTask, type TriageSummary, type WorkflowStateValue } from "./workflow-state.js";

export type TriageInput = {
  readonly threadId: string;
  readonly plan: readonly PlannedCase[];
  readonly captures: Readonly<Record<string, StepOutcome>>;
  readonly compares: Readonly<Record<string, StepOutcome>>;
};

/** The host work behind the graph's nodes. */
export interface WorkflowSteps {
  build(options: RunOptions, buildCandidate: boolean, signal?: AbortSignal): Promise<InputFingerprints>;
  capture(context: StepContext, item: PlannedCase): Promise<StepOutcome>;
  compare(context: StepContext, capture: StepOutcome): Promise<StepOutcome>;
  triage(input: TriageInput, store: BaseStore): Promise<TriageSummary>;
}

/** The diagnosis work behind the graph's diagnosis nodes. */
export interface DiagnosisSteps {
  prepare(input: PrepareInput): Promise<Record<string, ClusterDiagnosis>>;
  hypothesize(input: JobInput, store: BaseStore): Promise<JobStep>;
  challenge(input: JobInput, store: BaseStore): Promise<JobStep>;
  waitForQuota(marks: readonly QuotaWaitMark[], signal?: AbortSignal): Promise<void>;
  check(input: CheckInput, store: BaseStore): Promise<CheckResult>;
  /** Writes the thread's `diagnosis.json` and returns its path. */
  finish(threadId: string, clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): string;
}

const order: readonly NodeName[] = ["capture", "compare", "triage", "diagnose"];

/** Whether a node runs its steps, only reuses recorded ones (it comes before `--only`), or is skipped. */
export function nodeMode(node: NodeName, only: NodeName | null): StepMode | "skip" {
  if (only === null || only === node) return "run";
  return order.indexOf(node) < order.indexOf(only) ? "reuse-only" : "skip";
}

function context(state: WorkflowStateValue, node: NodeName, signal: AbortSignal | undefined): StepContext {
  const mode = nodeMode(node, state.options.only);
  if (mode === "skip" || state.fingerprints === null) {
    throw new Error(`The ${node} node ran without its inputs (mode ${mode}).`);
  }
  return { threadId: state.threadId, options: state.options, fingerprints: state.fingerprints, mode, ...(signal === undefined ? {} : { signal }) };
}

function caseAt(state: CaseTask): PlannedCase {
  const item = state.plan[state.index];
  if (item === undefined) throw new Error(`No planned case at index ${state.index}.`);
  return item;
}

function requireStore(config: LangGraphRunnableConfig): BaseStore {
  if (config.store === undefined) throw new Error("The graph was compiled without a store.");
  return config.store;
}

function jobInput(state: ClusterTask, config: LangGraphRunnableConfig): JobInput {
  const cluster = state.clusters[state.clusterId];
  if (cluster === undefined) throw new Error(`No diagnosis for cluster ${state.clusterId}.`);
  return {
    threadId: state.threadId, options: state.options, cluster, spentMs: state.agentMilliseconds,
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  };
}

function applyJob(step: JobStep) {
  return { clusters: { [step.update.clusterId]: step.update }, agentMilliseconds: step.chargedMs };
}

/**
 * build → capture(case k) → compare(case k) ∥ capture(case k+1) → … → triage → diagnosis. `Send` addresses each
 * case, so compare k and capture k+1 run in the same super-step and both are checkpointed. Diagnosis seals a
 * context per cluster, then `route_diagnosis` sends one job per cluster (hypotheses, then challenges) and waits
 * for quota when a job hit a usage limit; each job is one task, so a resumed thread repeats only unfinished jobs.
 */
export function buildWorkflowGraph(steps: WorkflowSteps, diagnosis: DiagnosisSteps) {
  return new StateGraph(WorkflowState)
    .addNode("build", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => {
      const only = state.options.only;
      return { fingerprints: await steps.build(state.options, only === null || only === "capture", config.signal) };
    })
    .addNode("capture", async (state: CaseTask, config: LangGraphRunnableConfig) => {
      const outcome = await steps.capture(context(state, "capture", config.signal), caseAt(state));
      return { captures: { [outcome.case]: outcome }, lastCaptured: state.index };
    })
    .addNode("compare", async (state: CaseTask, config: LangGraphRunnableConfig) => {
      const item = caseAt(state);
      const captured = state.captures[item.name];
      if (captured === undefined) throw new Error(`compare ${item.name} ran before its capture.`);
      const outcome = await steps.compare(context(state, "compare", config.signal), captured);
      return { compares: { [outcome.case]: outcome } };
    })
    .addNode("triage", async (state: WorkflowStateValue, config: LangGraphRunnableConfig) => {
      const summary = await steps.triage({ threadId: state.threadId, plan: state.plan, captures: state.captures, compares: state.compares }, requireStore(config));
      return { triageSummary: summary };
    })
    .addNode("prepare_diagnosis", async (state: WorkflowStateValue) => {
      if (state.triageSummary === null || state.fingerprints === null) throw new Error("Diagnosis ran before triage.");
      const clusters = await diagnosis.prepare({
        threadId: state.threadId, triagePath: state.triageSummary.path, caseFile: state.options.caseFile, candidate: state.fingerprints.candidate, candidateSource: state.fingerprints.candidateSource,
      });
      return { clusters };
    })
    .addNode("route_diagnosis", () => ({}))
    .addNode("hypothesize", async (state: ClusterTask, config: LangGraphRunnableConfig) =>
      applyJob(await diagnosis.hypothesize(jobInput(state, config), requireStore(config))))
    .addNode("challenge", async (state: ClusterTask, config: LangGraphRunnableConfig) =>
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
    .addEdge(START, "build")
    .addConditionalEdges("build", (state: WorkflowStateValue) => {
      if (state.plan.length === 0) throw new SetupError("No case is planned, so nothing can be captured.");
      return [new Send("capture", { ...state, index: 0 })];
    }, ["capture"])
    // An edge sees the graph's state with its own node's writes, not the node's Send payload.
    .addConditionalEdges("capture", (state: WorkflowStateValue) => {
      const index = state.lastCaptured;
      const sends: Send[] = [];
      if (nodeMode("compare", state.options.only) !== "skip") sends.push(new Send("compare", { ...state, index }));
      if (index + 1 < state.plan.length) sends.push(new Send("capture", { ...state, index: index + 1 }));
      return sends;
    }, ["capture", "compare"])
    .addConditionalEdges("compare", (state: WorkflowStateValue) => {
      const done = state.plan.every((item) => state.compares[item.name] !== undefined);
      return done && nodeMode("triage", state.options.only) !== "skip" ? ["triage"] : [];
    }, ["triage"])
    .addConditionalEdges("triage", (state: WorkflowStateValue) =>
      (state.options.diagnosis && nodeMode("diagnose", state.options.only) !== "skip" ? "prepare_diagnosis" : END), ["prepare_diagnosis", END])
    .addEdge("prepare_diagnosis", "route_diagnosis")
    .addConditionalEdges("route_diagnosis", (state: WorkflowStateValue) => {
      const route = nextDiagnosisRoute(state.clusters, (state.diagnosisCheck ?? null) !== null);
      switch (route.kind) {
        case "hypothesize":
        case "challenge": return route.clusters.map((clusterId) => new Send(route.kind, { ...state, clusterId }));
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
