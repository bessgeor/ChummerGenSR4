import type { GraphKind, StageId } from "./snapshot.js";

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

/** Each graph's nodes by stage; every node of a compiled graph must be listed exactly once (the graph tests check it). */
const stageNodes: Readonly<Record<GraphKind, Partial<Record<StageId, readonly string[]>>>> = {
  loop: {},
  workflow: {
    start: ["build"],
    capture: ["capture", "compare", "route_cases", "triage", "inventory"],
    diagnose: ["prepare_diagnosis", "route_diagnosis", "hypothesize", "challenge", "wait_for_quota", "check", "finish_diagnosis"],
    repair: ["prepare_repair", "route_repair", "repair", "wait_for_repair_quota", "finish_repair", "retry_repair"],
    widen: ["prepare_widening", "route_widening", "widen", "promote", "roll_back", "finish_widening"],
    conclude: ["conclude"],
  },
  discovery: {
    discovery: ["prepare", "route_rank", "rank", "wait_for_rank_quota", "select", "route_scenarios", "scenario", "wait_for_scenario_quota", "validate", "execute", "register", "conclude"],
  },
  tuning: {},
};

/** The nodes LangGraph adds to every graph. */
export const frameNodes: readonly string[] = ["__start__", "__end__"];

/** The stage a graph's node belongs to, or null for a node the map does not know. */
export function nodeStage(graph: GraphKind, node: string): StageId | null {
  for (const [stage, nodes] of Object.entries(stageNodes[graph]) as [StageId, readonly string[]][]) {
    if (nodes.includes(node)) return stage;
  }
  return null;
}

/** Every `<graph>:<node>` of a stage, in the map's order. */
export function stageMembers(stage: StageId): string[] {
  return (Object.entries(stageNodes) as [GraphKind, Partial<Record<StageId, readonly string[]>>][]).flatMap(([graph, stages]) => (stages[stage] ?? []).map((node) => `${graph}:${node}`));
}

/** Nodes that route, prepare or finish a stage: they take no time of their own, so durations leave them out. */
export function isRoutingNode(node: string): boolean {
  return /^(route|prepare|finish)_/.test(node) || node === "route_cases";
}

/** Matches a node's declaration in LangGraph's Mermaid drawing: a tab, the node's ID, then its shape. */
const declaration = /^\t([A-Za-z0-9_]+)[([]/;

/**
 * Groups LangGraph's Mermaid drawing of a graph into one subgraph per stage, in the order of the loop, so the
 * drawing follows the loop's stages. Only the node declarations move; LangGraph's nodes, edges and styles stay as drawn.
 */
export function groupByStage(graph: GraphKind, drawing: string): string {
  const lines = drawing.split("\n");
  const firstDeclaration = lines.findIndex((line) => declaration.test(line));
  if (firstDeclaration < 0) return drawing;
  const grouped = new Map<StageId, string[]>();
  const rest: string[] = [];
  const kept: string[] = [];
  for (const [index, line] of lines.entries()) {
    const node = index >= firstDeclaration ? declaration.exec(line)?.[1] : undefined;
    const stage = node === undefined ? null : nodeStage(graph, node);
    if (node !== undefined && stage !== null) grouped.set(stage, [...(grouped.get(stage) ?? []), line]);
    else if (node !== undefined) rest.push(line);
    else if (index >= firstDeclaration) kept.push(line);
  }
  const subgraphs = (Object.keys(stageTitles) as StageId[]).flatMap((stage) => {
    const members = grouped.get(stage);
    return members === undefined ? [] : [`\tsubgraph stage_${stage}["${stageTitles[stage]}"]`, ...members.map((line) => `\t${line}`), "\tend"];
  });
  return [...lines.slice(0, firstDeclaration), ...rest, ...subgraphs, ...kept].join("\n");
}
