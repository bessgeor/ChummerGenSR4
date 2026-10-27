import type { MemorySaver } from "@langchain/langgraph";

/** The in-memory counterpart of the checkpointed-thread lookup: a stored thread ID equal to the given one without regard to case. */
export function memoryCheckpointedThread(checkpointer: MemorySaver, threadId: string): string | null {
  return Object.keys(checkpointer.storage).find((stored) => stored.toLowerCase() === threadId.toLowerCase()) ?? null;
}
