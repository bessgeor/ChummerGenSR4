import { randomBytes } from "node:crypto";
import type { CasePlan } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";
import type { Command } from "../options/arguments.js";
import type { RunOptions } from "../options/run-options.js";
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
  /** Aborts when the operator interrupts the run (Ctrl+C): running children are stopped and the thread stays resumable. */
  readonly signal?: AbortSignal;
};

export function newThreadId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `wf-${stamp}-${randomBytes(4).toString("hex")}`;
}

function config(threadId: string, cases: number, signal: AbortSignal | undefined) {
  // build, one capture per case, the last compare, triage and diagnosis, whose quota waits may repeat for hours.
  return {
    configurable: { thread_id: threadId }, recursionLimit: cases + 1000, durability: "sync" as const,
    ...(signal === undefined ? {} : { signal }),
  };
}

/** The highest finished status of every capture and compare and of the diagnosis. */
export function exitStatus(state: Pick<WorkflowStateValue, "captures" | "compares"> & Partial<Pick<WorkflowStateValue, "clusters" | "diagnosisCheck">>): number {
  const statuses = [...Object.values(state.captures), ...Object.values(state.compares)].map((outcome) => outcome.status);
  return Math.max(0, ...statuses, diagnosisStatus(state.clusters ?? {}, state.diagnosisCheck ?? null));
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
  for (const line of describeDiagnosis(state.clusters, state.diagnosisCheck, state.diagnosisPath)) log(line);
}

async function start(command: Extract<Command, { kind: "start" }>, dependencies: RunDependencies): Promise<{ threadId: string; cases: number; input: WorkflowStateValue }> {
  const options = dependencies.resolveOptions(command);
  const plan = dependencies.planCases(options);
  for (const name of plan.excluded) dependencies.log(`${name} is left out: none of the requested captures belongs to it.`);
  const threadId = newThreadId(dependencies.now());
  const cache = options.canonicalCache === null ? "off (--live-canonical)" : `${options.canonicalCache} (${options.canonicalCacheSource})`;
  dependencies.log(`Thread ${threadId}: ${plan.cases.length} cases, canonical cache ${cache}.`);
  const input: WorkflowStateValue = {
    threadId, options, plan: [...plan.cases], fingerprints: null, captures: {}, lastCaptured: -1, compares: {}, triageSummary: null,
    clusters: {}, agentMilliseconds: 0, diagnosisCheck: null, diagnosisPath: null,
  };
  return { threadId, cases: plan.cases.length, input };
}

async function resume(threadId: string, graph: WorkflowGraph): Promise<number> {
  const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
  const values = snapshot.values as Partial<WorkflowStateValue>;
  if (snapshot.config.configurable?.["checkpoint_id"] === undefined || values.plan === undefined) {
    throw new SetupError(`There is no thread ${threadId} to resume.`);
  }
  if (snapshot.next.length === 0) {
    throw new SetupError(`Thread ${threadId} already finished; start a new run instead.`);
  }
  return values.plan.length;
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
      const cases = await resume(command.threadId, graph);
      log(`Resuming thread ${command.threadId}.`);
      final = await graph.invoke(null, config(command.threadId, cases, dependencies.signal));
    } else {
      const started = await start(command, dependencies);
      threadId = started.threadId;
      log(`Resume it after an interruption with: npm start -- --resume ${threadId}`);
      final = await graph.invoke(started.input, config(threadId, started.cases, dependencies.signal));
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
