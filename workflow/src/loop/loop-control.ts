// The control file of a loop, `out/loop/<loop>/control.json`, which pauses the loop or single desktop lanes, and the
// pause of the graphs a loop runs: their nodes interrupt on entry while the loop is paused and are resumed once it is not.
// Also the schemas of the files a loop writes for readers, `state.json` and `activity.jsonl`, and the observer that a
// loop's graphs, their nodes and its desktop lanes report to.
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { Command, interrupt, isGraphBubbleUp, isInterrupted, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import { delay } from "../host/desktop-lane.js";
import { renameWithRetry } from "../host/rename-with-retry.js";
import { SetupError } from "../host/setup-error.js";

/** `control.json`: whether the loop is paused, and each desktop lane that has a flag. */
export const LoopControlSchema = z.strictObject({
  paused: z.boolean(),
  lanes: z.record(z.string().min(1), z.strictObject({ paused: z.boolean() })),
  updatedUtc: z.iso.datetime(),
});
export type LoopControl = z.infer<typeof LoopControlSchema>;

/** `paused.json` in an agent lane's folder, beside its agent's heartbeat: the lane's flag for a reader of the folder. */
export const LanePausedSchema = z.strictObject({ paused: z.boolean(), updatedUtc: z.iso.datetime() });
export type LanePaused = z.infer<typeof LanePausedSchema>;

/** The graphs a loop runs: its own, and the workflow, discovery and tuning graphs of its threads. */
export const graphKinds = ["loop", "workflow", "discovery", "tuning"] as const;
export type GraphKind = (typeof graphKinds)[number];

/** The task that holds a desktop lane: its graph's thread, its node, and the case, cluster or job it works on. */
export const LaneTaskSchema = z.strictObject({ thread: z.string().min(1), node: z.string().min(1), subject: z.string().min(1).nullable() });
export type LaneTask = z.infer<typeof LaneTaskSchema>;

/**
 * `state.json`: `paused` once every graph the loop runs stopped at its pause, `pausing` while the loop is paused and a
 * task still runs, and each desktop lane of the profile with its flag and the task that holds it (null when free).
 */
export const LoopStateSchema = z.strictObject({
  paused: z.boolean(),
  pausing: z.boolean(),
  lanes: z.record(z.string().min(1), z.strictObject({ paused: z.boolean(), busy: LaneTaskSchema.nullable() })),
  updatedUtc: z.iso.datetime(),
});
export type LoopState = z.infer<typeof LoopStateSchema>;

export const taskStatuses = ["succeeded", "failed", "interrupted"] as const;

/**
 * A line of `activity.jsonl`: a finished task of a graph the loop runs. `stage` is the stage the task belongs to (the
 * first segment of its namespace, or the task's own node at the top of its graph), `namespace` the checkpoint namespace
 * its graph checkpoints it in (empty at the top), `subject` the case, cluster or job it worked on, `lane` the desktop
 * lane it held (the one it took last when it took several, as a task whose commands run side by side can), and
 * `pausedMs` the time the loop was paused while it ran.
 */
export const ActivityLineSchema = z.strictObject({
  thread: z.string().min(1),
  graph: z.enum(graphKinds),
  stage: z.string().min(1),
  namespace: z.string(),
  node: z.string().min(1),
  subject: z.string().min(1).nullable(),
  lane: z.string().min(1).nullable(),
  startedUtc: z.iso.datetime(),
  finishedUtc: z.iso.datetime(),
  pausedMs: z.number().int().nonnegative(),
  status: z.enum(taskStatuses),
});
export type ActivityLine = z.infer<typeof ActivityLineSchema>;

/**
 * A thread a loop ran, in `loop.json`: its graph, when it started and ended (null until it finished), and why it started.
 * A thread is listed once its graph is invoked.
 */
export const LoopThreadSchema = z.strictObject({
  thread: z.string().min(1),
  graph: z.enum(["workflow", "discovery", "tuning"]),
  startedUtc: z.iso.datetime(),
  endedUtc: z.iso.datetime().nullable(),
  reason: z.string().min(1),
});
export type LoopThread = z.infer<typeof LoopThreadSchema>;

/** What a loop without a control file controls: nothing is paused. */
export const nothingPaused: Omit<LoopControl, "updatedUtc"> & { readonly updatedUtc: null } = { paused: false, lanes: {}, updatedUtc: null };

export type ControlState = LoopControl | typeof nothingPaused;

export function controlPath(loopFolder: string): string {
  return join(loopFolder, "control.json");
}

export function lanePausedPath(agentFolder: string): string {
  return join(agentFolder, "paused.json");
}

/** Error codes Windows gives while a writer renames the file into place. */
const transient = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** The file's text, or null when it does not exist; a read that meets a rename in progress is tried again. */
function readText(path: string): string | null {
  for (let attempt = 1; ; attempt++) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      if (attempt >= 8 || code === undefined || !transient.has(code)) throw new SetupError(`${path} cannot be read: ${(error as Error).message}`);
      sleepSync(25 * attempt);
    }
  }
}

/** The loop's control file; a missing file is nothing paused, and one that does not match its schema is a setup error that names it. */
export function readControl(loopFolder: string): ControlState {
  const path = controlPath(loopFolder);
  const text = readText(path);
  if (text === null) return nothingPaused;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new SetupError(`The loop's control file ${path} is not JSON: ${(error as Error).message}`);
  }
  const parsed = LoopControlSchema.safeParse(document);
  if (!parsed.success) throw new SetupError(`The loop's control file ${path} does not match its schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Writes `value` to `path` through a temporary file of its own, renamed into place: a reader sees the earlier file or this one, never a part. */
function writeAtomically(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameWithRetry(temporary, path);
}

/** Writes the loop's control file atomically; every writer, the loop's own commands and any other tool, writes it this way. A change of one flag goes through `setPaused`. */
export function writeControl(loopFolder: string, control: LoopControl): void {
  mkdirSync(loopFolder, { recursive: true });
  writeAtomically(controlPath(loopFolder), LoopControlSchema.parse(control));
}

export function controlLockPath(loopFolder: string): string {
  return `${controlPath(loopFolder)}.lock`;
}

/** How long a change of a flag waits for another writer's lock; a change holds it for one read and one write. */
const lockWaitMilliseconds = 5000;

/**
 * Runs `change` while holding `control.json.lock`, created exclusively, so that no other change reads the control file
 * between its read and its write. A lock that stays, such as one a stopped writer left behind, is a setup error.
 */
function withControlLock<T>(loopFolder: string, change: () => T): T {
  mkdirSync(loopFolder, { recursive: true });
  const path = controlLockPath(loopFolder);
  const deadline = Date.now() + lockWaitMilliseconds;
  for (;;) {
    try {
      writeFileSync(path, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows reports a lock that is being removed as a transient error rather than as existing.
      if (code !== "EEXIST" && (code === undefined || !transient.has(code))) throw new SetupError(`${path} cannot be created: ${(error as Error).message}`);
      if (Date.now() >= deadline) {
        throw new SetupError(`The loop's control file was not changed: ${path} was not released in ${lockWaitMilliseconds / 1000} s. Delete it if no command is changing the control file.`);
      }
      sleepSync(25);
    }
  }
  try {
    return change();
  } finally {
    rmSync(path, { force: true });
  }
}

/**
 * Sets the loop's flag (`lane` null) or a lane's, keeps every other flag, also one another change sets at the same time,
 * and returns the control file written.
 */
export function setPaused(loopFolder: string, lane: string | null, paused: boolean, now: Date): LoopControl {
  return withControlLock(loopFolder, () => {
    const current = readControl(loopFolder);
    const control: LoopControl = lane === null
      ? { paused, lanes: { ...current.lanes }, updatedUtc: now.toISOString() }
      : { paused: current.paused, lanes: { ...current.lanes, [lane]: { paused } }, updatedUtc: now.toISOString() };
    writeControl(loopFolder, control);
    return control;
  });
}

/** Whether the control file marks the lane paused; the loop's own flag does not pause a lane. */
export function lanePaused(control: ControlState, lane: string): boolean {
  return control.lanes[lane]?.paused === true;
}

/** Writes an agent lane's `paused.json` atomically. */
export function writeLanePaused(agentFolder: string, paused: boolean, now: Date): void {
  mkdirSync(agentFolder, { recursive: true });
  writeAtomically(lanePausedPath(agentFolder), LanePausedSchema.parse({ paused, updatedUtc: now.toISOString() }));
}

export function statePath(loopFolder: string): string {
  return join(loopFolder, "state.json");
}

export function activityPath(loopFolder: string): string {
  return join(loopFolder, "activity.jsonl");
}

/** Writes the loop's `state.json` atomically. */
export function writeLoopState(loopFolder: string, state: LoopState): void {
  mkdirSync(loopFolder, { recursive: true });
  writeAtomically(statePath(loopFolder), LoopStateSchema.parse(state));
}

/**
 * Appends a line to the loop's `activity.jsonl`; a reader skips a last line that does not end with a newline yet. A
 * reader reads the loop's files at once and does not keep them open: `state.json` is replaced by a rename.
 */
export function appendActivity(loopFolder: string, line: ActivityLine): void {
  mkdirSync(loopFolder, { recursive: true });
  appendFileSync(activityPath(loopFolder), `${JSON.stringify(ActivityLineSchema.parse(line))}\n`);
}

function parsed<T>(path: string, text: string, schema: z.ZodType<T>): T {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new SetupError(`${path} is not JSON: ${(error as Error).message}`);
  }
  const result = schema.safeParse(document);
  if (!result.success) throw new SetupError(`${path} does not match its schema: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** The loop's `state.json`, or null before the loop wrote it; one that does not match its schema is a setup error. */
export function readLoopState(loopFolder: string): LoopState | null {
  const path = statePath(loopFolder);
  const text = readText(path);
  return text === null ? null : parsed(path, text, LoopStateSchema);
}

/** The finished lines of the loop's `activity.jsonl`, none before the loop wrote one; a line that does not match its schema is a setup error. */
export function readActivity(loopFolder: string): ActivityLine[] {
  const path = activityPath(loopFolder);
  const text = readText(path) ?? "";
  // The last line is complete only once its newline is written.
  return text.split("\n").slice(0, -1).map((line, index) => parsed(`${path}, line ${index + 1}`, line, ActivityLineSchema));
}

/** A task's start, as LangGraph's `tasks` stream gives it. */
export type TaskStart = { readonly id: string; readonly name: string; readonly input: unknown };
/** A task's result, as LangGraph's `tasks` stream gives it; a task that stopped at an interrupt has its interrupts. */
export type TaskResult = { readonly id: string; readonly name: string; readonly interrupts: readonly unknown[] };

/**
 * What a loop learns while it runs its graphs: each graph invocation and its pauses, the tasks of its `tasks` stream
 * (with the namespace of the subgraph that runs them), the tasks that ran or failed (by the thread and checkpoint
 * namespace of the task, from their runs), and the desktop lane a task takes and gives back.
 */
export interface LoopObserver {
  /** A graph's thread starts or resumes; `reason` says why a thread the loop starts started (null for the loop's own graph). */
  threadStarted(graph: GraphKind, thread: string, reason: string | null): void;
  taskStarted(graph: GraphKind, thread: string, namespace: readonly string[], task: TaskStart): void;
  taskFinished(graph: GraphKind, thread: string, namespace: readonly string[], task: TaskResult): void;
  /** The task ran, also when it stopped at an interrupt; a task restored from its checkpoint does not. */
  taskEntered(thread: string, checkpointNamespace: string): void;
  /** The task failed with an error that is not an interrupt: of its node, its routers or a subgraph it runs. */
  taskFailed(thread: string, checkpointNamespace: string): void;
  /** The graph's invocation stopped at its pauses and waits for the unpause (`waiting`), or goes on. */
  pauseChanged(graph: GraphKind, thread: string, waiting: boolean): void;
  /** The graph's invocation ended: its thread `finished`, or it stopped with an error and stays resumable. */
  threadStopped(graph: GraphKind, thread: string, finished: boolean): void;
  /** A desktop command of the running task took (`held`) or gave back the lane. */
  laneHeld(lane: string, held: boolean): void;
}

const observers = new Map<string, LoopObserver>();

/** Windows compares paths without regard to case. */
const observerKey = (loopFolder: string) => (process.platform === "win32" ? resolve(loopFolder).toLowerCase() : resolve(loopFolder));

/** Makes `observer` the observer of the loop in `loopFolder` until the returned function is called; a loop has one. */
export function observeLoop(loopFolder: string, observer: LoopObserver): () => void {
  const key = observerKey(loopFolder);
  if (observers.has(key)) throw new Error(`The loop in ${loopFolder} is observed already.`);
  observers.set(key, observer);
  return () => {
    if (observers.get(key) === observer) observers.delete(key);
  };
}

/** The observer of the loop in `loopFolder`, or null when nothing observes it. */
export function loopObserver(loopFolder: string): LoopObserver | null {
  return observers.get(observerKey(loopFolder)) ?? null;
}

/** The key of a graph invocation's `configurable` that names the loop folder whose control file pauses its nodes. */
export const loopControlKey = "loopControl";

/** The value of the interrupt a paused node raises. */
export type PauseInterrupt = { readonly paused: true };

/** The loop folder named by the invocation's configuration; absent outside a loop. */
export function loopFolderOf(config: LangGraphRunnableConfig | undefined): string | null {
  const folder = config?.configurable?.[loopControlKey];
  return typeof folder === "string" ? folder : null;
}

/**
 * A graph node that interrupts on entry, before it does anything, while the loop that runs its graph is paused. The
 * loop is named by `configurable.loopControl`, which a graph a loop does not run lacks: such a node never pauses. A
 * resumed node runs from its start and reads the control file again: what its interrupt returns is ignored, and a loop
 * paused again before the node ran interrupts it again. Once the loop is unpaused it does its work.
 */
export function pausable<S, R>(node: (state: S, config: LangGraphRunnableConfig) => R): (state: S, config: LangGraphRunnableConfig) => R {
  return (state, config) => {
    const folder = loopFolderOf(config);
    // Each call takes the next resume value, if any; the first call without one interrupts.
    if (folder !== null) while (readControl(folder).paused) interrupt({ paused: true } satisfies PauseInterrupt);
    return node(state, config);
  };
}

/**
 * Tells the observer which tasks of a graph ran and which failed, from the runs LangChain reports for them: a task's run
 * is the outermost run with its checkpoint namespace, and it fails with any error of the task, its node's, its
 * routers' or a subgraph's, but not with an interrupt. A task restored from its checkpoint does not run.
 */
class TaskRuns extends BaseCallbackHandler {
  name = "loop-task-runs";
  /** Reported before the error leaves the task, so the task's result is read after its failure is known. */
  override awaitHandlers = true;
  private readonly runs = new Map<string, { readonly thread: string; readonly namespace: string; readonly task: boolean }>();

  constructor(private readonly observer: LoopObserver) {
    super();
  }

  override handleChainStart(_chain: unknown, _inputs: unknown, runId: string, _runType?: string, _tags?: string[], metadata?: Record<string, unknown>,
    _runName?: string, parentRunId?: string): void {
    const thread = metadata?.["thread_id"];
    const namespace = metadata?.["langgraph_checkpoint_ns"];
    if (typeof thread !== "string" || typeof namespace !== "string") return;
    const parent = parentRunId === undefined ? undefined : this.runs.get(parentRunId);
    const task = parent?.namespace !== namespace;
    this.runs.set(runId, { thread, namespace, task });
    if (task) this.observer.taskEntered(thread, namespace);
  }

  override handleChainEnd(_outputs: unknown, runId: string): void {
    this.runs.delete(runId);
  }

  override handleChainError(error: Error, runId: string): void {
    const run = this.runs.get(runId);
    this.runs.delete(runId);
    if (run?.task === true && !isGraphBubbleUp(error)) this.observer.taskFailed(run.thread, run.namespace);
  }
}

/** A pause of a graph, from its interrupt until its resume. */
export type Pause = { readonly startedUtc: string; readonly endedUtc: string; readonly milliseconds: number };

/** How a graph a loop runs waits while the loop is paused. */
export type PauseGate = {
  /** The loop's folder, whose `control.json` pauses the graph's nodes. */
  readonly folder: string;
  readonly log: (line: string) => void;
  /** How often a paused loop's control file is read again; by default every second. */
  readonly pollMilliseconds?: number;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number, signal: AbortSignal | undefined) => Promise<void>;
  /** Learns each pause the graph waited through, also one the signal ended. */
  readonly onPause?: (pause: Pause) => void;
  /** Why the loop runs the graph's thread, recorded in `loop.json`; every thread but the loop's own has one. */
  readonly reason?: string;
};

/**
 * Waits until the loop's control file no longer says the loop is paused. A wait that took place, ended by the unpause or
 * by the signal, is reported to the gate's `onPause`; a clock set back during it gives a pause of no time.
 */
export async function waitWhilePaused(gate: PauseGate, label: string, signal?: AbortSignal): Promise<void> {
  const now = gate.now ?? (() => new Date());
  const sleep = gate.sleep ?? delay;
  const started = now();
  const report = () => {
    const ended = now();
    gate.onPause?.({ startedUtc: started.toISOString(), endedUtc: ended.toISOString(), milliseconds: Math.max(0, ended.getTime() - started.getTime()) });
  };
  let waited = false;
  while (readControl(gate.folder).paused) {
    if (!waited) gate.log(`${label} is paused; it goes on once the loop is unpaused (npm run loop -- --unpause).`);
    waited = true;
    try {
      await sleep(gate.pollMilliseconds ?? 1000, signal);
    } catch (error) {
      report();
      throw error;
    }
  }
  if (!waited) return;
  report();
  gate.log(`${label} goes on: the loop is unpaused.`);
}

/** The configuration of a graph's invocation. */
type InvokeConfig = LangGraphRunnableConfig & { readonly durability?: "sync" | "async" | "exit" };

type Invocable = { invoke(input: never, config?: never): Promise<unknown> };

/** A chunk of a graph's stream with `subgraphs: true`: the namespace of the (sub)graph that gave it, the mode and its payload. */
type StreamChunk = readonly [readonly string[], string, unknown];
type Streamable = { stream(input: never, config?: never): Promise<AsyncIterable<StreamChunk>> };

/**
 * Invokes a graph as a graph of its own, never as a subgraph of the graph whose node invokes it: it keeps its own
 * checkpointer and thread, and its interrupts end its own invocation instead of the caller's node.
 */
export function invokeAlone<G extends Invocable>(graph: G, input: unknown, config: InvokeConfig): ReturnType<G["invoke"]> {
  return AsyncLocalStorageProviderSingleton.getInstance().run(undefined as never, () => graph.invoke(input as never, config as never)) as ReturnType<G["invoke"]>;
}

const interruptKey = "__interrupt__";

/**
 * Invokes a graph as `invokeAlone` does, streamed with the `tasks` and `values` modes of it and its subgraphs: each task
 * start and result goes to `observe`, and the result is what `invoke` returns, the last state of the graph itself with
 * the interrupts it stopped at, if any.
 */
function streamAlone(graph: Invocable, input: unknown, config: InvokeConfig,
  observe: (namespace: readonly string[], payload: TaskStart | TaskResult, started: boolean) => void): Promise<unknown> {
  return AsyncLocalStorageProviderSingleton.getInstance().run(undefined as never, async () => {
    const stream = await (graph as unknown as Streamable).stream(input as never, { ...config, streamMode: ["tasks", "values"], subgraphs: true } as never);
    let latest: unknown;
    const interrupts: unknown[] = [];
    for await (const [namespace, mode, payload] of stream) {
      if (mode === "tasks") {
        const task = payload as Record<string, unknown>;
        // A start names the task's triggers, a result does not.
        observe(namespace, "triggers" in task ? { id: String(task["id"]), name: String(task["name"]), input: task["input"] }
          : { id: String(task["id"]), name: String(task["name"]), interrupts: (task["interrupts"] as unknown[] | undefined) ?? [] }, "triggers" in task);
      } else if (mode === "values" && namespace.length === 0) {
        if (isInterrupted(payload)) interrupts.push(...(payload[interruptKey] as unknown[]));
        else latest = payload;
      }
    }
    if (interrupts.length === 0) return latest;
    return { ...(typeof latest === "object" && latest !== null ? latest : {}), [interruptKey]: interrupts };
  });
}

/**
 * Invokes a graph a loop may pause. With a gate, its nodes see the loop's control file, and each time the graph stops
 * at their pause interrupts it waits until the loop is unpaused (see `waitWhilePaused`) and invokes it again from its
 * checkpoint with `Command({ resume: true })`, which runs the interrupted tasks from their start. Tasks that finished
 * beside the interrupted ones keep their writes. Without a gate the graph is invoked as it is and never pauses. When
 * the loop has an observer, the graph (`kind`) is streamed and the observer learns its thread, tasks and pauses.
 */
export async function invokePausable<G extends Invocable>(graph: G, input: unknown, config: InvokeConfig, gate: PauseGate | null,
  label: string, kind: GraphKind): Promise<Awaited<ReturnType<G["invoke"]>>> {
  if (gate === null) return invokeAlone(graph, input, config) as Promise<Awaited<ReturnType<G["invoke"]>>>;
  const configured: InvokeConfig = { ...config, configurable: { ...config.configurable, [loopControlKey]: gate.folder } };
  const observer = loopObserver(gate.folder);
  const thread = configured.configurable?.["thread_id"];
  if (observer !== null && typeof thread !== "string") throw new Error(`${label} is invoked without a thread ID.`);
  if (observer !== null && configured.callbacks !== undefined && !Array.isArray(configured.callbacks)) throw new Error(`${label} is invoked with a callback manager.`);
  const observed: InvokeConfig = observer === null ? configured
    : { ...configured, callbacks: [...((configured.callbacks as BaseCallbackHandler[] | undefined) ?? []), new TaskRuns(observer)] };
  const run = (value: unknown) => (observer === null ? invokeAlone(graph, value, configured)
    : streamAlone(graph, value, observed, (namespace, task, started) => (started
      ? observer.taskStarted(kind, thread as string, namespace, task as TaskStart)
      : observer.taskFinished(kind, thread as string, namespace, task as TaskResult))));
  observer?.threadStarted(kind, thread as string, gate.reason ?? null);
  let finished = false;
  let failed = false;
  try {
    let result = await run(input);
    while (isInterrupted(result)) {
      const interrupts = result.__interrupt__ as readonly { value?: unknown }[];
      if (!interrupts.every((item) => (item.value as Partial<PauseInterrupt> | undefined)?.paused === true)) {
        throw new SetupError(`${label} stopped at an interrupt that is not a pause: ${JSON.stringify(interrupts.map((item) => item.value))}.`);
      }
      observer?.pauseChanged(kind, thread as string, true);
      let waited = false;
      try {
        await waitWhilePaused(gate, label, config.signal);
        waited = true;
      } finally {
        afterward(!waited, () => observer?.pauseChanged(kind, thread as string, false), gate, label);
      }
      result = await run(new Command({ resume: true }));
    }
    finished = true;
    return result as Awaited<ReturnType<G["invoke"]>>;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    afterward(failed, () => observer?.threadStopped(kind, thread as string, finished), gate, label);
  }
}

/**
 * Tells the observer what happened after a graph's run. Its own failure is thrown, unless the run already failed: then
 * the run's error is the one thrown, and the observer's is logged.
 */
function afterward(runFailed: boolean, tell: () => void, gate: PauseGate, label: string): void {
  try {
    tell();
  } catch (error) {
    if (!runFailed) throw error;
    gate.log(`${label}: the loop's state and activity could not be recorded after its failure: ${(error as Error).message}`);
  }
}
