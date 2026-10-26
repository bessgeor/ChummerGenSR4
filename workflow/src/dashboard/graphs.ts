import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { StateSnapshot } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { Edge, Node } from "@langchain/core/runnables/graph";
import { frameNodes, taskStage } from "./stages.js";
import type { GraphKind, StageId, TaskView } from "./snapshot.js";

type Drawable = { getGraphAsync(config: RunnableConfig & { xray?: boolean }): Promise<{ nodes: Record<string, Node>; edges: Edge[]; drawMermaid(): string }> };

/** What the dashboard needs of a compiled graph: its drawing, its stage subgraphs and a thread's state. It never invokes one. */
export type InspectableGraph = Drawable & {
  getState(config: { configurable: Record<string, unknown> }, options?: { subgraphs?: boolean }): Promise<StateSnapshot>;
  getSubgraphsAsync(): AsyncGenerator<[string, Drawable]>;
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
  private members: Promise<Partial<Record<StageId, string[]>>> | undefined;

  constructor(readonly source: GraphSource) {
    // A graph that has not run has no checkpoint file; opening one would create it, so its threads are simply none. The saver's
    // setup only creates tables that the file's writer already created, and the dashboard calls no method of the saver that writes.
    this.database = existsSync(source.checkpoints) ? new Database(source.checkpoints, { fileMustExist: true }) : null;
    if (this.database !== null) this.database.pragma("busy_timeout = 5000");
    this.saver = this.database === null ? undefined : new SqliteSaver(this.database);
    this.graph = source.compile(this.saver);
  }

  /** LangGraph's own drawing of the compiled graph with its subgraphs drawn inside it (`xray`): each stage subgraph is a Mermaid subgraph. */
  async drawing(): Promise<string> {
    return (await this.graph.getGraphAsync({ xray: true })).drawMermaid();
  }

  /** The node names of the compiled graph, without LangGraph's start and end. */
  async nodes(): Promise<string[]> {
    return Object.keys((await this.graph.getGraphAsync({})).nodes).filter((node) => !frameNodes.includes(node));
  }

  /** The graph's nodes by stage, as `<graph>:<node>`: a stage subgraph's own nodes, or the graph's nodes when the whole graph is one stage. */
  stageNodes(): Promise<Partial<Record<StageId, string[]>>> {
    this.members ??= this.readStageNodes();
    return this.members;
  }

  private async readStageNodes(): Promise<Partial<Record<StageId, string[]>>> {
    const members: Partial<Record<StageId, string[]>> = {};
    const add = (stage: StageId | null, nodes: readonly string[]) => {
      if (stage !== null) members[stage] = [...(members[stage] ?? []), ...nodes.map((node) => `${this.source.kind}:${node}`)];
    };
    const subgraphs = new Map<string, Drawable>();
    for await (const [name, subgraph] of this.graph.getSubgraphsAsync()) subgraphs.set(name, subgraph);
    for (const node of await this.nodes()) {
      const subgraph = subgraphs.get(node);
      if (subgraph === undefined) add(taskStage(this.source.kind, [], node), [node]);
      else add(taskStage(this.source.kind, [node], node), Object.keys((await subgraph.getGraphAsync({})).nodes).filter((inner) => !frameNodes.includes(inner)));
    }
    return members;
  }

  /** The threads with the most recent checkpoints, newest first. */
  recentThreads(limit: number): string[] {
    if (this.database === null) return [];
    const rows = this.database.prepare(`SELECT thread_id, MAX(checkpoint_id) AS latest FROM checkpoints WHERE checkpoint_ns = ''
      GROUP BY thread_id ORDER BY latest DESC LIMIT ?`).all(limit) as { thread_id: string }[];
    return rows.map((row) => row.thread_id);
  }

  /**
   * The thread's tasks of its next step that have not finished: running, or paused at an interrupt. A task that runs a
   * subgraph, such as a stage, stands for that subgraph's own open tasks, read from the subgraph's state in its namespace.
   * A pushed task's subject comes from the send its path points at in that checkpoint's pending sends.
   */
  async openTasks(thread: string): Promise<TaskView[]> {
    if (this.saver === undefined) return [];
    return this.open(thread, await this.graph.getState({ configurable: { thread_id: thread } }, { subgraphs: true }), []);
  }

  private async open(thread: string, snapshot: StateSnapshot, path: readonly string[]): Promise<TaskView[]> {
    if (snapshot.tasks.length === 0) return [];
    const tuple = await this.saver!.getTuple(snapshot.config);
    const sends = (tuple?.checkpoint.channel_values as Record<string, unknown> | undefined)?.["__pregel_tasks"];
    const since = snapshot.createdAt ?? new Date(0).toISOString();
    const tasks: TaskView[] = [];
    for (const task of snapshot.tasks) {
      if (task.result !== undefined || task.error !== undefined) continue;
      if (task.state !== undefined && "tasks" in task.state) {
        tasks.push(...await this.open(thread, task.state, [...path, task.name]));
        continue;
      }
      const at = task.path ?? [];
      const send = at[0] === "__pregel_push" && typeof at[1] === "number" && Array.isArray(sends) ? (sends[at[1]] as { args?: unknown } | undefined) : undefined;
      tasks.push({
        graph: this.source.kind, thread, path, node: task.name, stage: taskStage(this.source.kind, path, task.name),
        subject: sendSubject(send?.args), lane: null, sinceUtc: since, state: task.interrupts.length > 0 ? "paused" : "running",
      });
    }
    return tasks;
  }

  close(): void {
    this.database?.close();
  }
}
