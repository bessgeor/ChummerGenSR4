import { randomBytes } from "node:crypto";
import type { CasePlan } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";
import { threadDiscoveryLines, threadDiscoveryStatus } from "../discovery/thread-discovery.js";
import type { Command } from "../options/arguments.js";
import type { RunOptions } from "../options/run-options.js";
import { inventoryLines } from "../inventory/inventory-service.js";
import { describeOutcome } from "../loop/outcome.js";
import { describeRepair, repairStatus } from "../repair/repair-report.js";
import { describeWidening, wideningStatus } from "../widening/widening-report.js";
import type { CaseDetails } from "../steps/case-details.js";
import { describeCase } from "./case-report.js";
import { describeDiagnosis, diagnosisStatus } from "./diagnosis-report.js";
import type { HeadBranch } from "../git/integration.js";
import { stageIds, widens, type buildWorkflowGraph } from "./workflow-graph.js";
import type { WorkflowStateValue } from "./workflow-state.js";

export const setupErrorStatus = 3;

/** The compiled workflow graph. */
export type WorkflowGraph = ReturnType<ReturnType<typeof buildWorkflowGraph>["compile"]>;

export type RunDependencies = {
  readonly graph: WorkflowGraph;
  /** A new thread's options, before anything of the thread is written. */
  readonly resolveOptions: (command: Extract<Command, { kind: "start" }>, threadId: string) => RunOptions;
  /** Writes what a new thread needs before its plan (without --case-file, its suite) and returns its options. */
  readonly prepareThread: (command: Extract<Command, { kind: "start" }>, options: RunOptions, threadId: string) => RunOptions;
  readonly planCases: (options: RunOptions) => CasePlan;
  /** Reads a case's run folder for the report; a failure is a setup error. */
  readonly readCase: (runFolder: string, compared: boolean) => CaseDetails;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  /** Why an unattended run may not dispatch its model jobs; empty when it may (or is not unattended). */
  readonly certificateProblems: (options: RunOptions) => readonly string[];
  /** The branch the repository's HEAD names (null when detached) and its commit. */
  readonly head: () => HeadBranch;
  /** What a thread ID is already used by besides the checkpoint database (folders, branches), whatever the case; empty when it is free. */
  readonly threadTraces: (threadId: string) => readonly string[];
  /** Aborts when the operator interrupts the run (Ctrl+C): running children are stopped and the thread stays resumable. */
  readonly signal?: AbortSignal;
};

/** A thread ID: the prefix, the time and a random suffix. */
export function newThreadId(now: Date, prefix = "wf"): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${prefix}-${stamp}-${randomBytes(4).toString("hex")}`;
}

/**
 * LangGraph's limit on super-steps in one invocation. A quota wait costs about four of them every 15 minutes and
 * must not end for lack of steps, so the limit is far beyond any wait a subscription's limit can last.
 */
export const recursionLimit = 1_000_000;

/** The configuration every graph invocation of a thread takes. */
export function threadConfig(threadId: string, signal: AbortSignal | undefined) {
  return {
    configurable: { thread_id: threadId }, recursionLimit, durability: "sync" as const,
    ...(signal === undefined ? {} : { signal }),
  };
}

/** The highest finished status of every capture and compare, of the diagnosis, of the repair, of the widening and of the discovery; the outcome does not count. */
export function exitStatus(state: Pick<WorkflowStateValue, "captures" | "compares">
  & Partial<Pick<WorkflowStateValue, "clusters" | "diagnosisCheck" | "repairs" | "widenings" | "earlierWidenings" | "threadDiscovery">>): number {
  const statuses = [...Object.values(state.captures), ...Object.values(state.compares)].map((outcome) => outcome.status);
  const widenings = [...(state.earlierWidenings ?? []), ...Object.values(state.widenings ?? {})];
  return Math.max(0, ...statuses, diagnosisStatus(state.clusters ?? {}, state.diagnosisCheck ?? null), repairStatus(state.repairs ?? {}), wideningStatus(widenings),
    threadDiscoveryStatus(state.threadDiscovery ?? null));
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
  // A thread checkpointed before discovery existed has no such field at all.
  for (const line of threadDiscoveryLines(state.threadDiscovery ?? null)) log(line);
  // A thread checkpointed before diagnosis existed has no such fields at all.
  for (const line of describeDiagnosis(state.clusters ?? {}, state.diagnosisCheck ?? null, state.diagnosisPath ?? null)) log(line);
  for (const line of describeRepair(state.repairs ?? {}, state.repairPath ?? null)) log(line);
  for (const line of describeWidening([...(state.earlierWidenings ?? []), ...Object.values(state.widenings ?? {})], state.accepted ?? null, state.wideningPath ?? null)) log(line);
  if (state.outcome != null && state.outcomePath != null) for (const line of describeOutcome(state.outcome, state.outcomePath)) log(line);
}

/** How a run starts: a start may be given the ID of its new thread instead of getting a new one. */
export type RunRequest = { readonly threadId?: string };

/** A thread ID a caller chose: one path segment of letters, digits, dots, underscores and hyphens. */
const threadIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The names the thread ID cannot take as a folder or as a branch component: git's forbidden forms and the Windows device names. */
function unusableThreadId(threadId: string): string | null {
  if (!threadIdPattern.test(threadId)) return "use letters, digits, dots, underscores and hyphens, and start with a letter or digit";
  if (threadId.includes("..") || threadId.endsWith(".") || threadId.endsWith(".lock")) return "it must not contain '..' or end with '.' or '.lock'";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(threadId)) return "it is a Windows device name";
  return null;
}

/** The ID a start uses: the given one, which must name no thread yet whatever the case of its letters, or a new one. */
async function startThreadId(request: RunRequest, dependencies: RunDependencies): Promise<string> {
  if (request.threadId === undefined) return newThreadId(dependencies.now());
  const threadId = request.threadId;
  const unusable = unusableThreadId(threadId);
  if (unusable !== null) throw new SetupError(`'${threadId}' is not a thread ID: ${unusable}.`);
  const existing = await checkpointedThread(threadId, dependencies);
  if (existing !== null) {
    throw new SetupError(`Thread ${existing} exists already${existing === threadId ? "" : ` (the ID is compared without regard to case)`}; `
      + `a start needs a new thread ID (resume it with: npm start -- --resume ${existing}).`);
  }
  const traces = dependencies.threadTraces(threadId);
  if (traces.length > 0) throw new SetupError(`The thread ID ${threadId} is in use already: ${traces.join("; ")}. A start needs a new thread ID.`);
  return threadId;
}

/** The checkpointed thread whose ID equals `threadId` without regard to case, if any. */
async function checkpointedThread(threadId: string, dependencies: RunDependencies): Promise<string | null> {
  const checkpointer = checkpointerOf(dependencies.graph);
  if (await checkpointer.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: "" } }) !== undefined) return threadId;
  for await (const tuple of checkpointer.list({})) {
    const other = tuple.config.configurable?.["thread_id"];
    if (typeof other === "string" && other.toLowerCase() === threadId.toLowerCase()) return other;
  }
  return null;
}

function checkpointerOf(graph: WorkflowGraph) {
  const { checkpointer } = graph;
  if (checkpointer === undefined || typeof checkpointer === "boolean") throw new SetupError("The workflow graph was compiled without a checkpointer.");
  return checkpointer;
}

async function start(command: Extract<Command, { kind: "start" }>, request: RunRequest, dependencies: RunDependencies): Promise<{ threadId: string; input: WorkflowStateValue }> {
  const threadId = await startThreadId(request, dependencies);
  const resolved = dependencies.resolveOptions(command, threadId);
  requireCertificates(resolved, dependencies);
  const base = dependencies.head();
  // Its fixes are merged into the branch it started on when it concludes.
  if (base.branch === null && resolved.diagnosis && widens(resolved)) {
    throw new SetupError(`HEAD is detached at ${base.commit}, and a thread that repairs and widens merges its fixes into the branch it started on. `
      + "Check out a branch, or pass --no-repair or --no-widening.");
  }
  const options = dependencies.prepareThread(command, resolved, threadId);
  const plan = dependencies.planCases(options);
  for (const name of plan.excluded) dependencies.log(`${name} is left out: none of the requested captures belongs to it.`);
  const cache = options.canonicalCache === null ? "off (--live-canonical)" : `${options.canonicalCache} (${options.canonicalCacheSource})`;
  dependencies.log(`Thread ${threadId}: ${plan.cases.length} cases, canonical cache ${cache}.`);
  const input: WorkflowStateValue = {
    threadId, options, plan: [...plan.cases], pendingCaseIndexes: [], fingerprints: null, captures: {}, compares: {}, triageSummary: null, inventorySummary: null,
    clusters: {}, agentMilliseconds: 0, diagnosisCheck: null, diagnosisPath: null, repairs: {}, repairPath: null, widenings: {}, earlierWidenings: [], accepted: null, wideningPath: null,
    threadDiscovery: null, startedUtc: dependencies.now().toISOString(), base, outcome: null, outcomePath: null,
  };
  return { threadId, input };
}

/** An unattended run starts only when every job kind it dispatches has a certificate for its configuration. */
function requireCertificates(options: RunOptions, dependencies: RunDependencies): void {
  const problems = dependencies.certificateProblems(options);
  if (problems.length > 0) {
    throw new SetupError(`--unattended needs a certificate for every job kind the thread dispatches:\n  ${problems.join("\n  ")}`);
  }
}

async function checkResumable(threadId: string, dependencies: RunDependencies): Promise<void> {
  // Read before the graph interprets the checkpoint: the nodes of a flat graph's thread are not the graph's.
  if (await storedByFlatGraph(threadId, dependencies)) {
    throw new SetupError(`Thread ${threadId} was checkpointed before the workflow graph had stages, so it cannot be resumed. `
      + "Start a new run with the same options: it reuses the capture and compare steps the thread recorded.");
  }
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

/**
 * Whether the thread's latest checkpoint names a node that is not a stage: a node that ran (`versions_seen`) or one
 * that a channel would trigger (`branch:to:<node>`). The workflow graph's own checkpoints name only stages and
 * LangGraph's reserved nodes; a flat graph's name `build` from its first step on.
 */
async function storedByFlatGraph(threadId: string, dependencies: RunDependencies): Promise<boolean> {
  const tuple = await checkpointerOf(dependencies.graph).getTuple({ configurable: { thread_id: threadId, checkpoint_ns: "" } });
  if (tuple === undefined) return false;
  const triggered = Object.keys(tuple.checkpoint.channel_versions).flatMap((channel) => (channel.startsWith("branch:to:") ? [channel.slice("branch:to:".length)] : []));
  const nodes = [...Object.keys(tuple.checkpoint.versions_seen), ...triggered];
  return nodes.some((node) => !node.startsWith("__") && !(stageIds as readonly string[]).includes(node));
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

/**
 * Runs or resumes a thread and returns the exit status; any failure is a setup error, and an unfinished thread stays resumable.
 * A start given `request.threadId` runs its new thread under that ID.
 */
export async function runWorkflow(command: Exclude<Command, { kind: "help" }>, dependencies: RunDependencies, request: RunRequest = {}): Promise<number> {
  const { graph, log } = dependencies;
  // Set once the thread may run: a thread that is refused has nothing to resume.
  let threadId: string | null = null;
  try {
    let final: WorkflowStateValue;
    if (command.kind === "resume") {
      if (request.threadId !== undefined) throw new SetupError("A resume takes the thread ID of its command; only a start takes a given thread ID.");
      await checkResumable(command.threadId, dependencies);
      threadId = command.threadId;
      log(`Resuming thread ${command.threadId}.`);
      final = await graph.invoke(null, threadConfig(command.threadId, dependencies.signal));
    } else {
      const started = await start(command, request, dependencies);
      threadId = started.threadId;
      log(`Resume it after an interruption with: npm start -- --resume ${threadId}`);
      final = await graph.invoke(started.input, threadConfig(threadId, dependencies.signal));
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
