import { Annotation, type LastValue } from "@langchain/langgraph";
import type { PlannedCase } from "../cases/case-plan.js";
import type { CheckResult } from "../diagnosis/check.js";
import { mergeClusters, type ClusterDiagnosis, type ClusterUpdate } from "../diagnosis/cluster-diagnosis.js";
import type { RunOptions } from "../options/run-options.js";
import { mergeRepairs, type ClusterRepair, type RepairUpdate } from "../repair/cluster-repair.js";
import type { OutcomeDocument } from "../loop/outcome.js";
import type { InventorySummary } from "../inventory/inventory-service.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import type { StepOutcome } from "../steps/step-outcome.js";
import { mergeWidenings, type AcceptedState, type ClusterWidening, type WideningUpdate } from "../widening/cluster-widening.js";

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
  compares: byCase(),
  triageSummary: Annotation<TriageSummary | null>(),
  /** The inventory's totals and folder, once the inventory after triage ran; absent in a thread stored before it existed. */
  inventorySummary: Annotation<InventorySummary | null>(),
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
  /** Each confirmed cluster's repair, by cluster ID; repair nodes update the clusters they ran. */
  repairs: Annotation<Record<string, ClusterRepair>, Record<string, RepairUpdate>>({
    reducer: mergeRepairs,
    default: () => ({}),
  }),
  /** The thread's `repair.json`, once repair finished. */
  repairPath: Annotation<string | null>(),
  /** Each passed repair attempt's widening, by cluster ID; widening nodes update the cluster they ran, and a next attempt removes its cluster's. */
  widenings: Annotation<Record<string, ClusterWidening>, Record<string, WideningUpdate | null>>({
    reducer: mergeWidenings,
    default: () => ({}),
  }),
  /** Rejected widenings of clusters that got a next attempt, in the order they were replaced. */
  earlierWidenings: Annotation<ClusterWidening[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  /** The source accepted so far, which the next widening starts from; null until widening starts or when nothing is widened. */
  accepted: Annotation<AcceptedState | null>(),
  /** The thread's `widening.json`, once widening finished. */
  wideningPath: Annotation<string | null>(),
  /** When the thread started; absent in a thread stored before it was recorded. */
  startedUtc: Annotation<string | null>(),
  /** The thread's outcome and its `outcome.json`, once it concluded. */
  outcome: Annotation<OutcomeDocument | null>(),
  outcomePath: Annotation<string | null>(),
});

export type WorkflowStateValue = typeof WorkflowState.State;
export type WorkflowStateUpdate = typeof WorkflowState.Update;

/**
 * The same state as the workflow graph holds it. A stage merges its nodes' writes through the reducers of
 * `WorkflowState` and returns the whole state when it ends; the workflow graph takes that as the thread's state, since
 * one stage runs at a time, so totals and lists are not counted twice and a removed widening stays removed.
 */
export const ThreadState = Annotation.Root(
  Object.fromEntries(Object.keys(WorkflowState.spec).map((key) => [key, Annotation()])) as { [K in keyof WorkflowStateValue]: LastValue<WorkflowStateValue[K]> },
);

/** The payload `Send` gives the capture and compare nodes: the state plus the index of their case. */
export type CaseTask = WorkflowStateValue & { readonly index: number };

/** The payload `Send` gives a diagnosis job node, a repair node or a widening node: the state plus the cluster it works on. */
export type ClusterTask = WorkflowStateValue & { readonly clusterId: string };
