import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { PlannedCase } from "../../cases/case-plan.js";
import type { InventorySummary } from "../../inventory/inventory-service.js";
import type { NodeName } from "../../options/arguments.js";
import type { StepContext } from "../../steps/step-outcome.js";
import type { WorkflowSteps } from "../workflow-graph.js";
import { WorkflowState, type CaseTask, type WorkflowStateValue } from "../workflow-state.js";
import { nodeMode, requireStore } from "./stage-support.js";

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
 * At the start and after each step of captures and compares: a compare for every captured case not yet compared
 * (unless compare is skipped) and a capture for each of the next uncaptured cases, one per lane; triage once every
 * case is compared, or the end of the stage when triage is skipped and nothing is left.
 */
function caseRoute(state: WorkflowStateValue, lanes: number): Send[] | "triage" | typeof END {
  const comparing = nodeMode("compare", state.options.only) !== "skip";
  const sends: Send[] = [];
  let capturing = 0;
  state.plan.forEach((item, index) => {
    if (state.captures[item.name] === undefined) {
      if (capturing < lanes) sends.push(new Send("capture", { ...state, index }));
      capturing++;
    } else if (comparing && state.compares[item.name] === undefined) {
      sends.push(new Send("compare", { ...state, index }));
    }
  });
  if (sends.length > 0) return sends;
  return comparing && nodeMode("triage", state.options.only) !== "skip" ? "triage" : END;
}

/**
 * The `capture` stage: capture(cases k…k+n-1) → compare(cases k…k+n-1) ∥ capture(cases k+n…k+2n-1) → … → triage → inventory,
 * with n the number of desktop lanes. `route_cases` sends each case to its node, so the compares of one step and the
 * captures of the next run in the same super-step and each is checkpointed in the stage's namespace.
 */
export function buildCaptureStage(steps: WorkflowSteps) {
  return new StateGraph(WorkflowState)
    .addNode("route_cases", () => ({}))
    .addNode("capture", async (state: CaseTask, config: LangGraphRunnableConfig) => {
      const outcome = await steps.capture(context(state, "capture", config.signal), caseAt(state));
      return { captures: { [outcome.case]: outcome } };
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
    .addNode("inventory", async (state: WorkflowStateValue) => {
      // A thread stored before the inventory existed has no such field, and its capture runs recorded no UI trees.
      const recorded: InventorySummary | null | undefined = state.inventorySummary;
      if (recorded === undefined) return {};
      if (state.fingerprints === null) throw new Error("The inventory ran without the thread's inputs.");
      const summary = await steps.inventory({ threadId: state.threadId, plan: state.plan, captures: state.captures, candidateSource: state.fingerprints.candidateSource });
      return { inventorySummary: summary };
    })
    .addEdge(START, "route_cases")
    // Plain edges: the router runs once after every capture and compare of the step finished, and sees all their writes.
    .addEdge("capture", "route_cases")
    .addEdge("compare", "route_cases")
    .addConditionalEdges("route_cases", (state: WorkflowStateValue) => caseRoute(state, steps.captureLanes), ["capture", "compare", "triage", END])
    // The inventory reads the same capture runs as triage, so it runs whenever triage does.
    .addEdge("triage", "inventory")
    .addEdge("inventory", END);
}
