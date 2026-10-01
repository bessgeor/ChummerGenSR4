import { Pool } from "../host/pool.js";
import type { AgentJob, AgentResult, AgentRunner, Provider } from "./agent-job.js";

/** Runs each job on the adapter of its chosen provider, at most `size` jobs at a time. */
export class PooledAgentRunner implements AgentRunner {
  private readonly pool: Pool;

  constructor(private readonly adapters: Readonly<Record<Provider, AgentRunner>>, size: number) {
    this.pool = new Pool(size, "model pool");
  }

  run<T>(job: AgentJob<T>): Promise<AgentResult<T>> {
    return this.pool.run(() => this.adapters[job.choice.provider].run(job));
  }
}
