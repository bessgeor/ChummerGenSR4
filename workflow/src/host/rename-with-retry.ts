import { renameSync } from "node:fs";

/** Error codes Windows gives while another process (an indexer, an antivirus scan) still holds a file just written. */
const transient = new Set(["EPERM", "EBUSY", "EACCES"]);

export type RenameRetry = {
  /** Tries in all, the first included. */
  readonly attempts?: number;
  /** The wait before the second try; each later wait doubles it. */
  readonly firstDelayMs?: number;
  readonly rename?: (from: string, to: string) => void;
  readonly sleep?: (milliseconds: number) => void;
};

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Renames `from` to `to`, trying again with a doubling wait while the rename fails with a transient lock error. Any other
 * error, and the last transient one when every try failed, is thrown as it is.
 */
export function renameWithRetry(from: string, to: string, options: RenameRetry = {}): void {
  const attempts = options.attempts ?? 8;
  const rename = options.rename ?? renameSync;
  const sleep = options.sleep ?? sleepSync;
  let delay = options.firstDelayMs ?? 50;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || code === undefined || !transient.has(code)) throw error;
      sleep(delay);
      delay *= 2;
    }
  }
}
