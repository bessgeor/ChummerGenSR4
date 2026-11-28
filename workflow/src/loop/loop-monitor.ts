// What a loop writes for its readers while it runs: `state.json` (the pause flags and each desktop lane's flag and
// task) and `activity.jsonl` (a line per finished task of every graph it runs), from what its graphs, their nodes and
// its desktop lanes report to it (see `LoopObserver`), and the threads it ran for `loop.json`.
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import {
  appendActivity, observeLoop, readControl, writeLoopState, type ActivityLine, type GraphKind, type LaneTask, type LoopObserver, type LoopState, type LoopThread,
  type TaskResult, type TaskStart,
} from "./loop-control.js";

export type LoopMonitorOptions = {
  /** The loop's folder, whose control file it reads and where it writes `state.json` and `activity.jsonl`. */
  readonly folder: string;
  /** The desktop lanes of the profile, in its order. */
  readonly lanes: readonly string[];
  readonly now: () => Date;
  /** The threads recorded so far, when the loop goes on with them. */
  readonly threads?: readonly LoopThread[];
  /** Learns the loop's threads each time one starts or ends, for `loop.json`. */
  readonly onThreads: (threads: readonly LoopThread[]) => void;
  /** How often the control file is read again for a pause set or lifted between the graphs' events; by default every second. */
  readonly pollMilliseconds?: number;
};

type RunningTask = {
  readonly graph: GraphKind;
  readonly thread: string;
  readonly stage: string;
  readonly namespace: string;
  readonly node: string;
  readonly subject: string | null;
  readonly startedUtc: string;
  /** The loop's paused time when the task started. */
  readonly pausedBefore: number;
  lane: string | null;
};

type Invocation = { readonly graph: GraphKind; readonly thread: string; waiting: boolean };

/** The key of a task: its thread and its own checkpoint namespace. */
const taskKey = (thread: string, checkpointNamespace: string) => `${thread}\u0000${checkpointNamespace}`;

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null ? value as Record<string, unknown> : null);

/**
 * The case, cluster or job a task works on, from the input `Send` gave it: a capture's or compare's case (its plan
 * index), a cluster's job (with its hypothesis when it has one) and a discovery target's scenario; null otherwise.
 */
export function taskSubject(input: unknown): string | null {
  const value = record(input);
  if (value === null) return null;
  if (typeof value["index"] === "number" && Array.isArray(value["plan"])) {
    const name = record(value["plan"][value["index"]])?.["name"];
    return typeof name === "string" ? name : null;
  }
  if (typeof value["clusterId"] === "string") return typeof value["variant"] === "number" ? `${value["clusterId"]} hypothesis ${value["variant"]}` : value["clusterId"];
  if (typeof value["targetId"] === "string") return value["targetId"];
  return null;
}

/**
 * Observes a loop's graphs while it runs. `paused` is set once the loop's control file pauses it and the innermost graph
 * it runs (a thread's graph runs inside a node of the loop's) waits at its pauses; `pausing` while it is paused and a
 * task still runs. A desktop lane is busy with the task whose command holds it, found through the task's configuration.
 * A task the stream started that neither finished nor ran when its invocation stopped (at its pauses or its end) was
 * a finished task restored from its checkpoint and gets no line; one that ran gets a `failed` line.
 */
export class LoopMonitor implements LoopObserver {
  private readonly tasks = new Map<string, RunningTask>();
  /** Tasks whose node ran, and those whose node failed, by key. */
  private readonly entered = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly invocations: Invocation[] = [];
  private readonly busy = new Map<string, LaneTask>();
  private readonly threads: LoopThread[];
  private pausedMilliseconds = 0;
  private pausedSince: number | null = null;
  private written: string | null = null;
  /** A failure of a refresh that had no caller to fail (the poll's, or a lane's release): the next event fails with it. */
  private failure: unknown = null;
  private stopObserving: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: LoopMonitorOptions) {
    this.threads = [...(options.threads ?? [])];
  }

  /** Observes the loop's folder and writes its state until `stop`. */
  start(): void {
    this.stopObserving = observeLoop(this.options.folder, this);
    this.refresh();
    this.timer = setInterval(() => this.refreshLater(), this.options.pollMilliseconds ?? 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopObserving?.();
    this.stopObserving = null;
  }

  private check(): void {
    if (this.failure !== null) throw this.failure;
  }

  /** Writes `state.json` where nothing may fail: its failure is raised by the next event. */
  private refreshLater(): void {
    try {
      this.refresh();
    } catch (error) {
      this.failure ??= error;
    }
  }

  /** The loop's paused time so far, a pause in progress included. */
  private pausedNow(): number {
    return this.pausedMilliseconds + (this.pausedSince === null ? 0 : Math.max(0, this.options.now().getTime() - this.pausedSince));
  }

  /** Writes `state.json` when what it says changed. */
  refresh(): void {
    const control = readControl(this.options.folder);
    const innermost = this.invocations.at(-1);
    const stopped = innermost === undefined || innermost.waiting;
    const state: Omit<LoopState, "updatedUtc"> = {
      paused: control.paused && stopped,
      pausing: control.paused && !stopped,
      lanes: Object.fromEntries(this.options.lanes.map((lane) => [lane, { paused: control.lanes[lane]?.paused === true, busy: this.busy.get(lane) ?? null }])),
    };
    const text = JSON.stringify(state);
    if (text === this.written) return;
    writeLoopState(this.options.folder, { ...state, updatedUtc: this.options.now().toISOString() });
    this.written = text;
  }

  threadStarted(graph: GraphKind, thread: string, reason: string | null): void {
    this.check();
    if (graph !== "loop" && reason === null) throw new Error(`The loop started ${graph} thread ${thread} without a reason.`);
    this.invocations.push({ graph, thread, waiting: false });
    try {
      if (graph !== "loop" && reason !== null) {
        const index = this.threads.findIndex((entry) => entry.thread === thread);
        if (index < 0) this.threads.push({ thread, graph, startedUtc: this.options.now().toISOString(), endedUtc: null, reason });
        else this.threads[index] = { ...this.threads[index]!, endedUtc: null };
        this.options.onThreads([...this.threads]);
      }
      this.refresh();
    } catch (error) {
      // The graph does not run, so it never stops: the graph that invoked it is the innermost again.
      this.invocations.pop();
      throw error;
    }
  }

  taskStarted(graph: GraphKind, thread: string, namespace: readonly string[], task: TaskStart): void {
    this.check();
    const key = taskKey(thread, [...namespace, `${task.name}:${task.id}`].join("|"));
    this.tasks.set(key, {
      graph, thread, stage: namespace[0]?.split(":")[0] ?? task.name, namespace: namespace.join("|"), node: task.name, subject: taskSubject(task.input),
      startedUtc: this.options.now().toISOString(), pausedBefore: this.pausedNow(), lane: null,
    });
  }

  taskFinished(_graph: GraphKind, thread: string, namespace: readonly string[], task: TaskResult): void {
    this.check();
    const key = taskKey(thread, [...namespace, `${task.name}:${task.id}`].join("|"));
    this.finish(key, task.interrupts.length > 0 ? "interrupted" : this.failedAt(key) ? "failed" : "succeeded");
  }

  /** Whether the task, or a task of a subgraph it runs, failed. */
  private failedAt(key: string): boolean {
    for (const failed of this.failed) if (failed === key || failed.startsWith(`${key}|`)) return true;
    return false;
  }

  private ranAt(key: string): boolean {
    for (const entered of this.entered) if (entered === key || entered.startsWith(`${key}|`)) return true;
    return false;
  }

  /** Appends the task's line and forgets the task; what its node did is kept until its thread's invocation ends. */
  private finish(key: string, status: ActivityLine["status"]): void {
    const running = this.tasks.get(key);
    if (running === undefined) throw new Error(`A task finished that did not start: ${key.replace("\u0000", " ")}.`);
    this.tasks.delete(key);
    appendActivity(this.options.folder, {
      thread: running.thread, graph: running.graph, stage: running.stage, namespace: running.namespace, node: running.node, subject: running.subject,
      lane: running.lane, startedUtc: running.startedUtc, finishedUtc: this.options.now().toISOString(), pausedMs: this.pausedNow() - running.pausedBefore, status,
    });
  }

  taskEntered(thread: string, checkpointNamespace: string): void {
    this.entered.add(taskKey(thread, checkpointNamespace));
  }

  taskFailed(thread: string, checkpointNamespace: string): void {
    this.failed.add(taskKey(thread, checkpointNamespace));
  }

  pauseChanged(graph: GraphKind, thread: string, waiting: boolean): void {
    const innermost = this.invocations.at(-1);
    if (innermost?.graph !== graph || innermost.thread !== thread) throw new Error(`The pause of ${graph} thread ${thread} changed while it is not the innermost graph.`);
    innermost.waiting = waiting;
    // The resumed invocation restores the tasks that finished from its checkpoint and starts them again without running them.
    if (waiting) this.endRound(thread);
    const now = this.options.now().getTime();
    if (waiting) {
      this.pausedSince = now;
    } else if (this.pausedSince !== null) {
      this.pausedMilliseconds += Math.max(0, now - this.pausedSince);
      this.pausedSince = null;
    }
    this.refresh();
  }

  threadStopped(graph: GraphKind, thread: string, finished: boolean): void {
    const innermost = this.invocations.at(-1);
    if (innermost?.graph !== graph || innermost.thread !== thread) throw new Error(`${graph} thread ${thread} stopped while it is not the innermost graph.`);
    this.invocations.pop();
    this.endRound(thread);
    if (graph !== "loop" && finished) {
      const index = this.threads.findIndex((entry) => entry.thread === thread);
      this.threads[index] = { ...this.threads[index]!, endedUtc: this.options.now().toISOString() };
      this.options.onThreads([...this.threads]);
    }
    this.refresh();
  }

  /**
   * Ends a run of the thread's graph, at its pauses or at its end: a task without a result either was restored from
   * the checkpoint (it did not run, and gets no line) or ran when the invocation stopped with an error (`failed`). What
   * the tasks did is forgotten, since a resumed run starts them again.
   */
  private endRound(thread: string): void {
    const prefix = `${thread}\u0000`;
    // A subgraph's tasks before the task that runs it.
    for (const key of [...this.tasks.keys()].filter((item) => item.startsWith(prefix)).sort((a, b) => b.length - a.length)) {
      if (this.ranAt(key)) this.finish(key, "failed");
      else this.tasks.delete(key);
    }
    for (const set of [this.entered, this.failed]) for (const item of [...set]) if (item.startsWith(prefix)) set.delete(item);
  }

  laneHeld(lane: string, held: boolean): void {
    if (!held) {
      this.busy.delete(lane);
      // The command has run: a failed write must not replace its result or its error.
      this.refreshLater();
      return;
    }
    this.check();
    const configurable = AsyncLocalStorageProviderSingleton.getRunnableConfig()?.configurable as Record<string, unknown> | undefined;
    const thread = configurable?.["thread_id"];
    const namespace = configurable?.["checkpoint_ns"];
    const task = typeof thread === "string" && typeof namespace === "string" ? this.tasks.get(taskKey(thread, namespace)) : undefined;
    if (task === undefined) throw new Error(`Desktop lane ${lane} was taken outside a task of the loop's graphs.`);
    task.lane = lane;
    this.busy.set(lane, { thread: task.thread, node: task.node, subject: task.subject });
    this.refresh();
  }
}
