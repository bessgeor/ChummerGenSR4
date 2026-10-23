import { Annotation } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import type { RunOptions } from "../options/run-options.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { StepOutcome } from "../steps/step-outcome.js";

/** What triage reports back to the graph; the full result is in its `triage.json`. */
export type TriageSummary = {
  readonly path: string;
  readonly discrepancies: number;
  readonly clusters: number;
  readonly newClusters: number;
  readonly otherFindings: number;
};

const byCase = () => Annotation<Record<string, StepOutcome>>({
  reducer: (current, update) => ({ ...current, ...update }),
  default: () => ({}),
});

/** The checkpointed state of one workflow thread. */
export const WorkflowState = Annotation.Root({
  threadId: Annotation<string>(),
  options: Annotation<RunOptions>(),
  plan: Annotation<PlannedCase[]>(),
  fingerprints: Annotation<InputFingerprints | null>(),
  captures: byCase(),
  /** The index of the case the latest capture step handled; only one capture runs per super-step. */
  lastCaptured: Annotation<number>(),
  compares: byCase(),
  triageSummary: Annotation<TriageSummary | null>(),
});

export type WorkflowStateValue = typeof WorkflowState.State;

/** The payload `Send` gives the capture and compare nodes: the state plus the index of their case. */
export type CaseTask = WorkflowStateValue & { readonly index: number };
