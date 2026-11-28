import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { SetupError } from "../host/setup-error.js";

/**
 * How long a connection waits for another connection's write lock before an operation fails. The wait blocks the
 * process (the driver is synchronous), so it stays short; in WAL mode only writers wait for each other.
 */
export const checkpointBusyTimeoutMs = 10_000;

/**
 * Opens the checkpoint database at `path` (or `:memory:`) as a saver. Every checkpoint database (loop, workflow,
 * discovery, tuning) is opened here, with the busy timeout set and in WAL mode from the moment it opens, so a reader
 * that opens it while a graph writes neither blocks the writer nor sees a partial write. A database that cannot be put
 * in WAL mode is a setup error.
 */
export function openCheckpointSaver(path: string): SqliteSaver {
  const database = new Database(path, { timeout: checkpointBusyTimeoutMs });
  try {
    database.pragma(`busy_timeout = ${checkpointBusyTimeoutMs}`);
    const mode = String(database.pragma("journal_mode = WAL", { simple: true })).toLowerCase();
    if (path !== ":memory:" && mode !== "wal") {
      throw new SetupError(`The checkpoint database ${path} cannot be put in WAL mode: its journal mode stays ${mode}.`);
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return new SqliteSaver(database);
}
