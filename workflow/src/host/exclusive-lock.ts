import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SetupError } from "./setup-error.js";

/**
 * Takes an exclusive lock on a lock database and returns its release. The lock is held by the operating system on an
 * open transaction, so it ends with the process that holds it, killed or not, and no file is left to judge abandoned.
 * Another holder is a setup error beginning with `held`, never waited for.
 */
export function acquireExclusiveLock(lock: string, held: string): () => void {
  mkdirSync(dirname(lock), { recursive: true });
  const database = new Database(lock, { timeout: 0 });
  try {
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw new SetupError(`${held}: another process holds ${lock}.`);
    throw error;
  }
  return () => {
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  };
}
