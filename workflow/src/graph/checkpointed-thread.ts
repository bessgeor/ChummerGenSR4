import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

/**
 * The checkpointed thread whose ID equals `threadId` without regard to ASCII case, if any. The query reads one
 * thread ID from the checkpoint table; it loads no checkpoint. The saver creates the table with its first operation,
 * so a database without it holds no thread.
 */
export function sqliteCheckpointedThread(checkpointer: SqliteSaver, threadId: string): string | null {
  const table = checkpointer.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'").get();
  if (table === undefined) return null;
  const row = checkpointer.db.prepare("SELECT thread_id FROM checkpoints WHERE thread_id = ? COLLATE NOCASE LIMIT 1").get(threadId) as { thread_id: string } | undefined;
  return row?.thread_id ?? null;
}
