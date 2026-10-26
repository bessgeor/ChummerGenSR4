import { z } from "zod";
import type { RunOptions } from "../options/run-options.js";
import { readDocument } from "../steps/read-document.js";
import type { DispatchedTuning } from "../tuning/tuning.js";
import type { DiscoveryRunner } from "./discovery-runner.js";
import type { Concluded, DiscoveryOptions } from "./discovery-state.js";

/** What a workflow thread records of its discovery thread. */
export type ThreadDiscovery = {
  readonly threadId: string;
  readonly exitStatus: number;
  /** The cases the discovery admitted to the registry. */
  readonly admitted: readonly string[];
  /** The admitted cases whose scenario differs. */
  readonly differing: readonly string[];
  /** The discovery thread's `discovery.json`. */
  readonly documentPath: string;
};

/** The ID of a workflow thread's discovery thread: one per workflow thread, so a resumed workflow thread finds it. */
export function discoveryThreadId(workflowThread: string): string {
  return `disc-${workflowThread}`;
}

/** The discovery thread's options: the workflow thread as the baseline, its fixture case file, targets and the options they share. */
export function threadDiscoveryOptions(workflowThread: string, options: RunOptions): DiscoveryOptions {
  const settings = options.discovery;
  if (settings == null) throw new Error(`Thread ${workflowThread} does not discover.`);
  const tuning: DispatchedTuning = Object.fromEntries((["rank", "scenario"] as const).flatMap((kind) => {
    const configuration = options.tuning?.[kind];
    return configuration === undefined ? [] : [[kind, configuration]];
  }));
  return {
    from: workflowThread, caseFile: settings.caseFile, settingsOverlay: options.settingsOverlay, threshold: options.threshold, canonicalCache: options.canonicalCache,
    canonicalCacheSource: options.canonicalCacheSource, targets: settings.targets, unattended: options.unattended, agents: options.agents, certificates: options.certificates,
    ...(options.tuning === undefined ? {} : { tuning }),
  };
}

/** The fields of `discovery.json` a workflow thread records. */
const DiscoveryResultSchema = z.looseObject({
  registry: z.looseObject({ admitted: z.array(z.string()) }),
  scenarios: z.array(z.looseObject({
    case: z.string().nullable(),
    admission: z.string().nullable(),
    visual: z.looseObject({ outcome: z.string() }).nullable(),
  })),
});

/** What a concluded discovery thread found, read from its `discovery.json`; a document that cannot be read is a setup error. */
export function readThreadDiscovery(threadId: string, concluded: Concluded): ThreadDiscovery {
  const document = readDocument(concluded.path, DiscoveryResultSchema);
  const differing = document.scenarios.flatMap((item) => (item.case !== null && item.admission === "admitted" && item.visual?.outcome === "finding" ? [item.case] : []));
  return { threadId, exitStatus: concluded.exitStatus, admitted: document.registry.admitted, differing, documentPath: concluded.path };
}

/** The discovery of the graph's `discovery` stage. */
export interface ThreadDiscoverySteps {
  /**
   * Runs the workflow thread's discovery thread to its conclusion: it starts it, resumes it when it is unfinished, or reads the
   * conclusion of a finished one without running it again. A failure is thrown, and an unfinished discovery thread stays resumable.
   */
  discover(input: { readonly threadId: string; readonly options: RunOptions }, signal?: AbortSignal): Promise<ThreadDiscovery>;
}

/** A workflow thread's discovery through the discovery runner. */
export class RunnerDiscovery implements ThreadDiscoverySteps {
  constructor(private readonly runner: DiscoveryRunner, private readonly log: (line: string) => void) {}

  async discover(input: { readonly threadId: string; readonly options: RunOptions }, signal?: AbortSignal): Promise<ThreadDiscovery> {
    const id = discoveryThreadId(input.threadId);
    const found = await this.runner.thread(id);
    let concluded: Concluded;
    switch (found.kind) {
      case "absent": {
        const options = threadDiscoveryOptions(input.threadId, input.options);
        this.log(`Discovery thread ${id}: baseline ${options.from}, ${options.targets} targets at most.`);
        concluded = await this.runner.start(id, options, signal);
        break;
      }
      case "unfinished":
        this.log(`Resuming discovery thread ${id}.`);
        concluded = await this.runner.resume(id, signal);
        break;
      case "finished":
        this.log(`Discovery thread ${id} already finished; its conclusion is read without running it again.`);
        concluded = found.concluded;
        break;
    }
    // Each scenario's execution and visual outcomes and the registry before and after, as npm run discover reports them.
    for (const line of concluded.lines) this.log(line);
    this.log(`Discovery thread ${id} finished: exit ${concluded.exitStatus}; ${concluded.path}`);
    return readThreadDiscovery(id, concluded);
  }
}
