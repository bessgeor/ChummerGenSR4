import { cpus } from "node:os";

/** Half the logical processors, at least 1 and at most 4. */
export function defaultCpuPoolSize(logicalProcessors: number = cpus().length): number {
  return Math.min(4, Math.max(1, Math.floor(logicalProcessors / 2)));
}

/** A counting semaphore for CPU-bound child processes inside this process. */
export class CpuPool {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError(`The CPU pool size must be a positive integer, got ${size}.`);
    }
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) {
        this.active--;
      } else {
        // The slot passes straight to the next waiter, so the count stays the same.
        next();
      }
    }
  }
}
