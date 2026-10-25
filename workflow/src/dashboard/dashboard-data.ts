import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { listRecords, type EvalRecord } from "../evals/eval-record.js";
import type { GraphReader } from "./graphs.js";
import { loopFiles, LoopControlSchema, LoopDocumentSchema, LoopStateSchema, readActivity, readJson, type ActivityLine, type LoopControl, type LoopDocument, type LoopState } from "./loop-documents.js";
import { stageStats, type ThreadFacts } from "./stage-stats.js";
import { stageMembers, stageTitles } from "./stages.js";
import { stageIds, type LaneView, type LoopStatus, type LoopView, type Problem, type Snapshot, type TaskView } from "./snapshot.js";

/** Where the dashboard reads from. */
export type DashboardSources = {
  /** `out/loop/`: one folder per loop. */
  readonly loopRoot: string;
  /** A workflow thread's folder. */
  readonly threadFolder: (threadId: string) => string;
  /** `out/workflow/threads/`: every workflow thread, for the stats without a loop. */
  readonly threadsRoot: string;
  /** `out/evals/tuning/cycles/`: every tuning cycle, for the stats without a loop. */
  readonly tuningCycles: string;
  readonly store: BaseStore;
  readonly graphs: readonly GraphReader[];
  readonly now: () => Date;
};

/** A loop whose state is older than this, and that has not ended, may have lost its driver. */
export const staleStateMs = 30_000;

/** Threads read per graph without a loop: the most recent ones are the only ones that may still run. */
const recentThreads = 5;

/** The parts of a thread's `triage.json` and `outcome.json` the stats use. */
const TriageTotalsSchema = z.object({ totals: z.object({ discrepancies: z.number().int(), clusters: z.number().int(), newClusters: z.number().int() }) });
const OutcomeClustersSchema = z.object({ clusters: z.array(z.object({ disposition: z.string() })) });

function folders(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** The loops with a `loop.json`, newest first: loop IDs are `loop-` and their start time; other folders, such as `graphs/`, are not loops. */
export function listLoops(loopRoot: string): string[] {
  return folders(loopRoot).filter((id) => id.startsWith("loop-") && existsSync(loopFiles(loopRoot, id).loop)).sort().reverse();
}

/** Reads an optional document: null when absent, a problem when present and unreadable. */
function optional<T>(path: string, read: (path: string) => T, problems: Problem[]): T | null {
  if (!existsSync(path)) return null;
  try {
    return read(path);
  } catch (error) {
    problems.push({ source: path, message: (error as Error).message });
    return null;
  }
}

/** The loop as of now: its documents, its status and its lanes. */
export type LoopFacts = {
  readonly view: LoopView;
  readonly document: LoopDocument;
  readonly state: LoopState | null;
  readonly control: LoopControl | null;
  readonly activity: readonly ActivityLine[] | null;
};

export function loopStatus(document: LoopDocument, state: LoopState | null, control: LoopControl | null, stateAgeMs: number | null, running: number): LoopStatus {
  if (document.endedUtc !== null) return "ended";
  if (state === null || stateAgeMs === null || stateAgeMs > staleStateMs) return "stale";
  const paused = control?.paused ?? state.paused;
  if (!paused) return "running";
  return state.pausing || running > 0 ? "pausing" : "paused";
}

function readLoop(sources: DashboardSources, loopId: string, problems: Problem[]): Omit<LoopFacts, "view"> & { stateAgeMs: number | null } | null {
  const files = loopFiles(sources.loopRoot, loopId);
  const document = optional(files.loop, (path) => readJson(path, LoopDocumentSchema), problems);
  if (document === null) {
    if (!existsSync(files.loop)) problems.push({ source: files.loop, message: `There is no loop ${loopId}.` });
    return null;
  }
  const state = optional(files.state, (path) => readJson(path, LoopStateSchema), problems);
  const control = optional(files.control, (path) => readJson(path, LoopControlSchema), problems);
  const activity = optional(files.activity, readActivity, problems) ?? (existsSync(files.activity) ? null : []);
  const stateAgeMs = state === null ? null : sources.now().getTime() - statSync(files.state).mtimeMs;
  return { document, state, control, activity, stateAgeMs };
}

function lanes(state: LoopState | null, control: LoopControl | null): LaneView[] {
  const names = [...new Set([...Object.keys(state?.lanes ?? {}), ...Object.keys(control?.lanes ?? {})])].sort();
  return names.map((name) => ({
    name, paused: control?.lanes[name]?.paused ?? state?.lanes[name]?.paused ?? false, busy: state?.lanes[name]?.busy ?? null,
  }));
}

/** The tasks of each graph's threads that may be running, with the lane a capture runs on. */
async function openTasks(sources: DashboardSources, document: LoopDocument | null, state: LoopState | null, problems: Problem[]): Promise<TaskView[]> {
  const tasks: TaskView[] = [];
  for (const reader of sources.graphs) {
    const threads = document === null
      ? reader.recentThreads(recentThreads)
      : document.threads.filter((thread) => thread.graph === reader.source.kind && thread.endedUtc === null).map((thread) => thread.thread);
    for (const thread of threads) {
      try {
        tasks.push(...await reader.openTasks(thread));
      } catch (error) {
        problems.push({ source: `${reader.source.checkpoints} thread ${thread}`, message: (error as Error).message });
      }
    }
  }
  const laneOf = (task: TaskView): string | null => Object.entries(state?.lanes ?? {})
    .find(([, lane]) => lane.busy !== null && lane.busy.thread === task.thread && lane.busy.node === task.node && lane.busy.subject === task.subject)?.[0] ?? null;
  return tasks.map((task) => ({ ...task, lane: laneOf(task) }));
}

function threadFacts(sources: DashboardSources, threads: readonly string[], problems: Problem[]): { facts: ThreadFacts[]; unreadable: number } {
  let unreadable = 0;
  const facts = threads.map((thread): ThreadFacts => {
    const folder = sources.threadFolder(thread);
    const before = problems.length;
    const triage = optional(join(folder, "triage.json"), (path) => readJson(path, TriageTotalsSchema).totals, problems);
    const outcome = optional(join(folder, "outcome.json"), (path) => readJson(path, OutcomeClustersSchema), problems);
    if (problems.length > before) unreadable++;
    return { thread, triage, dispositions: outcome === null ? null : outcome.clusters.map((cluster) => cluster.disposition) };
  });
  return { facts, unreadable };
}

/** What the page shows: the loop (the newest unless one is named), its live tasks, and each stage's stats. */
export async function takeSnapshot(sources: DashboardSources, requested: string | null): Promise<Snapshot> {
  const problems: Problem[] = [];
  const loops = listLoops(sources.loopRoot);
  const loopId = requested ?? loops[0] ?? null;
  const loop = loopId === null ? null : readLoop(sources, loopId, problems);
  const tasks = await openTasks(sources, loop?.document ?? null, loop?.state ?? null, problems);
  let records: EvalRecord[] = [];
  try {
    records = await listRecords(sources.store);
  } catch (error) {
    problems.push({ source: "eval records", message: (error as Error).message });
  }
  const inLoop = loop === null ? null : new Set(loop.document.threads.map((thread) => thread.thread));
  const workflowThreads = loop === null ? folders(sources.threadsRoot) : loop.document.threads.filter((thread) => thread.graph === "workflow").map((thread) => thread.thread);
  const { facts, unreadable } = threadFacts(sources, workflowThreads, problems);
  const stats = stageStats({
    threads: facts, unreadableThreads: unreadable,
    records: inLoop === null ? records : records.filter((record) => inLoop.has(record.threadId)),
    activity: loop === null ? null : loop.activity,
    tunings: loop === null ? folders(sources.tuningCycles).length : loop.document.threads.filter((thread) => thread.graph === "tuning").length,
  });
  const running = tasks.filter((task) => task.state === "running").length;
  const view: LoopView | null = loop === null || loopId === null ? null : {
    id: loopId, status: loopStatus(loop.document, loop.state, loop.control, loop.stateAgeMs, running),
    startedUtc: loop.document.startedUtc, endedUtc: loop.document.endedUtc, stateAgeMs: loop.stateAgeMs,
    paused: loop.control?.paused ?? loop.state?.paused ?? false, lanes: lanes(loop.state, loop.control), threads: loop.document.threads,
  };
  return {
    generatedUtc: sources.now().toISOString(), loops, loop: view, live: view !== null && view.status !== "stale" && view.status !== "ended",
    stages: stageIds.map((id) => ({
      id, title: stageTitles[id], nodes: stageMembers(id),
      running: tasks.filter((task) => task.stage === id && task.state === "running").length,
      paused: tasks.filter((task) => task.stage === id && task.state === "paused").length,
      stats: stats[id],
    })),
    tasks, problems,
  };
}
