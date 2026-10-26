// Shared by the server and the React client.
import { stageIds, type GraphKind, type StageId } from "./snapshot.js";

export const stageTitles: Readonly<Record<StageId, string>> = {
  start: "Start thread",
  capture: "Capture and compare",
  discovery: "Discovery",
  diagnose: "Diagnose each cluster",
  repair: "Repair tries",
  widen: "Widen best passing try",
  conclude: "Conclude",
  tune: "Tune",
};

/** The stage a graph's tasks belong to when no stage subgraph runs them: the discovery and tuning graphs are each one stage. */
const graphStage: Readonly<Record<GraphKind, StageId | null>> = { loop: null, workflow: null, discovery: "discovery", tuning: "tune" };

/** The nodes LangGraph adds to every graph. */
export const frameNodes: readonly string[] = ["__start__", "__end__"];

function isStage(name: string): name is StageId {
  return (stageIds as readonly string[]).includes(name);
}

/**
 * The stage of a task: the outermost stage subgraph on its path (the nodes of the parent graphs that run it, outermost
 * first), else the stage its whole graph is (so the discovery graph's own `conclude` is discovery), else its own node
 * when that is a stage subgraph.
 */
export function taskStage(graph: GraphKind, path: readonly string[], node: string): StageId | null {
  return path.find(isStage) ?? graphStage[graph] ?? (isStage(node) ? node : null);
}

/** Nodes that route, prepare or finish a stage: they take no time of their own, so durations leave them out. */
export function isRoutingNode(node: string): boolean {
  return /^(route|prepare|finish)_/.test(node);
}

/**
 * The Mermaid IDs a task's node may have in LangGraph's xray drawing, best first. LangGraph names a subgraph's node
 * `<subgraph>:<node>` and replaces every character but letters, digits and underscores; it draws a subgraph of a single
 * node as that subgraph's own node, so the path's outer nodes follow.
 */
export function drawnIds(path: readonly string[], node: string): string[] {
  const names = [...path, node];
  return names.map((_, index) => names.slice(0, names.length - index).join(":").replace(/[^a-zA-Z0-9_]/g, "_"));
}
