import { randomBytes } from "node:crypto";
import type { CasePlan } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";
import type { Command } from "../options/arguments.js";
import type { RunOptions } from "../options/run-options.js";
import { inventoryLines } from "../inventory/inventory-service.js";
import { describeOutcome } from "../loop/outcome.js";
import { describeRepair, repairStatus } from "../repair/repair-report.js";
import { describeWidening, wideningStatus } from "../widening/widening-report.js";
import type { CaseDetails } from "../steps/case-details.js";
import { describeCase } from "./case-report.js";
import { describeDiagnosis, diagnosisStatus } from "./diagnosis-report.js";
import type { buildWorkflowGraph } from "./workflow-graph.js";
import type { WorkflowStateValue } from "./workflow-state.js";

export const setupErrorStatus = 3;

/** The compiled workflow graph. */
export type WorkflowGraph = ReturnType<ReturnType<typeof buildWorkflowGraph>["compile"]>;

export type RunDependencies = {
  readonly graph: WorkflowGraph;
  readonly resolveOptions: (command: Extract<Command, { kind: "start" }>) => RunOptions;
  readonly planCases: (options: RunOptions) => CasePlan;
  /** Reads a case's run folder for the report; a failure is a setup error. */
  readonly readCase: (runFolder: string, compared: boolean) => CaseDetails;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  /** Why an unattended run may not dispatch its model jobs; empty when it may (or is not unattended). */
  readonly certificateProblems: (options: RunOptions) => readonly string[];
  /** Aborts when the operator interrupts the run (Ctrl+C): running children are stopped and the thread stays resumable. */
  readonly signal?: AbortSignal;
};

export function newThreadId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `wf-${stamp}-${randomBytes(4).toString("hex")}`;
}

/**
 * LangGraph's limit on super-steps in one invocation. A quota wait costs about four of them every 15 minutes and
 * must not end for lack of steps, so the limit is far beyond any wait a subscription's limit can last.
 */
export const recursionLimit = 1_000_000;

function config(threadId: string, signal: AbortSignal | undefined) {
  return {
    configurable: { thread_id: threadId }, recursionLimit, durability: "sync" as const,
    ...(signal === undefined ? {} : { signal }),
  };
}

/** The highest finished status of every capture and compare, of the diagnosis, of the repair and of the widening; the outcome does not count. */
export function exitStatus(state: Pick<WorkflowStateValue, "captures" | "compares"> & Partial<Pick<WorkflowStateValue, "clusters" | "diagnosisCheck" | "repairs" | "widenings" | "earlierWidenings">>): number {
  const statuses = [...Object.values(state.captures), ...Object.values(state.compares)].map((outcome) => outcome.status);
  const widenings = [...(state.earlierWidenings ?? []), ...Object.values(state.widenings ?? {})];
  return Math.max(0, ...statuses, diagnosisStatus(state.clusters ?? {}, state.diagnosisCheck ?? null), repairStatus(state.repairs ?? {}), wideningStatus(widenings));
}

function report(state: WorkflowStateValue, readCase: RunDependencies["readCase"], log: (line: string) => void): void {
  for (const item of state.plan) {
    const capture = state.captures[item.name];
    const compare = state.compares[item.name];
    const details = capture === undefined ? null : readCase(capture.runFolder, compare !== undefined);
    for (const line of describeCase(item.name, capture, compare, details)) log(line);
  }
  if (state.triageSummary !== null) {
    const triage = state.triageSummary;
    log(`Triage: ${triage.discrepancies} discrepancies in ${triage.clusters} clusters (${triage.newClusters} new), `
      + `${triage.otherFindings} other findings; ${triage.path}`);
  }
  // A thread checkpointed before the inventory existed has no such field at all.
  for (const line of inventoryLines(state.inventorySummary, state.triageSummary !== null)) log(line);
  // A thread checkpointed before diagnosis existed has no such fields at all.
  for (const line of describeDiagnosis(state.clusters ?? {}, state.diagnosisCheck ?? null, state.diagnosisPath ?? null)) log(line);
  for (const line of describeRepair(state.repairs ?? {}, state.repairPath ?? null)) log(line);
  for (const line of describeWidening([...(state.earlierWidenings ?? []), ...Object.values(state.widenings ?? {})], state.accepted ?? null, state.wideningPath ?? null)) log(line);
  if (state.outcome != null && state.outcomePath != null) for (const line of describeOutcome(state.outcome, state.outcomePath)) log(line);
}

async function start(command: Extract<Command, { kind: "start" }>, dependencies: RunDependencies): Promise<{ threadId: string; input: WorkflowStateValue }> {
  const options = dependencies.resolveOptions(command);
  requireCertificates(options, dependencies);
  const plan = dependencies.planCases(options);
  for (const name of plan.excluded) dependencies.log(`${name} is left out: none of the requested captures belongs to it.`);
  const threadId = newThreadId(dependencies.now());
  const cache = options.canonicalCache === null ? "off (--live-canonical)" : `${options.canonicalCache} (${options.canonicalCacheSource})`;
  dependencies.log(`Thread ${threadId}: ${plan.cases.length} cases, canonical cache ${cache}.`);
  const input: WorkflowStateValue = {
    threadId, options, plan: [...plan.cases], fingerprints: null, captures: {}, lastCaptured: -1, compares: {}, triageSummary: null, inventorySummary: null,
    clusters: {}, agentMilliseconds: 0, diagnosisCheck: null, diagnosisPath: null, repairs: {}, repairPath: null, widenings: {}, earlierWidenings: [], accepted: null, wideningPath: null,
    startedUtc: dependencies.now().toISOString(), outcome: null, outcomePath: null,
  };
  return { threadId, input };
}

/** An unattended run starts only when every job kind it dispatches has a certificate for its configuration. */
function requireCertificates(options: RunOptions, dependencies: RunDependencies): void {
  const problems = dependencies.certificateProblems(options);
  if (problems.length > 0) {
    throw new SetupError(`--unattended needs a certificate for every job kind diagnosis dispatches:\n  ${problems.join("\n  ")}`);
  }
}

async function checkResumable(threadId: string, dependencies: RunDependencies): Promise<void> {
  const snapshot = await dependencies.graph.getState({ configurable: { thread_id: threadId } });
  const values = snapshot.values as Partial<WorkflowStateValue>;
  if (snapshot.config.configurable?.["checkpoint_id"] === undefined || values.plan === undefined || values.options === undefined) {
    throw new SetupError(`There is no thread ${threadId} to resume.`);
  }
  if (snapshot.next.length === 0) {
    throw new SetupError(`Thread ${threadId} already finished; start a new run instead.`);
  }
  requireCertificates(values.options, dependencies);
}

/** Reports a thread whose graph ran to its end; a result that cannot be read is a setup error, and the finished thread has nothing to resume. */
function finish(final: WorkflowStateValue, dependencies: RunDependencies): number {
  try {
    report(final, dependencies.readCase, dependencies.log);
  } catch (error) {
    dependencies.log(`Setup error: ${error instanceof SetupError ? error.message : (error as Error).stack ?? String(error)}`);
    dependencies.log(`Thread ${final.threadId} finished, but its results could not be reported; the thread has nothing to resume.`);
    return setupErrorStatus;
  }
  const status = exitStatus(final);
  dependencies.log(`Thread ${final.threadId} finished: exit ${status}.`);
  return status;
}

/** Runs or resumes a thread and returns the exit status; any failure is a setup error, and an unfinished thread stays resumable. */
export async function runWorkflow(command: Exclude<Command, { kind: "help" }>, dependencies: RunDependencies): Promise<number> {
  const { graph, log } = dependencies;
  let threadId: string | null = command.kind === "resume" ? command.threadId : null;
  try {
    let final: WorkflowStateValue;
    if (command.kind === "resume") {
      await checkResumable(command.threadId, dependencies);
      log(`Resuming thread ${command.threadId}.`);
      final = await graph.invoke(null, config(command.threadId, dependencies.signal));
    } else {
      const started = await start(command, dependencies);
      threadId = started.threadId;
      log(`Resume it after an interruption with: npm start -- --resume ${threadId}`);
      final = await graph.invoke(started.input, config(threadId, dependencies.signal));
    }
    return finish(final, dependencies);
  } catch (error) {
    if (dependencies.signal?.aborted === true) {
      log("Interrupted: the running steps were stopped.");
    } else {
      const message = error instanceof SetupError ? error.message : (error as Error).stack ?? String(error);
      log(`Setup error: ${message}`);
    }
    if (threadId !== null) log(`Thread ${threadId} stopped; resume it with: npm start -- --resume ${threadId}`);
    return setupErrorStatus;
  }
}
