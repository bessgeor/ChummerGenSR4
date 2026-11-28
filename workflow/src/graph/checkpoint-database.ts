import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

/** How long a connection waits for another connection's lock before an operation fails. */
export const checkpointBusyTimeoutMs = 30_000;

/**
 * Opens the checkpoint database at `path` (or `:memory:`) as a saver. Every checkpoint database (loop, workflow,
 * discovery, tuning) is opened here: in WAL mode, so a reader that opens it while a graph writes neither blocks the
 * writer nor sees a partial write, and with a busy timeout, so a connection waits for another one's lock instead of
 * failing at once.
 */
export function openCheckpointSaver(path: string): SqliteSaver {
  const database = new Database(path, { timeout: checkpointBusyTimeoutMs });
  try {
    database.pragma(`busy_timeout = ${checkpointBusyTimeoutMs}`);
    const mode = database.pragma("journal_mode = WAL", { simple: true });
    if (path !== ":memory:" && String(mode).toLowerCase() !== "wal") {
      throw new Error(`The checkpoint database ${path} could not be put in WAL mode; its journal mode is ${String(mode)}.`);
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return new SqliteSaver(database);
}
