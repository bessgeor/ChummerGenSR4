import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { nodeMode, type WorkflowSteps } from "../src/graph/workflow-graph.js";
import { WorkflowState, type WorkflowStateValue } from "../src/graph/workflow-state.js";
import type { StepContext } from "../src/steps/step-outcome.js";

/** The state of a thread in the older checkpoint format: the index of the case the latest capture handled. */
const LegacyState = Annotation.Root({ ...WorkflowState.spec, lastCaptured: Annotation<number>() });
type LegacyValue = WorkflowStateValue & { readonly lastCaptured: number };
type LegacyTask = LegacyValue & { readonly index: number };

function context(state: LegacyValue, mode: StepContext["mode"]): StepContext {
  if (state.fingerprints === null) throw new Error("The graph of the older format ran without the thread's inputs.");
  return { threadId: state.threadId, options: state.options, fingerprints: state.fingerprints, mode };
}

/**
 * The capture and compare part of a graph that writes the older checkpoint format: one capture per super-step, whose
 * conditional edge sends the compare of its case and the capture of the next from the state's `lastCaptured`, and
 * a compare edge that sends triage once every case is compared, then the inventory. Its threads are used to test
 * what the current graph does with a thread of that format.
 */
export function buildLegacyCaseGraph(steps: WorkflowSteps) {
  return new StateGraph(LegacyState)
    .addNode("build", async (state: LegacyValue) => ({ fingerprints: await steps.build(state.options, true) }))
    .addNode("capture", async (state: LegacyTask) => {
      const item = state.plan[state.index]!;
      const outcome = await steps.capture(context(state, "run"), item);
      return { captures: { [outcome.case]: outcome }, lastCaptured: state.index };
    })
    .addNode("compare", async (state: LegacyTask) => {
      const item = state.plan[state.index]!;
      const outcome = await steps.compare(context(state, "run"), state.captures[item.name]!);
      return { compares: { [outcome.case]: outcome } };
    })
    .addNode("triage", async (state: LegacyValue) => ({
      triageSummary: await steps.triage({ threadId: state.threadId, plan: state.plan, captures: state.captures, compares: state.compares }, undefined as never),
    }))
    .addEdge(START, "build")
    .addConditionalEdges("build", (state: LegacyValue) => [new Send("capture", { ...state, index: 0 })], ["capture"])
    .addConditionalEdges("capture", (state: LegacyValue) => {
      const index = state.lastCaptured;
      const sends: Send[] = [];
      if (nodeMode("compare", state.options.only) !== "skip") sends.push(new Send("compare", { ...state, index }));
      if (index + 1 < state.plan.length) sends.push(new Send("capture", { ...state, index: index + 1 }));
      return sends;
    }, ["capture", "compare"])
    .addConditionalEdges("compare", (state: LegacyValue) => {
      const done = state.plan.every((item) => state.compares[item.name] !== undefined);
      return done && nodeMode("triage", state.options.only) !== "skip" ? ["triage"] : [];
    }, ["triage"])
    .addNode("inventory", async (state: LegacyValue) => ({
      inventorySummary: await steps.inventory({ threadId: state.threadId, plan: state.plan, captures: state.captures, candidateSource: state.fingerprints!.candidateSource }),
    }))
    .addEdge("triage", "inventory")
    .addEdge("inventory", END);
}