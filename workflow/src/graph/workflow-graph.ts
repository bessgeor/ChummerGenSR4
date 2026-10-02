import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import { nextDiagnosisRoute, type ClusterDiagnosis, type QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { CheckResult } from "../diagnosis/check.js";
import type { CheckInput, JobInput, JobStep, PrepareInput } from "../diagnosis/diagnosis-service.js";
import { SetupError } from "../host/setup-error.js";
import type { NodeName } from "../options/arguments.js";
import type { RunOptions } from "../options/run-options.js";
import { nextRepairRoute, type ClusterRepair } from "../repair/cluster-repair.js";
import type { RepairInput, RepairStep } from "../repair/repair-service.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { StepContext, StepMode, StepOutcome } from "../steps/step-outcome.js";
import { nextWideningRoute, type AcceptedState, type ClusterWidening } from "../widening/cluster-widening.js";
import type { WideningInput, WideningPrepareInput, WideningStep } from "../widening/widening-service.js";
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

/** The repair work behind the graph's repair nodes. */
export interface RepairSteps {
  /** A pending repair for each cluster the check confirmed. */
  prepare(clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): Record<string, ClusterRepair>;
  repair(input: RepairInput, store: BaseStore): Promise<RepairStep>;
  waitForQuota(marks: readonly QuotaWaitMark[], signal?: AbortSignal): Promise<void>;
  /** Writes the thread's `repair.json` and returns its path. */
  finish(threadId: string, repairs: Readonly<Record<string, ClusterRepair>>): string;
}

/** The widening work behind the graph's widening nodes. */
export interface WideningSteps {
  /** A widening for each cluster whose repair passed, and the accepted state they start from. */
  prepare(input: WideningPrepareInput): { widenings: Record<string, ClusterWidening>; accepted: AcceptedState | null };
  widen(input: WideningInput): Promise<WideningStep>;
  promote(input: WideningInput, store: BaseStore): Promise<WideningStep>;
  rollBack(input: WideningInput, store: BaseStore): Promise<WideningStep>;
  /** Writes the thread's `widening.json` and returns its path. */
  finish(threadId: string, widenings: Readonly<Record<string, ClusterWidening>>, accepted: AcceptedState | null): string;
}

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
 * build → capture(case k) → compare(case k) ∥ capture(case k+1) → … → triage → diagnosis. `Send` addresses each
 * case, so compare k and capture k+1 run in the same super-step and both are checkpointed. Diagnosis seals a
 * context per cluster, then `route_diagnosis` sends one job per cluster (hypotheses, then challenges) and waits
 * for quota when a job hit a usage limit; each job is one task, so a resumed thread repeats only unfinished jobs.
 * Repair then sends one attempt per confirmed cluster the same way, and waits for quota the same way. Widening
 * then takes the passed attempts one at a time: `route_widening` sends the first unfinished one to its next step
 * (the widened candidate or one level, the promotion or the rollback), so every step is checkpointed on its own.
 */
export function buildWorkflowGraph(steps: WorkflowSteps, diagnosis: DiagnosisSteps, repair: RepairSteps, widening: WideningSteps) {
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
    .addNode("prepare_repair", (state: WorkflowStateValue) => ({ repairs: repair.prepare(state.clusters, state.diagnosisCheck) }))
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
    .addNode("prepare_widening", (state: WorkflowStateValue) => {
      if (state.triageSummary === null) throw new Error("Widening ran before triage.");
      const captured = state.plan.flatMap((item) => (state.captures[item.name] === undefined ? [] : [state.captures[item.name]!]));
      const check = state.diagnosisCheck;
      return widening.prepare({
        threadId: state.threadId, repairs: state.repairs, clusters: state.clusters, triagePath: state.triageSummary.path,
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
    .addNode("finish_widening", (state: WorkflowStateValue) => ({ wideningPath: widening.finish(state.threadId, state.widenings, state.accepted) }))
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
    .addConditionalEdges("finish_diagnosis", (state: WorkflowStateValue) => (repairs(state.options) ? "prepare_repair" : END), ["prepare_repair", END])
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
    .addConditionalEdges("finish_repair", (state: WorkflowStateValue) => (widens(state.options) ? "prepare_widening" : END), ["prepare_widening", END])
    .addEdge("prepare_widening", "route_widening")
    .addConditionalEdges("route_widening", (state: WorkflowStateValue) => {
      const route = nextWideningRoute(state.widenings);
      return route.kind === "end" ? "finish_widening" : [new Send(route.kind, { ...state, clusterId: route.clusterId })];
    }, ["widen", "promote", "roll_back", "finish_widening"])
    .addEdge("widen", "route_widening")
    .addEdge("promote", "route_widening")
    .addEdge("roll_back", "route_widening")
    .addEdge("finish_widening", END);
}
