import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveryGraph, DiscoveryRunner, DiscoveryThread } from "../src/discovery/discovery-runner.js";
import type { Concluded, DiscoveryOptions } from "../src/discovery/discovery-state.js";
import type { ThreadDiscoverySteps } from "../src/discovery/thread-discovery.js";
import { SetupError } from "../src/host/setup-error.js";

/** The discovery of graphs whose threads never discover. */
export const noDiscovery: ThreadDiscoverySteps = { discover: () => Promise.reject(new Error("discovery is off")) };

/** What a fake discovery thread concludes: its exit status and its scenarios' cases, admissions and visual outcomes. */
export type FakeConclusion = {
  readonly exitStatus: number;
  readonly scenarios: readonly { readonly case: string | null; readonly admission: "admitted" | "duplicate" | "not-admitted" | null; readonly outcome: "clear" | "finding" | null }[];
};

/**
 * Discovery threads in memory, started, resumed and read by ID like the real runner's; each call is recorded. A failure set in
 * `failBeforeCheckpoint` is thrown before the thread exists, one set in `failAfterCheckpoint` after it exists and before it concludes.
 */
export class FakeDiscoveryRunner implements DiscoveryRunner {
  readonly graph = null as unknown as DiscoveryGraph;
  readonly calls: string[] = [];
  readonly started: { threadId: string; options: DiscoveryOptions }[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  failBeforeCheckpoint: Error | null = null;
  failAfterCheckpoint: Error | null = null;
  private readonly threads = new Map<string, { options: DiscoveryOptions; concluded: Concluded | null }>();

  constructor(private readonly folder: string, public conclusion: FakeConclusion = { exitStatus: 0, scenarios: [] }) {}

  async thread(threadId: string): Promise<DiscoveryThread> {
    const found = this.threads.get(threadId);
    if (found === undefined) return { kind: "absent" };
    return found.concluded === null ? { kind: "unfinished", options: found.options } : { kind: "finished", options: found.options, concluded: found.concluded };
  }

  async start(threadId: string, options: DiscoveryOptions, signal?: AbortSignal): Promise<Concluded> {
    this.calls.push(`start ${threadId}`);
    this.signals.push(signal);
    if (this.threads.has(threadId)) throw new SetupError(`Discovery thread ${threadId} already exists; resume it instead.`);
    this.started.push({ threadId, options });
    const failure = this.failBeforeCheckpoint;
    this.failBeforeCheckpoint = null;
    if (failure !== null) throw failure;
    this.threads.set(threadId, { options, concluded: null });
    return this.run(threadId);
  }

  async resume(threadId: string, signal?: AbortSignal): Promise<Concluded> {
    this.calls.push(`resume ${threadId}`);
    this.signals.push(signal);
    const found = await this.thread(threadId);
    if (found.kind !== "unfinished") throw new SetupError(`Discovery thread ${threadId} cannot be resumed: it is ${found.kind}.`);
    return this.run(threadId);
  }

  async read(threadId: string): Promise<Concluded> {
    this.calls.push(`read ${threadId}`);
    const found = await this.thread(threadId);
    if (found.kind !== "finished") throw new SetupError(`Discovery thread ${threadId} cannot be read: it is ${found.kind}.`);
    return found.concluded;
  }

  /** Marks a thread finished with the current conclusion, as if it ran before. */
  finish(threadId: string, options: DiscoveryOptions): Concluded {
    this.threads.set(threadId, { options, concluded: null });
    return this.conclude(threadId);
  }

  private run(threadId: string): Concluded {
    const failure = this.failAfterCheckpoint;
    this.failAfterCheckpoint = null;
    if (failure !== null) throw failure;
    return this.conclude(threadId);
  }

  private conclude(threadId: string): Concluded {
    const folder = join(this.folder, threadId);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, "discovery.json");
    const scenarios = this.conclusion.scenarios.map((item) => ({
      case: item.case, admission: item.admission, visual: item.outcome === null ? null : { outcome: item.outcome, differing: item.outcome === "finding" ? ["common"] : [] },
    }));
    const admitted = this.conclusion.scenarios.filter((item) => item.admission === "admitted").map((item) => item.case!);
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, threadId, registry: { before: 0, after: admitted.length, admitted, duplicates: [] }, scenarios }));
    const concluded: Concluded = { path, exitStatus: this.conclusion.exitStatus, lines: [`Report of ${threadId}`] };
    this.threads.set(threadId, { options: this.threads.get(threadId)!.options, concluded });
    return concluded;
  }
}
