import type { WorkflowGraph } from "../src/graph/run-workflow.js";

/** Where a thread that stopped inside a stage stands: the workflow graph's next nodes, the stage's namespace and the stage's next nodes. */
export async function stoppedStage(graph: WorkflowGraph, threadId: string): Promise<{ next: string[]; namespace: string; inner: string[] }> {
  const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
  const task = snapshot.tasks[0];
  if (task === undefined) throw new Error(`Thread ${threadId} did not stop inside a stage.`);
  const namespace = `${task.name}:${task.id}`;
  const inner = await graph.getState({ configurable: { thread_id: threadId, checkpoint_ns: namespace } });
  return { next: [...snapshot.next], namespace, inner: [...inner.next] };
}
