import { equal } from "node:assert/strict";
import { test } from "node:test";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import { sqliteCheckpointedThread } from "../src/graph/checkpointed-thread.js";

async function saved(checkpointer: SqliteSaver, threadId: string): Promise<void> {
  await checkpointer.put({ configurable: { thread_id: threadId, checkpoint_ns: "" } }, emptyCheckpoint(), { source: "input", step: 0, parents: {} });
}

test("the stored thread whose ID matches without regard to case is found, and no other", async () => {
  const checkpointer = SqliteSaver.fromConnString(":memory:");
  try {
    await saved(checkpointer, "wf-ABC");
    await saved(checkpointer, "wf-other");
    equal(sqliteCheckpointedThread(checkpointer, "wf-ABC"), "wf-ABC");
    equal(sqliteCheckpointedThread(checkpointer, "wf-abc"), "wf-ABC");
    equal(sqliteCheckpointedThread(checkpointer, "wf-ab"), null);
    equal(sqliteCheckpointedThread(checkpointer, "wf-new"), null);
  } finally {
    checkpointer.db.close();
  }
});

test("a checkpoint database that holds no checkpoint table yet holds no thread", () => {
  const checkpointer = SqliteSaver.fromConnString(":memory:");
  try {
    equal(sqliteCheckpointedThread(checkpointer, "wf-new"), null);
  } finally {
    checkpointer.db.close();
  }
});
