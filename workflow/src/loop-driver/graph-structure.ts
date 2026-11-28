// The structure of the four graphs a loop runs, drawn by LangGraph from graphs compiled over steps that do nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDiscoveryGraph } from "../discovery/discovery-graph.js";
import { buildWorkflowGraph } from "../graph/workflow-graph.js";
import { renameWithRetry } from "../host/rename-with-retry.js";
import type { GraphKind } from "../loop/loop-control.js";
import { buildTuningGraph } from "../tuning/tuning-graph.js";
import { buildLoopGraph } from "./loop-graph.js";

/**
 * Steps that do nothing: the builders only keep them for their nodes, so a graph compiled over them can be drawn and
 * read, and any use of one when a node runs is an error.
 */
function inert<T>(name: string): T {
  return new Proxy({}, {
    get: (_target, key) => {
      throw new Error(`The ${name} steps of a graph compiled for its structure were used (${String(key)}).`);
    },
  }) as T;
}

/** The four graphs compiled over inert steps, without a checkpointer. */
export function structureGraphs() {
  return {
    loop: buildLoopGraph(inert("loop")).compile(),
    workflow: buildWorkflowGraph(inert("workflow"), inert("diagnosis"), inert("repair"), inert("widening"), inert("conclude"), inert("discovery")).compile(),
    discovery: buildDiscoveryGraph(inert("discovery")).compile(),
    tuning: buildTuningGraph(inert("tuning")).compile(),
  } satisfies Record<GraphKind, unknown>;
}

function writeText(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameWithRetry(temporary, path);
}

/**
 * Writes `<graph>.json` (LangGraph's JSON drawing: nodes and edges) and `<graph>.mmd` (its Mermaid drawing) for the
 * loop, workflow, discovery and tuning graphs into `folder`, replacing earlier ones. Subgraphs are drawn with their
 * nodes, so the workflow graph's stages show theirs as `<stage>:<node>`.
 */
export async function writeGraphStructures(folder: string): Promise<void> {
  mkdirSync(folder, { recursive: true });
  for (const [name, graph] of Object.entries(structureGraphs())) {
    const drawn = await graph.getGraphAsync({ xray: true });
    writeText(join(folder, `${name}.json`), `${JSON.stringify(drawn.toJSON(), null, 2)}\n`);
    writeText(join(folder, `${name}.mmd`), `${drawn.drawMermaid()}\n`);
  }
}
