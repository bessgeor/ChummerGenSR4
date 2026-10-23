import { cpus } from "node:os";
import { Pool } from "./pool.js";

/** Half the logical processors, at least 1 and at most 4. */
export function defaultCpuPoolSize(logicalProcessors: number = cpus().length): number {
  return Math.min(4, Math.max(1, Math.floor(logicalProcessors / 2)));
}

/** The pool for CPU-bound child processes inside this process. */
export class CpuPool extends Pool {
  constructor(size: number) {
    super(size, "CPU pool");
  }
}
