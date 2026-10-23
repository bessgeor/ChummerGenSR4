import { Pool } from "../host/pool.js";
import { notStarted, wasNotStarted, type AgentJob, type AgentResult, type AgentRunner, type NotStarted, type Provider } from "./agent-job.js";

/**
 * Runs each job on the adapter of its chosen provider, at most `size` jobs at a time. A job asks `mayStart` when
 * it gets its place and hands over its result with `onResult` before it gives the place up, so a job that waited
 * in the queue sees what the jobs before it changed.
 */
export class PooledAgentRunner implements AgentRunner {
  private readonly pool: Pool;

  constructor(private readonly adapters: Readonly<Record<Provider, AgentRunner>>, size: number) {
    this.pool = new Pool(size, "model pool");
  }

  run<T>(job: AgentJob<T>): Promise<AgentResult<T> | NotStarted> {
    return this.pool.run(async () => {
      if (job.mayStart?.() === false) return notStarted;
      const result = await this.adapters[job.choice.provider].run(job);
      if (!wasNotStarted(result)) job.onResult?.(result);
      return result;
    });
  }
}
