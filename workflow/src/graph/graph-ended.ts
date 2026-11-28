import type { StateSnapshot } from "@langchain/langgraph";

/**
 * Whether a checkpointed graph has no node left to run. `next` is not enough: it leaves out a task that has a pending
 * write which execution does not count as the task's result, such as the value an interrupted node was resumed with
 * before it failed.
 */
export function graphEnded(snapshot: Pick<StateSnapshot, "tasks">): boolean {
  return snapshot.tasks.length === 0;
}
