import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { StateSnapshot } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { groupByStage, nodeStage } from "./stages.js";
import type { GraphKind, TaskView } from "./snapshot.js";

/** What the dashboard needs of a compiled graph: its drawing and a thread's state. It never invokes one. */
export type InspectableGraph = {
  getState(config: { configurable: { thread_id: string } }): Promise<StateSnapshot>;
  getGraphAsync(): Promise<{ drawMermaid(): string; nodes: Record<string, unknown> }>;
};

/** A graph of the loop: its builder, compiled with inert steps, and its checkpoint file. */
export type GraphSource = {
  readonly kind: GraphKind;
  readonly checkpoints: string;
  readonly compile: (checkpointer: SqliteSaver | undefined) => InspectableGraph;
};

/** A send's arguments: the graph's state plus the task's own field. */
type SendArguments = { clusterId?: unknown; targetId?: unknown; index?: unknown; plan?: unknown };

/** The case, cluster or discovery target a pushed task works on, from the arguments of its send. */
export function sendSubject(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const { clusterId, targetId, index, plan } = args as SendArguments;
  if (typeof clusterId === "string") return clusterId;
  if (typeof targetId === "string") return targetId;
  if (typeof index === "number" && Array.isArray(plan)) {
    const item = plan[index] as { name?: unknown } | undefined;
    if (typeof item?.name === "string") return item.name;
  }
  return null;
}

/** A graph opened on its checkpoint file for reading: the compiled graph, the saver and the database under it. */
export class GraphReader {
  private readonly database: Database.Database | null;
  private readonly saver: SqliteSaver | undefined;
  readonly graph: InspectableGraph;

  constructor(readonly source: GraphSource) {
    // A graph that has not run has no checkpoint file; opening one would create it, so its threads are simply none. The saver's
    // setup only creates tables that the file's writer already created, and the dashboard calls no method of the saver that writes.
    this.database = existsSync(source.checkpoints) ? new Database(source.checkpoints, { fileMustExist: true }) : null;
    if (this.database !== null) this.database.pragma("busy_timeout = 5000");
    this.saver = this.database === null ? undefined : new SqliteSaver(this.database);
    this.graph = source.compile(this.saver);
  }

  /** LangGraph's own drawing of the compiled graph, its nodes grouped by stage. */
  async drawing(): Promise<string> {
    return groupByStage(this.source.kind, (await this.graph.getGraphAsync()).drawMermaid());
  }

  /** The node names of the compiled graph, without LangGraph's start and end. */
  async nodes(): Promise<string[]> {
    return Object.keys((await this.graph.getGraphAsync()).nodes).filter((node) => node !== "__start__" && node !== "__end__");
  }

  /** The threads with the most recent checkpoints, newest first. */
  recentThreads(limit: number): string[] {
    if (this.database === null) return [];
    const rows = this.database.prepare(`SELECT thread_id, MAX(checkpoint_id) AS latest FROM checkpoints WHERE checkpoint_ns = ''
      GROUP BY thread_id ORDER BY latest DESC LIMIT ?`).all(limit) as { thread_id: string }[];
    return rows.map((row) => row.thread_id);
  }

  /**
   * The thread's tasks of its next step that have not finished: running, or paused at an interrupt. A pushed task's
   * subject comes from the send its path points at in the checkpoint's pending sends.
   */
  async openTasks(thread: string): Promise<TaskView[]> {
    if (this.saver === undefined) return [];
    const config = { configurable: { thread_id: thread } };
    const snapshot = await this.graph.getState(config);
    if (snapshot.tasks.length === 0) return [];
    const tuple = await this.saver.getTuple(config);
    const sends = (tuple?.checkpoint.channel_values as Record<string, unknown> | undefined)?.["__pregel_tasks"];
    const since = snapshot.createdAt ?? new Date(0).toISOString();
    return snapshot.tasks.flatMap((task): TaskView[] => {
      if (task.result !== undefined || task.error !== undefined) return [];
      const path = task.path ?? [];
      const send = path[0] === "__pregel_push" && typeof path[1] === "number" && Array.isArray(sends) ? (sends[path[1]] as { args?: unknown } | undefined) : undefined;
      return [{
        graph: this.source.kind, thread, node: task.name, stage: nodeStage(this.source.kind, task.name),
        subject: sendSubject(send?.args), lane: null, sinceUtc: since, state: task.interrupts.length > 0 ? "paused" : "running",
      }];
    });
  }

  close(): void {
    this.database?.close();
  }
}
