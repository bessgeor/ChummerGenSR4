/** A counting semaphore for work inside this process: child processes or model jobs. */
export class Pool {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly size: number, name: string) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError(`The ${name} size must be a positive integer, got ${size}.`);
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
