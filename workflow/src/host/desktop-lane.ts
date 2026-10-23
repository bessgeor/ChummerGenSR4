import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { z } from "zod";
import { SetupError } from "./setup-error.js";

const LockSchema = z.strictObject({
  host: z.string().min(1),
  processId: z.number().int().positive(),
  startedUtc: z.string(),
  token: z.string().min(1),
});
type Lock = z.infer<typeof LockSchema>;

/** A lock as read, with the time its owner last refreshed it. */
type Owner = { readonly lock: Lock; readonly refreshedMilliseconds: number };

export type DesktopLaneSettings = {
  readonly lockPath: string;
  readonly pollMilliseconds: number;
  readonly unreadableTimeoutMilliseconds: number;
  /** The owner refreshes the lock's modification time this often while it holds the lane. */
  readonly heartbeatMilliseconds: number;
  /** A lock not refreshed for this long is abandoned even if a process with its ID exists (IDs are reused). */
  readonly staleAfterMilliseconds: number;
  readonly host: string;
  readonly processId: number;
  readonly isRunning: (processId: number) => boolean;
  readonly log: (line: string) => void;
};

/** Whether a process with this ID exists; `EPERM` means it exists but belongs to someone else. */
export function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function defaultLaneSettings(lockPath: string, log: (line: string) => void): DesktopLaneSettings {
  return {
    lockPath, pollMilliseconds: 2000, unreadableTimeoutMilliseconds: 10_000, heartbeatMilliseconds: 10_000,
    staleAfterMilliseconds: 90_000, host: hostname(), processId: process.pid, isRunning: isProcessRunning, log,
  };
}

const stopped = () => new SetupError("The desktop lane was not acquired because the run was stopped.");

/** Resolves after the delay, or rejects when the signal aborts first. */
function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(stopped());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(stopped());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The machine-wide desktop lane: a lock file created exclusively and refreshed by its owner while it runs. A lock
 * whose owner on this host is no longer running, or has not refreshed it for a long time, is taken over; any other
 * owner is waited for; a lock that stays unreadable is a setup error.
 */
export class DesktopLane {
  constructor(private readonly settings: DesktopLaneSettings) {}

  /** Waits for the lane (until the signal aborts) and returns the function that releases it. */
  async acquire(signal?: AbortSignal): Promise<() => Promise<void>> {
    const { lockPath } = this.settings;
    await mkdir(dirname(lockPath), { recursive: true });
    const lock: Lock = {
      host: this.settings.host, processId: this.settings.processId,
      startedUtc: new Date().toISOString(), token: randomUUID(),
    };
    let unreadableSince: number | null = null;
    let announced = false;
    for (;;) {
      if (signal?.aborted === true) throw stopped();
      if (await this.tryCreate(lock)) {
        const heartbeat = this.startHeartbeat();
        return () => {
          clearInterval(heartbeat);
          return this.release(lock.token);
        };
      }
      const owner = await this.readOwner();
      if (owner === null) {
        // Between another process's create and its write the file is empty; only a lasting state is an error.
        unreadableSince ??= Date.now();
        if (Date.now() - unreadableSince >= this.settings.unreadableTimeoutMilliseconds) {
          throw new SetupError(`The desktop lane lock ${lockPath} cannot be read; check who holds the desktop and remove it.`);
        }
      } else if (owner === "gone") {
        unreadableSince = null;
        continue;
      } else {
        unreadableSince = null;
        const reason = this.abandonedReason(owner);
        if (reason !== null) {
          await this.takeOver(owner.lock, reason, signal);
          continue;
        }
        if (!announced) {
          this.settings.log(`Waiting for the desktop lane, held by process ${owner.lock.processId} on ${owner.lock.host} since ${owner.lock.startedUtc}.`);
          announced = true;
        }
      }
      await delay(this.settings.pollMilliseconds, signal);
    }
  }

  /** Why the owner counts as gone, or null when it may still be running. */
  private abandonedReason(owner: Owner): string | null {
    const { lock } = owner;
    if (lock.host !== this.settings.host) return null;
    if (!this.settings.isRunning(lock.processId)) return `process ${lock.processId}, which is no longer running`;
    const silent = Date.now() - owner.refreshedMilliseconds;
    return silent > this.settings.staleAfterMilliseconds
      ? `process ${lock.processId}, which has not refreshed the lock for ${Math.round(silent / 1000)} s (the process ID may belong to another program now)`
      : null;
  }

  /**
   * Removes the lock of an abandoned owner. Another waiter may have judged the same lock abandoned and already
   * replaced it, so the removal happens under a short-lived guard file and only if the lock still holds the
   * token that was judged: a lock created in the meantime is never removed.
   */
  private async takeOver(abandoned: Lock, reason: string, signal: AbortSignal | undefined): Promise<void> {
    const { lockPath } = this.settings;
    const guardPath = `${lockPath}.takeover`;
    const deadline = Date.now() + this.settings.unreadableTimeoutMilliseconds;
    let guard;
    for (;;) {
      try {
        guard = await open(guardPath, "wx");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (Date.now() >= deadline) {
        throw new SetupError(`The desktop lane takeover guard ${guardPath} stays in place; check that no run is taking over the lane and remove it.`);
      }
      await delay(Math.min(this.settings.pollMilliseconds, 50), signal);
    }
    try {
      const current = await this.readOwner();
      if (current !== null && current !== "gone" && current.lock.token === abandoned.token) {
        this.settings.log(`Taking over the desktop lane from ${reason}.`);
        await unlink(lockPath);
      }
    } finally {
      await guard.close();
      await unlink(guardPath);
    }
  }

  private async tryCreate(lock: Lock): Promise<boolean> {
    let handle;
    try {
      handle = await open(this.settings.lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  }

  /** Refreshes the lock's modification time while the lane is held; the timer never keeps the process alive. */
  private startHeartbeat(): NodeJS.Timeout {
    const timer = setInterval(() => {
      const now = new Date();
      utimes(this.settings.lockPath, now, now).catch((error: Error) => {
        this.settings.log(`The desktop lane lock could not be refreshed: ${error.message}`);
      });
    }, this.settings.heartbeatMilliseconds);
    timer.unref();
    return timer;
  }

  /** The current owner, "gone" when the file disappeared, or null when it cannot be read as a lock. */
  private async readOwner(): Promise<Owner | "gone" | null> {
    let text: string;
    let refreshedMilliseconds: number;
    try {
      text = await readFile(this.settings.lockPath, "utf8");
      refreshedMilliseconds = (await stat(this.settings.lockPath)).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "gone";
      return null;
    }
    try {
      const parsed = LockSchema.safeParse(JSON.parse(text));
      return parsed.success ? { lock: parsed.data, refreshedMilliseconds } : null;
    } catch {
      return null;
    }
  }

  private async release(token: string): Promise<void> {
    const owner = await this.readOwner();
    if (owner === null || owner === "gone" || owner.lock.token !== token) {
      throw new SetupError(`The desktop lane lock ${this.settings.lockPath} no longer belongs to this run; it was not removed.`);
    }
    await unlink(this.settings.lockPath);
  }
}
