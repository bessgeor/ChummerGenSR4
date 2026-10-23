import { Annotation } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import type { CheckResult } from "../diagnosis/check.js";
import { mergeClusters, type ClusterDiagnosis, type ClusterUpdate } from "../diagnosis/cluster-diagnosis.js";
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
  /** Each triage cluster's diagnosis, by cluster ID; job nodes update the clusters they ran. */
  clusters: Annotation<Record<string, ClusterDiagnosis>, Record<string, ClusterUpdate>>({
    reducer: mergeClusters,
    default: () => ({}),
  }),
  /** Model time of the thread's finished jobs, in milliseconds; quota waits are never added. */
  agentMilliseconds: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
  /** The batched check run and each checked cluster's outcome, once it ran. */
  diagnosisCheck: Annotation<CheckResult | null>(),
  /** The thread's `diagnosis.json`, once diagnosis finished. */
  diagnosisPath: Annotation<string | null>(),
});

export type WorkflowStateValue = typeof WorkflowState.State;
export type WorkflowStateUpdate = typeof WorkflowState.Update;

/** The payload `Send` gives the capture and compare nodes: the state plus the index of their case. */
export type CaseTask = WorkflowStateValue & { readonly index: number };

/** The payload `Send` gives a diagnosis job node: the state plus the cluster it works on. */
export type ClusterTask = WorkflowStateValue & { readonly clusterId: string };
