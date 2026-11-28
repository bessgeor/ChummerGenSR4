import { existsSync, mkdirSync } from "node:fs";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { openCheckpointSaver } from "../graph/checkpoint-database.js";
import type { ComposedWorkflow } from "../compose-workflow.js";
import type { EvalContext } from "../evals/eval-context.js";
import { graphEnded } from "../graph/graph-ended.js";
import { newThreadId, recursionLimit, setupErrorStatus } from "../graph/run-workflow.js";
import { acquireExclusiveLock } from "../host/exclusive-lock.js";
import { SetupError } from "../host/setup-error.js";
import { invokePausable, type LoopThread, type PauseGate } from "../loop/loop-control.js";
import { LoopMonitor } from "../loop/loop-monitor.js";
import { readAutoTuning } from "../tuning/auto-tuning.js";
import { cycleStatus, runAutoTuning, type AutoTuningResult } from "../tuning/tune-commands.js";
import { autoCycleId } from "../tuning/tuning-steps.js";
import type { LoopCommand } from "./loop-arguments.js";
import { writeGraphStructures } from "./graph-structure.js";
import {
  checkLoopId, readLoopDocument, readThreadSummary, stopRequested, writeLoopDocument, writeStopRequest, type LoopDocument, type LoopPaths, type LoopProgress,
} from "./loop-document.js";
import { buildLoopGraph, loopInput, type LoopGraphSteps, type LoopStateValue, type LoopSteps } from "./loop-graph.js";

/** The loop's checkpointer, `out/loop/checkpoints.sqlite`. */
export function openLoopCheckpointer(paths: LoopPaths): SqliteSaver {
  mkdirSync(paths.root, { recursive: true });
  return openCheckpointSaver(paths.checkpoints);
}

export type LoopHost = {
  readonly paths: LoopPaths;
  readonly workflow: ComposedWorkflow;
  readonly threadFolder: (threadId: string) => string;
  /** The evaluation context the automatic tuning runs in; its git is the repository's. */
  readonly evalContext: EvalContext;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** Whether the automatic tuning's state holds the tuning `tuningId`, in progress or ended. */
export function startedAutoTuning(evalsFolder: string, tuningId: string): boolean {
  const state = readAutoTuning(evalsFolder);
  return state.current?.tuningId === tuningId || state.tunings.some((tuning) => tuning.tuningId === tuningId);
}

/** The result of the automatic tuning `tuningId` when it ended, from the automatic tuning's state; null while it has not. */
export function endedAutoTuning(evalsFolder: string, tuningId: string): AutoTuningResult | null {
  const entry = readAutoTuning(evalsFolder).tunings.find((tuning) => tuning.tuningId === tuningId);
  if (entry?.outcome == null) return null;
  return { kind: "tuned", tuningId, cycleId: entry.cycle ?? autoCycleId(tuningId), outcome: entry.outcome, status: cycleStatus(entry.outcome) };
}

/**
 * The steps of a loop on this machine: threads of the composed workflow, the eval CLI's automatic tuning, the trees of
 * the commits of a thread's merges from the repository, and `loop.json` and the stop request in the loop's folder.
 */
export function hostLoopSteps(loopId: string, host: LoopHost): LoopSteps {
  const { paths, workflow, evalContext, now, log } = host;
  // The loop's threads and tunings pause with it, and the loop records why each started.
  const gate = (reason: string): PauseGate => ({ folder: paths.folder(loopId), log, reason });
  const treeOf = (commit: string) => evalContext.branchGit(["rev-parse", "--verify", `${commit}^{tree}`]).trim();
  return {
    newThreadId: () => newThreadId(now()),
    threadProgress: (threadId) => workflow.progress(threadId),
    runThread: (threadId, args, reason) => workflow.run({ kind: "start", arguments: args }, { threadId, loopControl: gate(reason) }),
    resumeThread: (threadId, reason) => workflow.run({ kind: "resume", threadId }, { loopControl: gate(reason) }),
    threadSummary: (threadId) => readThreadSummary(threadId, host.threadFolder(threadId), treeOf),
    tuningStarted: (tuningId) => startedAutoTuning(evalContext.paths.evalsFolder, tuningId),
    tune: async (onStart, recorded, reason) => {
      const ended = recorded === null ? null : endedAutoTuning(evalContext.paths.evalsFolder, recorded);
      if (ended?.kind === "tuned") {
        log(`Loop ${loopId}: tuning ${ended.tuningId} had ended ${ended.outcome}.`);
        return ended;
      }
      return runAutoTuning(evalContext, false, onStart, gate(reason));
    },
    writeLoop: (document) => writeLoopDocument(paths.document(loopId), document),
    readLoop: () => readLoopDocument(paths.document(loopId)),
    stopRequested: () => stopRequested(paths, loopId),
    now,
    log,
  };
}

/** What a loop runs on, and the closing of what was opened for it. */
export type LoopComposition = {
  readonly checkpointer: BaseCheckpointSaver;
  readonly steps: LoopSteps;
  readonly close: () => void;
};

export type LoopDependencies = {
  readonly paths: LoopPaths;
  /** Composes what the loop `loopId` runs on, opening its databases; a resume composes only under the loop's lock. */
  readonly compose: (loopId: string) => LoopComposition;
  /** The desktop lanes of the profile, whose flags and tasks `state.json` shows. */
  readonly lanes: readonly string[];
  readonly newLoopId: (now: Date) => string;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly signal?: AbortSignal;
  /** How the loop graph waits while the loop is paused; by default it reads the control file every second. */
  readonly pause?: Omit<PauseGate, "folder" | "log">;
  /** How often `state.json` follows the control file between the graphs' events; by default every second. */
  readonly statePollMilliseconds?: number;
};

/** Exit status of a loop that ended: 0 converged, limit or stopped, 2 failed. */
export function loopExitStatus(document: LoopProgress): number {
  if (document.status === "running") throw new Error(`Loop ${document.loopId} ended while it is running.`);
  return document.status === "failed" ? 2 : 0;
}

/** The recorded loop `loopId`; a loop without its `loop.json` is a setup error. */
function recordedLoop(paths: LoopPaths, loopId: string): LoopDocument {
  checkLoopId(loopId);
  const path = paths.document(loopId);
  if (!existsSync(path)) throw new SetupError(`There is no loop ${loopId} (${path}).`);
  return readLoopDocument(path);
}

/** The recorded loop `loopId` when it may resume; a loop that does not exist or is not running is a setup error. */
function resumableLoop(paths: LoopPaths, loopId: string): LoopDocument {
  const document = recordedLoop(paths, loopId);
  if (document.status !== "running") throw new SetupError(`Loop ${loopId} has ended ${document.status}; only a running loop resumes.`);
  return document;
}

/** `--stop <loop>`: writes the loop's stop request, which the loop reads before its next thread or tuning, and returns 0. */
export function stopLoop(loopId: string, paths: LoopPaths, now: () => Date, log: (line: string) => void): number {
  try {
    const document = recordedLoop(paths, loopId);
    writeStopRequest(paths, loopId, now());
    log(document.status === "running"
      ? `Loop ${loopId}: stop requested (${paths.stopRequest(loopId)}); it ends stopped before its next thread or tuning. `
        + "A loop stopped by a setup error or Ctrl+C ends so when it is resumed, after the step it was running."
      : `Loop ${loopId}: stop requested; the loop has already ended ${document.status}.`);
    return 0;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Setup error: ${error.message}`);
    return setupErrorStatus;
  }
}

/**
 * The graph of a loop over the composed steps, and the monitor of its run. `loop.json` holds what the graph keeps of it
 * and the threads the monitor learns of, those `recorded` in it already included; the graph reads it without them.
 */
function observedLoop(composed: LoopComposition, recorded: LoopDocument, dependencies: LoopDependencies) {
  const { threads: recordedThreads, ...kept } = recorded;
  let progress: LoopProgress = kept;
  let threads: readonly LoopThread[] = recordedThreads;
  const write = () => composed.steps.writeLoop({ ...progress, threads: [...threads] });
  const steps: LoopGraphSteps = {
    ...composed.steps,
    writeLoop: (next) => {
      progress = next;
      write();
    },
    readLoop: () => {
      const { threads: _, ...read } = composed.steps.readLoop();
      return read;
    },
  };
  const monitor = new LoopMonitor({
    folder: dependencies.paths.folder(recorded.loopId), lanes: dependencies.lanes, now: dependencies.now, threads: recordedThreads,
    onThreads: (next) => {
      threads = next;
      write();
    },
    ...(dependencies.statePollMilliseconds === undefined ? {} : { pollMilliseconds: dependencies.statePollMilliseconds }),
  });
  return { graph: buildLoopGraph(steps).compile({ checkpointer: composed.checkpointer }), monitor };
}

/**
 * Starts a loop, recorded in `loop.json` as running, or resumes a running loop from its checkpoint, and runs its graph,
 * checkpointed under the loop's ID, to its end. A resumed loop repeats the node that stopped, which resumes the thread or
 * the tuning it was running. A setup error or an interruption ends the process with status 3 and leaves the loop running;
 * a resume of a loop that does not exist, is not running or is run by another process is a setup error that changes
 * nothing. The process holds the loop's lock while it runs the loop. Before the graph runs, the structure of the graphs
 * the loop runs is written to `out/loop/graphs/`; while it runs, `state.json` and `activity.jsonl` in the loop's folder
 * and the threads in `loop.json` follow it (see `LoopMonitor`).
 */
export async function runLoop(command: Extract<LoopCommand, { kind: "start" | "resume" }>, dependencies: LoopDependencies): Promise<number> {
  const { log } = dependencies;
  // Set once the loop may run: a refused resume leaves the loop as it was.
  let loopId: string | null = null;
  let release = () => {};
  let composition: LoopComposition | null = null;
  let monitor: LoopMonitor | null = null;
  try {
    // The loop's own nodes pause with it too: a paused loop starts no further thread or tuning until it is unpaused.
    const invoke = async (loop: ReturnType<typeof observedLoop>, input: LoopStateValue | null, id: string) => {
      await writeGraphStructures(dependencies.paths.graphs);
      monitor = loop.monitor;
      monitor.start();
      return await invokePausable(loop.graph, input, {
        configurable: { thread_id: id }, recursionLimit, durability: "sync", ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
      }, { folder: dependencies.paths.folder(id), log, ...dependencies.pause }, `Loop ${id}`, "loop") as LoopStateValue;
    };
    let final: LoopStateValue;
    if (command.kind === "resume") {
      resumableLoop(dependencies.paths, command.loopId);
      release = acquireExclusiveLock(dependencies.paths.lock(command.loopId), `Loop ${command.loopId} is running in another process`);
      // Read again under the lock: the process that held it may have ended the loop.
      const recorded = resumableLoop(dependencies.paths, command.loopId);
      composition = dependencies.compose(command.loopId);
      const loop = observedLoop(composition, recorded, dependencies);
      const snapshot = await loop.graph.getState({ configurable: { thread_id: command.loopId } });
      if (snapshot.config.configurable?.["checkpoint_id"] === undefined) throw new SetupError(`Loop ${command.loopId} has no checkpoint in ${dependencies.paths.checkpoints}.`);
      if (graphEnded(snapshot)) throw new SetupError(`Loop ${command.loopId}'s graph has ended, but its loop.json says it is running.`);
      loopId = command.loopId;
      log(`Resuming loop ${loopId} at ${snapshot.tasks.map((task) => task.name).join(", ")}: ${dependencies.paths.document(loopId)}`);
      final = await invoke(loop, null, loopId);
    } else {
      const startedUtc = dependencies.now();
      const newId = dependencies.newLoopId(startedUtc);
      composition = dependencies.compose(newId);
      release = acquireExclusiveLock(dependencies.paths.lock(newId), `Loop ${newId} is running in another process`);
      loopId = newId;
      const document: LoopProgress = {
        schemaVersion: 1, loopId, startedUtc: startedUtc.toISOString(), options: { arguments: [...command.options], maxRuns: command.maxRuns }, status: "running", iterations: [],
      };
      log(`Loop ${loopId}: ${dependencies.paths.document(loopId)}`);
      log(`Resume it after an interruption with: npm run loop -- --resume ${loopId}; stop it with: npm run loop -- --stop ${loopId}`);
      const recorded: LoopDocument = { ...document, threads: [] };
      composition.steps.writeLoop(recorded);
      final = await invoke(observedLoop(composition, recorded, dependencies), loopInput(document, command.arguments), loopId);
    }
    const status = loopExitStatus(final.document);
    log(`Loop ${loopId} ${final.document.status} after ${final.document.iterations.length} threads: exit ${status}.`);
    return status;
  } catch (error) {
    if (dependencies.signal?.aborted === true) log("Interrupted: the running step was stopped.");
    else log(`Setup error: ${error instanceof SetupError ? error.message : (error as Error).stack ?? String(error)}`);
    if (loopId !== null) log(`Loop ${loopId} stopped; it stays running. Resume it with: npm run loop -- --resume ${loopId}`);
    return setupErrorStatus;
  } finally {
    try {
      // Set inside `invoke`, which the compiler's narrowing does not follow.
      (monitor as LoopMonitor | null)?.stop();
      composition?.close();
    } finally {
      release();
    }
  }
}
