import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { SetupError } from "../host/setup-error.js";
import type { Arguments } from "../options/arguments.js";
import type { AutoTuningResult, AutoTuningStart } from "../tuning/tune-commands.js";
import type { Decision, Iteration, LoopDocument, ThreadSummary } from "./loop-document.js";

/** The exit status of a workflow thread stopped by a setup error or an interruption. */
const threadSetupErrorStatus = 3;

/** The work behind the loop graph's nodes. */
export interface LoopSteps {
  /** A new workflow thread ID. */
  newThreadId(): string;
  /** Starts the workflow thread `threadId` as `npm start` would with `args`, and returns its exit status. */
  runThread(threadId: string, args: Arguments): Promise<number>;
  /** What the finished thread changed, from its `outcome.json` and the commits of its merges. */
  threadSummary(threadId: string): ThreadSummary;
  /** Runs an automatic tuning, which tunes only when it is due; `onStart` learns the tuning before it runs. */
  tune(onStart: (start: AutoTuningStart) => void): Promise<AutoTuningResult>;
  /** Writes `loop.json`. */
  writeLoop(document: LoopDocument): void;
  now(): Date;
  log(line: string): void;
}

export const LoopState = Annotation.Root({
  loopId: Annotation<string>(),
  /** The options every thread is started with. */
  arguments: Annotation<Arguments>(),
  /** `loop.json` as last written. */
  document: Annotation<LoopDocument>(),
  /** The running thread's exit status, from `run_thread` to `decide_thread`. */
  exitStatus: Annotation<number | null>(),
});
export type LoopStateValue = typeof LoopState.State;

export function loopInput(document: LoopDocument, args: Arguments): LoopStateValue {
  return { loopId: document.loopId, arguments: args, document, exitStatus: null };
}

function current(document: LoopDocument): Iteration {
  const iteration = document.iterations.at(-1);
  if (iteration === undefined) throw new Error(`Loop ${document.loopId} has no iteration.`);
  return iteration;
}

/** `document` with its current iteration changed by `change`, written to `loop.json`. */
function recordIteration(steps: LoopSteps, document: LoopDocument, change: Partial<Iteration>, status = document.status): LoopDocument {
  const next: LoopDocument = { ...document, status, iterations: [...document.iterations.slice(0, -1), { ...current(document), ...change }] };
  steps.writeLoop(next);
  return next;
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

/** After the tuning: the next thread when the iteration changed something and the limit is not reached. */
export function decide(document: LoopDocument): Decision {
  const iteration = current(document);
  const changed = changes(iteration);
  if (changed.length === 0) {
    const tuning = iteration.tuning;
    const failed = tuning?.kind === "tuning" && tuning.outcome === "failed" ? [`tuning ${tuning.tuningId} failed with exit status ${tuning.exitStatus ?? "none"}`] : [];
    return { next: "converged", reasons: ["the thread and the tuning after it changed nothing", ...failed] };
  }
  const runs = document.options.maxRuns;
  if (runs !== null && document.iterations.length >= runs) return { next: "limit", reasons: [...changed, `${runs} of --max-runs ${runs} threads ran`] };
  return { next: "thread", reasons: changed };
}

/**
 * start_thread → run_thread → decide_thread → tune → decide → start_thread …, ending `failed` at `decide_thread` after a
 * thread that exited with 2, and `converged` or `limit` at `decide`. Every node writes `loop.json` before it returns: the
 * thread's ID before the thread starts and the tuning's before the tuning runs. A thread stopped by a setup error or an
 * interruption fails `run_thread`, and the loop stays `running`.
 */
export function buildLoopGraph(steps: LoopSteps) {
  return new StateGraph(LoopState)
    .addNode("start_thread", (state: LoopStateValue) => {
      const iteration: Iteration = {
        thread: steps.newThreadId(), startedUtc: steps.now().toISOString(), endedUtc: null, exitStatus: null, summary: null, tuning: null, decision: null,
      };
      const document: LoopDocument = { ...state.document, iterations: [...state.document.iterations, iteration] };
      steps.writeLoop(document);
      steps.log(`Loop ${state.loopId}: thread ${document.iterations.length} is ${iteration.thread}.`);
      return { document, exitStatus: null };
    })
    .addNode("run_thread", async (state: LoopStateValue) => {
      const { thread } = current(state.document);
      const exitStatus = await steps.runThread(thread, state.arguments);
      if (exitStatus === threadSetupErrorStatus) throw new SetupError(`Thread ${thread} of loop ${state.loopId} stopped with exit status ${exitStatus}; the loop stays running.`);
      return { exitStatus };
    })
    .addNode("decide_thread", (state: LoopStateValue) => {
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
    })
    .addNode("tune", async (state: LoopStateValue) => {
      const result = await steps.tune((start) => {
        recordIteration(steps, state.document, { tuning: { kind: "tuning", tuningId: start.tuningId, cycle: start.cycleId, outcome: null, exitStatus: null } });
      });
      const tuning = result.kind === "not_due"
        ? { kind: "not_due" as const, count: result.count, every: result.every }
        : { kind: "tuning" as const, tuningId: result.tuningId, cycle: result.cycleId, outcome: result.outcome, exitStatus: result.status };
      return { document: recordIteration(steps, state.document, { tuning }) };
    })
    .addNode("decide", (state: LoopStateValue) => {
      const decision = decide(state.document);
      const status = decision.next === "thread" ? "running" : decision.next;
      steps.log(`Loop ${state.loopId}: ${decision.next === "thread" ? "next thread" : decision.next}; ${decision.reasons.join("; ")}.`);
      return { document: recordIteration(steps, state.document, { decision }, status) };
    })
    .addEdge(START, "start_thread")
    .addEdge("start_thread", "run_thread")
    .addEdge("run_thread", "decide_thread")
    .addConditionalEdges("decide_thread", (state: LoopStateValue) => (state.document.status === "failed" ? END : "tune"), ["tune", END])
    .addEdge("tune", "decide")
    .addConditionalEdges("decide", (state: LoopStateValue) => (current(state.document).decision?.next === "thread" ? "start_thread" : END), ["start_thread", END]);
}

export type LoopGraph = ReturnType<ReturnType<typeof buildLoopGraph>["compile"]>;
