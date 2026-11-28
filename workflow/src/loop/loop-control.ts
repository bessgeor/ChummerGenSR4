// The control file of a loop, `out/loop/<loop>/control.json`, which pauses the loop or single desktop lanes, and the
// pause of the graphs a loop runs: their nodes interrupt on entry while the loop is paused and are resumed once it is not.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { Command, interrupt, isInterrupted, type LangGraphRunnableConfig } from "@langchain/langgraph";
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

/**
 * Invokes a graph as a graph of its own, never as a subgraph of the graph whose node invokes it: it keeps its own
 * checkpointer and thread, and its interrupts end its own invocation instead of the caller's node.
 */
export function invokeAlone<G extends Invocable>(graph: G, input: unknown, config: InvokeConfig): ReturnType<G["invoke"]> {
  return AsyncLocalStorageProviderSingleton.getInstance().run(undefined as never, () => graph.invoke(input as never, config as never)) as ReturnType<G["invoke"]>;
}

/**
 * Invokes a graph a loop may pause. With a gate, its nodes see the loop's control file, and each time the graph stops
 * at their pause interrupts it waits until the loop is unpaused (see `waitWhilePaused`) and invokes it again from its
 * checkpoint with `Command({ resume: true })`, which runs the interrupted tasks from their start. Tasks that finished
 * beside the interrupted ones keep their writes. Without a gate the graph is invoked as it is and never pauses.
 */
export async function invokePausable<G extends Invocable>(graph: G, input: unknown, config: InvokeConfig, gate: PauseGate | null,
  label: string): Promise<Awaited<ReturnType<G["invoke"]>>> {
  if (gate === null) return invokeAlone(graph, input, config) as Promise<Awaited<ReturnType<G["invoke"]>>>;
  const configured: InvokeConfig = { ...config, configurable: { ...config.configurable, [loopControlKey]: gate.folder } };
  let result = await invokeAlone(graph, input, configured);
  while (isInterrupted(result)) {
    const interrupts = result.__interrupt__ as readonly { value?: unknown }[];
    if (!interrupts.every((item) => (item.value as Partial<PauseInterrupt> | undefined)?.paused === true)) {
      throw new SetupError(`${label} stopped at an interrupt that is not a pause: ${JSON.stringify(interrupts.map((item) => item.value))}.`);
    }
    await waitWhilePaused(gate, label, config.signal);
    result = await invokeAlone(graph, new Command({ resume: true }), configured);
  }
  return result as Awaited<ReturnType<G["invoke"]>>;
}
