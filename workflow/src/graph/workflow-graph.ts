import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";
import type { NodeName } from "../options/arguments.js";
import type { RunOptions } from "../options/run-options.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { StepContext, StepMode, StepOutcome } from "../steps/step-outcome.js";
import { WorkflowState, type CaseTask, type TriageSummary, type WorkflowStateValue } from "./workflow-state.js";

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

const order: readonly NodeName[] = ["capture", "compare", "triage"];

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

/**
 * build → capture(case k) → compare(case k) ∥ capture(case k+1) → … → triage. `Send` addresses each case, so
 * compare k and capture k+1 run in the same super-step and both are checkpointed.
 */
export function buildWorkflowGraph(steps: WorkflowSteps) {
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
      if (config.store === undefined) throw new Error("The graph was compiled without a store.");
      const summary = await steps.triage({ threadId: state.threadId, plan: state.plan, captures: state.captures, compares: state.compares }, config.store);
      return { triageSummary: summary };
    })
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
    .addEdge("triage", END);
}
