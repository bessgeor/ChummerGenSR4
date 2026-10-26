import { buildDiscoveryGraph } from "../discovery/discovery-graph.js";
import { discoveryPaths } from "../discovery/discovery-paths.js";
import { buildWorkflowGraph } from "../graph/workflow-graph.js";
import { workflowPaths } from "../paths.js";
import type { GraphSource } from "./graphs.js";

/** Steps that are never called: the dashboard compiles a graph only to draw it and read its state. */
const inert = new Proxy({}, { get: (_target, name) => { throw new Error(`The dashboard's read-only graph has no step ${String(name)}.`); } }) as never;

/** The graphs of the repository, each on its own checkpoint file. */
export function graphSources(repositoryRoot: string): GraphSource[] {
  return [
    {
      kind: "workflow", checkpoints: workflowPaths(repositoryRoot).checkpoints,
      compile: (checkpointer) => buildWorkflowGraph(inert, inert, inert, inert, inert, inert).compile(checkpointer === undefined ? {} : { checkpointer }),
    },
    {
      kind: "discovery", checkpoints: discoveryPaths(repositoryRoot).checkpoints,
      compile: (checkpointer) => buildDiscoveryGraph(inert).compile(checkpointer === undefined ? {} : { checkpointer }),
    },
  ];
}
