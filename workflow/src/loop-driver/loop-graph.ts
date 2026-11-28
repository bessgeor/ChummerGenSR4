import { pausable } from "../loop/loop-control.js";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ThreadProgress } from "../graph/run-workflow.js";
import { SetupError } from "../host/setup-error.js";
import type { Arguments } from "../options/arguments.js";
import type { AutoTuningResult, AutoTuningStart } from "../tuning/tune-commands.js";
import type { Decision, Iteration, LoopDocument, LoopProgress, ThreadSummary } from "./loop-document.js";

/** The exit status of a workflow thread stopped by a setup error or an interruption. */
const threadSetupErrorStatus = 3;

/** The work behind the loop graph's nodes. */
export interface LoopSteps {
  /** A new workflow thread ID. */
  newThreadId(): string;
  /** Whether the workflow thread `threadId` started, and whether it finished. */
  threadProgress(threadId: string): Promise<ThreadProgress>;
  /** Starts the workflow thread `threadId` as `npm start` would with `args`, and returns its exit status; `reason` says why it starts. */
  runThread(threadId: string, args: Arguments, reason: string): Promise<number>;
  /** Resumes the unfinished workflow thread `threadId` as `npm start -- --resume` would, and returns its exit status; `reason` says why it started. */
  resumeThread(threadId: string, reason: string): Promise<number>;
  /** What the finished thread changed, from its `outcome.json` and the commits of its merges. */
  threadSummary(threadId: string): ThreadSummary;
  /** Whether the automatic tuning holds the tuning `tuningId`, in progress or ended. */
  tuningStarted(tuningId: string): boolean;
  /**
   * Runs an automatic tuning, which tunes only when it is due and continues the one in progress first; `onStart` learns
   * the tuning before it runs. `recorded` is the tuning `loop.json` recorded for this step before an interruption: when
   * it ended, its result is returned and nothing else runs. `reason` says why the tuning runs.
   */
  tune(onStart: (start: AutoTuningStart) => void, recorded: string | null, reason: string): Promise<AutoTuningResult>;
  /** Writes `loop.json`. */
  writeLoop(document: LoopDocument): void;
  /** Reads `loop.json` as last written. */
  readLoop(): LoopDocument;
  /** Whether a stop was requested (`npm run loop -- --stop`). */
  stopRequested(): boolean;
  now(): Date;
  log(line: string): void;
}

/** The steps the loop graph's nodes call: those of the loop, with `loop.json` read and written without its threads. */
export type LoopGraphSteps = Omit<LoopSteps, "writeLoop" | "readLoop"> & {
  writeLoop(progress: LoopProgress): void;
  readLoop(): LoopProgress;
};

export const LoopState = Annotation.Root({
  loopId: Annotation<string>(),
  /** The options every thread is started with. */
  arguments: Annotation<Arguments>(),
  /** `loop.json` as last written, without its threads. */
  document: Annotation<LoopProgress>(),
  /** The running thread's exit status, from `run_thread` to `decide_thread`. */
  exitStatus: Annotation<number | null>(),
});
export type LoopStateValue = typeof LoopState.State;

export function loopInput(document: LoopProgress, args: Arguments): LoopStateValue {
  return { loopId: document.loopId, arguments: args, document, exitStatus: null };
}

function current(document: LoopProgress): Iteration {
  const iteration = document.iterations.at(-1);
  if (iteration === undefined) throw new Error(`Loop ${document.loopId} has no iteration.`);
  return iteration;
}

/** `document` with its current iteration changed by `change`, written to `loop.json`. */
function recordIteration(steps: LoopGraphSteps, document: LoopProgress, change: Partial<Iteration>, status = document.status): LoopProgress {
  const next: LoopProgress = { ...document, status, iterations: [...document.iterations.slice(0, -1), { ...current(document), ...change }] };
  steps.writeLoop(next);
  return next;
}

const stopReason = (step: string) => `a stop was requested before the ${step}`;

/** Why the current iteration's thread starts: the loop started, or what the iteration before it changed. */
export function threadReason(document: LoopProgress): string {
  const before = document.iterations.at(-2);
  if (before === undefined) return "the loop started";
  return before.decision?.reasons.join("; ") ?? `thread ${before.thread} ended`;
}

/** What the iteration changed that the next thread would see. */
export function changes(iteration: Iteration): string[] {
  const summary = iteration.summary;
  return [
    ...(summary === null || !summary.sourceChanged ? [] : [`thread ${iteration.thread} merged ${summary.merged.join(", ")}`]),
    ...(summary === null || summary.admitted.length === 0 ? [] : [`thread ${iteration.thread} admitted ${summary.admitted.join(", ")}`]),
    ...(iteration.tuning?.kind === "tuning" && iteration.tuning.outcome === "activated" ? [`tuning ${iteration.tuning.tuningId} activated a configuration`] : []),
  ];
}

/**
 * After the tuning: `failed` when the tuning's job failed (exit status 2), whatever the thread changed; else the next
 * thread when the iteration changed something and the limit is not reached.
 */
export function decide(document: LoopProgress): Decision {
  const iteration = current(document);
  const tuning = iteration.tuning;
  if (tuning?.kind === "tuning" && tuning.outcome === "failed") {
    return { next: "failed", reasons: [`tuning ${tuning.tuningId} failed with exit status ${tuning.exitStatus ?? "none"}: its execution failures need a person`] };
  }
  const changed = changes(iteration);
  if (changed.length === 0) return { next: "converged", reasons: ["the thread and the tuning after it changed nothing"] };
  const runs = document.options.maxRuns;
  if (runs !== null && document.iterations.length >= runs) return { next: "limit", reasons: [...changed, `${runs} of --max-runs ${runs} threads ran`] };
  return { next: "thread", reasons: changed };
}

/**
 * start_thread → run_thread → decide_thread → tune → decide → start_thread …, ending `failed` at `decide_thread` after a
 * thread that exited with 2, and `failed`, `converged` or `limit` at `decide`. Every node writes `loop.json` before it returns: the
 * thread's ID before the thread starts and the tuning's before the tuning runs. A thread stopped by a setup error or an
 * interruption fails `run_thread`, and the loop stays `running`; resumed, `run_thread` resumes that thread (or starts it
 * when it had not started, under a new ID when the old one is in use) and `tune` the tuning in progress. A stop request
 * is read before each thread (`start_thread`, `decide` after an iteration, and `run_thread` while the thread has not
 * started) and each tuning (`tune` while none that started is recorded) and ends the loop
 * `stopped` without starting that step; a step that started runs to its end first.
 */
export function buildLoopGraph(steps: LoopGraphSteps) {
  return new StateGraph(LoopState)
    .addNode("start_thread", pausable((state: LoopStateValue) => {
      if (steps.stopRequested()) {
        const first = state.document.iterations.length === 0;
        const reason = stopReason(first ? "first thread" : "next thread");
        steps.log(`Loop ${state.loopId}: stopped; ${reason}.`);
        if (first) {
          const document: LoopProgress = { ...state.document, status: "stopped" };
          steps.writeLoop(document);
          return { document };
        }
        const previous = current(state.document).decision;
        const decision: Decision = { next: "stopped", reasons: [...(previous?.reasons ?? []), reason] };
        return { document: recordIteration(steps, state.document, { decision }, "stopped") };
      }
      const iteration: Iteration = {
        thread: steps.newThreadId(), startedUtc: steps.now().toISOString(), endedUtc: null, exitStatus: null, summary: null, tuning: null, decision: null,
      };
      const document: LoopProgress = { ...state.document, iterations: [...state.document.iterations, iteration] };
      steps.writeLoop(document);
      steps.log(`Loop ${state.loopId}: thread ${document.iterations.length} is ${iteration.thread}.`);
      return { document, exitStatus: null };
    }))
    .addNode("run_thread", pausable(async (state: LoopStateValue) => {
      // loop.json, not the checkpoint, names the thread: a failed node saves nothing to the checkpoint, and an earlier
      // run of this node may have recorded a new ID before it failed.
      let document = steps.readLoop();
      let { thread } = current(document);
      const progress = await steps.threadProgress(thread);
      // A stop request still keeps a thread that has not started from starting.
      if (progress.kind === "new" && steps.stopRequested()) {
        const decision: Decision = { next: "stopped", reasons: [stopReason(`thread ${thread}`)] };
        steps.log(`Loop ${state.loopId}: stopped; ${decision.reasons.join("; ")}.`);
        return { document: recordIteration(steps, document, { decision }, "stopped") };
      }
      // A start stopped early may leave its ID in use, so the step starts under a new ID.
      if (progress.kind === "new" && progress.traces.length > 0) {
        const replaced = thread;
        thread = steps.newThreadId();
        document = recordIteration(steps, document, { thread, startedUtc: steps.now().toISOString() });
        steps.log(`Loop ${state.loopId}: thread ${replaced} stopped before it started and its ID is in use (${progress.traces.join("; ")}); the thread starts as ${thread}.`);
      }
      let exitStatus: number;
      if (progress.kind === "finished") {
        steps.log(`Loop ${state.loopId}: thread ${thread} had finished with exit status ${progress.exitStatus}.`);
        exitStatus = progress.exitStatus;
      } else if (progress.kind === "unfinished") {
        steps.log(`Loop ${state.loopId}: resuming thread ${thread}.`);
        exitStatus = await steps.resumeThread(thread, threadReason(document));
      } else {
        exitStatus = await steps.runThread(thread, state.arguments, threadReason(document));
      }
      if (exitStatus === threadSetupErrorStatus) throw new SetupError(`Thread ${thread} of loop ${state.loopId} stopped with exit status ${exitStatus}; the loop stays running.`);
      return { document, exitStatus };
    }))
    .addNode("decide_thread", pausable((state: LoopStateValue) => {
      const iteration = current(state.document);
      const exitStatus = state.exitStatus;
      if (exitStatus === null) throw new Error(`decide_thread ran before thread ${iteration.thread} ended.`);
      const summary = steps.threadSummary(iteration.thread);
      const ended = { endedUtc: steps.now().toISOString(), exitStatus, summary };
      if (exitStatus === 2) {
        const decision: Decision = { next: "failed", reasons: [`thread ${iteration.thread} exited with 2: its execution failures need a person`] };
        steps.log(`Loop ${state.loopId}: failed; ${decision.reasons.join("; ")}.`);
        return { document: recordIteration(steps, state.document, { ...ended, decision }, "failed") };
      }
      return { document: recordIteration(steps, state.document, ended) };
    }))
    .addNode("tune", pausable(async (state: LoopStateValue) => {
      // The checkpoint holds the iteration as decide_thread left it; loop.json holds the tuning that started since.
      const written = steps.readLoop().iterations.at(-1);
      const recorded = written?.thread === current(state.document).thread && written.tuning?.kind === "tuning" ? written.tuning.tuningId : null;
      // A tuning is recorded before it starts, so a recorded one the automatic tuning does not hold has not started: a stop
      // request keeps the step from starting.
      if ((recorded === null || !steps.tuningStarted(recorded)) && steps.stopRequested()) {
        const decision: Decision = { next: "stopped", reasons: [stopReason("tuning")] };
        steps.log(`Loop ${state.loopId}: stopped; ${decision.reasons.join("; ")}.`);
        return { document: recordIteration(steps, state.document, { decision }, "stopped") };
      }
      const result = await steps.tune((start) => {
        recordIteration(steps, state.document, { tuning: { kind: "tuning", tuningId: start.tuningId, cycle: start.cycleId, outcome: null, exitStatus: null } });
      }, recorded, `the automatic tuning after thread ${current(state.document).thread}`);
      const tuning = result.kind === "not_due"
        ? { kind: "not_due" as const, count: result.count, every: result.every }
        : { kind: "tuning" as const, tuningId: result.tuningId, cycle: result.cycleId, outcome: result.outcome, exitStatus: result.status };
      return { document: recordIteration(steps, state.document, { tuning }) };
    }))
    .addNode("decide", pausable((state: LoopStateValue) => {
      const decided = decide(state.document);
      const decision: Decision = decided.next === "thread" && steps.stopRequested()
        ? { next: "stopped", reasons: [...decided.reasons, stopReason("next thread")] }
        : decided;
      const status = decision.next === "thread" ? "running" : decision.next;
      steps.log(`Loop ${state.loopId}: ${decision.next === "thread" ? "next thread" : decision.next}; ${decision.reasons.join("; ")}.`);
      return { document: recordIteration(steps, state.document, { decision }, status) };
    }))
    .addEdge(START, "start_thread")
    .addConditionalEdges("start_thread", (state: LoopStateValue) => (state.document.status === "stopped" ? END : "run_thread"), ["run_thread", END])
    .addConditionalEdges("run_thread", (state: LoopStateValue) => (state.document.status === "running" ? "decide_thread" : END), ["decide_thread", END])
    .addConditionalEdges("decide_thread", (state: LoopStateValue) => (state.document.status === "running" ? "tune" : END), ["tune", END])
    .addConditionalEdges("tune", (state: LoopStateValue) => (state.document.status === "running" ? "decide" : END), ["decide", END])
    .addConditionalEdges("decide", (state: LoopStateValue) => (current(state.document).decision?.next === "thread" ? "start_thread" : END), ["start_thread", END]);
}

export type LoopGraph = ReturnType<ReturnType<typeof buildLoopGraph>["compile"]>;
