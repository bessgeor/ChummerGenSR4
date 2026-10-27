import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import type { ClusterDiagnosis, QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import type { CheckResult } from "../diagnosis/check.js";
import type { CheckInput, JobInput, JobStep, PrepareInput } from "../diagnosis/diagnosis-service.js";
import { SetupError } from "../host/setup-error.js";
import type { InventorySummary } from "../inventory/inventory-service.js";
import type { RunOptions } from "../options/run-options.js";
import { nextRepairRoute, type ClusterRepair } from "../repair/cluster-repair.js";
import type { RepairInput, RepairStep } from "../repair/repair-service.js";
import type { Conclusion, ConcludeInput } from "../loop/loop-service.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { StepContext, StepOutcome } from "../steps/step-outcome.js";
import type { AcceptedState, ClusterWidening } from "../widening/cluster-widening.js";
import type { WideningInput, WideningPrepareInput, WideningStep } from "../widening/widening-service.js";
import { buildCaptureStage } from "./stages/capture-stage.js";
import { buildConcludeStage } from "./stages/conclude-stage.js";
import { buildDiagnoseStage } from "./stages/diagnose-stage.js";
import { buildRepairStage } from "./stages/repair-stage.js";
import { discovers, nodeMode, repairs, widens } from "./stages/stage-support.js";
import { buildDiscoveryStage } from "./stages/discovery-stage.js";
import { buildStartStage } from "./stages/start-stage.js";
import { buildWidenStage } from "./stages/widen-stage.js";
import { ThreadState, type TriageSummary, type WorkflowStateValue } from "./workflow-state.js";
import type { ThreadDiscoverySteps } from "../discovery/thread-discovery.js";

export { discovers, nodeMode, repairs, widens } from "./stages/stage-support.js";

export type TriageInput = {
  readonly threadId: string;
  readonly plan: readonly PlannedCase[];
  readonly captures: Readonly<Record<string, StepOutcome>>;
  readonly compares: Readonly<Record<string, StepOutcome>>;
};

export type InventoryInput = {
  readonly threadId: string;
  readonly plan: readonly PlannedCase[];
  readonly captures: Readonly<Record<string, StepOutcome>>;
  /** The compiled source the candidate was built from, as its build recorded it. */
  readonly candidateSource: string;
};

/** The host work behind the graph's nodes. */
export interface WorkflowSteps {
  /** How many cases a step captures at once: one per desktop lane. */
  readonly captureLanes: number;
  build(options: RunOptions, buildCandidate: boolean, signal?: AbortSignal): Promise<InputFingerprints>;
  capture(context: StepContext, item: PlannedCase): Promise<StepOutcome>;
  compare(context: StepContext, capture: StepOutcome): Promise<StepOutcome>;
  triage(input: TriageInput, store: BaseStore): Promise<TriageSummary>;
  /** Writes the thread's source inventory and coverage manifest from its capture runs. */
  inventory(input: InventoryInput): Promise<InventorySummary>;
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
  /** A pending repair for each cluster the check confirmed, after the thread's source commit is made. */
  prepare(threadId: string, clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): Record<string, ClusterRepair>;
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
  finish(threadId: string, widenings: Readonly<Record<string, ClusterWidening>>, accepted: AcceptedState | null, earlier: readonly ClusterWidening[]): string;
}

/** The end of the loop behind the graph's `conclude` node. */
export interface LoopSteps {
  /** Decides every cluster's disposition and the thread's outcome, and writes `outcome.json`. */
  conclude(input: ConcludeInput): Conclusion;
}

/**
 * The nodes of the workflow graph, one per stage, in the order a thread reaches them. A stored thread names its stages by
 * these IDs, so an ID never changes; a new stage only adds one.
 */
export const stageIds = ["start", "capture", "discovery", "diagnose", "repair", "widen", "conclude"] as const;

export type StageId = (typeof stageIds)[number];

/**
 * Compiles a stage without a checkpointer of its own, so it uses the workflow graph's. LangGraph gives a stage's run
 * an unset `checkpoint_id` in its configuration, and a run whose configuration has that key does not apply the
 * stored writes of the tasks that finished beside a failed one: a resumed stage would repeat them. The stage's run
 * gets its configuration without the unset key, as the workflow graph's own run does.
 */
function compileStage<G extends { compile(): { invoke(input: never, config?: LangGraphRunnableConfig): Promise<unknown> } }>(stage: G): ReturnType<G["compile"]> {
  const graph = stage.compile() as ReturnType<G["compile"]>;
  const invoke = graph.invoke.bind(graph);
  graph.invoke = (input: never, config?: LangGraphRunnableConfig) => {
    const configurable = config?.configurable;
    if (configurable === undefined || !("checkpoint_id" in configurable) || configurable["checkpoint_id"] !== undefined) return invoke(input, config);
    const { checkpoint_id: _unset, ...rest } = configurable;
    return invoke(input, { ...config, configurable: rest });
  };
  return graph;
}

/** After `repair` (without widening) or `widen`: `repair` again when a cluster is pending a next attempt, else the conclusion. */
function nextAttemptRoute(state: WorkflowStateValue): "repair" | "conclude" {
  return nextRepairRoute(state.repairs).kind === "end" ? "conclude" : "repair";
}

/**
 * start → capture → diagnose → repair → widen → conclude, each stage a subgraph of its own nodes (see the stage
 * builders) that shares the thread's state, with its fan-outs and their checkpoints in the stage's namespace. The
 * edges between the stages skip the stages a thread's options leave out: a thread that did not triage ends after
 * `capture`, one without diagnosis concludes after it, one without repair after `diagnose`. A thread whose scope shows
 * no difference goes from `capture` to `discovery` instead (see `discovers`) and concludes after it. A cluster whose attempt
 * was rejected and may have another is pending again after `widen` (or `repair`, when widening is off), and goes back
 * to `repair`; its passed next attempt is widened on the source accepted so far.
 */
export function buildWorkflowGraph(steps: WorkflowSteps, diagnosis: DiagnosisSteps, repair: RepairSteps, widening: WideningSteps, loop: LoopSteps, discovery: ThreadDiscoverySteps) {
  return new StateGraph(ThreadState)
    .addNode("start", compileStage(buildStartStage(steps)))
    .addNode("capture", compileStage(buildCaptureStage(steps)))
    .addNode("discovery", compileStage(buildDiscoveryStage(discovery)))
    .addNode("diagnose", compileStage(buildDiagnoseStage(diagnosis)))
    .addNode("repair", compileStage(buildRepairStage(repair)))
    .addNode("widen", compileStage(buildWidenStage(widening)))
    .addNode("conclude", compileStage(buildConcludeStage(loop)))
    .addEdge(START, "start")
    .addConditionalEdges("start", (state: WorkflowStateValue) => {
      if (state.plan.length === 0) throw new SetupError("No case is planned, so nothing can be captured.");
      return "capture";
    }, ["capture"])
    .addConditionalEdges("capture", (state: WorkflowStateValue) => {
      if (state.triageSummary === null) return END;
      if (discovers(state)) return "discovery";
      return state.options.diagnosis && nodeMode("diagnose", state.options.only) !== "skip" ? "diagnose" : "conclude";
    }, ["discovery", "diagnose", "conclude", END])
    .addEdge("discovery", "conclude")
    .addConditionalEdges("diagnose", (state: WorkflowStateValue) => (repairs(state.options) ? "repair" : "conclude"), ["repair", "conclude"])
    .addConditionalEdges("repair", (state: WorkflowStateValue) => (widens(state.options) ? "widen" : nextAttemptRoute(state)), ["widen", "repair", "conclude"])
    .addConditionalEdges("widen", nextAttemptRoute, ["repair", "conclude"])
    .addEdge("conclude", END);
}
