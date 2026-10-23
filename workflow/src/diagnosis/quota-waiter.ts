import { setTimeout as sleep } from "node:timers/promises";
import { SetupError } from "../host/setup-error.js";

/** The waits after a usage limit: 1, 2, 5, 10 and 15 minutes, then 15 minutes each time. */
export const quotaDelaysMinutes = [1, 2, 5, 10, 15] as const;

export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

const realSleep: Sleep = (milliseconds, signal) => sleep(milliseconds, undefined, signal === undefined ? {} : { signal });

/**
 * Counts this process's quota waits. The count lives in memory: a process that restarts begins again, and its
 * first retry of a wait recorded by another process is immediate.
 */
export class QuotaWaiter {
  private waits = 0;

  constructor(readonly processId: string, private readonly sleepFor: Sleep = realSleep, private readonly log: (line: string) => void = () => undefined) {}

  /** The delay of the next wait in this process, in milliseconds. */
  nextDelay(): number {
    return quotaDelaysMinutes[Math.min(this.waits, quotaDelaysMinutes.length - 1)]! * 60_000;
  }

  /** Sleeps the next delay, or not at all when the waiting jobs were stopped by another process. Ctrl+C ends it as a setup error. */
  async wait(recordedBy: readonly string[], signal?: AbortSignal): Promise<number> {
    if (recordedBy.some((processId) => processId !== this.processId)) {
      this.log("Usage limit recorded before a restart: retrying at once.");
      return 0;
    }
    const delay = this.nextDelay();
    this.waits++;
    this.log(`Usage limit reached: waiting ${delay / 60_000} min before retrying (wait ${this.waits} of this process).`);
    try {
      await this.sleepFor(delay, signal);
    } catch (error) {
      if (signal?.aborted === true) throw new SetupError("The quota wait was stopped because the run was stopped.");
      throw error;
    }
    return delay;
  }

  /** A job succeeded: the next limit starts the sequence again. */
  reset(): void {
    this.waits = 0;
  }
}
