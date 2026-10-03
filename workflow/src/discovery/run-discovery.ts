import { newThreadId, setupErrorStatus, threadConfig } from "../graph/run-workflow.js";
import { SetupError } from "../host/setup-error.js";
import type { DiscoverCommand, DiscoverArguments } from "./discover-arguments.js";
import type { buildDiscoveryGraph } from "./discovery-graph.js";
import { pendingJob, type DiscoveryOptions, type DiscoveryStateValue } from "./discovery-state.js";

export type DiscoveryGraph = ReturnType<ReturnType<typeof buildDiscoveryGraph>["compile"]>;

export type DiscoveryRunDependencies = {
  readonly graph: DiscoveryGraph;
  readonly resolveOptions: (args: DiscoverArguments) => DiscoveryOptions;
  /** Why an unattended thread may not dispatch its jobs; empty when it may or is not unattended. */
  readonly certificateProblems: (options: DiscoveryOptions) => readonly string[];
  readonly log: (line: string) => void;
  readonly now: () => Date;
  readonly signal?: AbortSignal;
};

function requireCertificates(options: DiscoveryOptions, dependencies: DiscoveryRunDependencies): void {
  const problems = dependencies.certificateProblems(options);
  if (problems.length > 0) throw new SetupError(`--unattended needs a certificate for the rank and scenario jobs:\n  ${problems.join("\n  ")}`);
}

/** Runs or resumes a discovery thread and returns its exit status; any failure is a setup error, and an unfinished thread stays resumable. */
export async function runDiscovery(command: Exclude<DiscoverCommand, { kind: "help" }>, dependencies: DiscoveryRunDependencies): Promise<number> {
  const { graph, log } = dependencies;
  let threadId: string | null = command.kind === "resume" ? command.threadId : null;
  try {
    let final: DiscoveryStateValue;
    if (command.kind === "resume") {
      const snapshot = await graph.getState({ configurable: { thread_id: command.threadId } });
      const values = snapshot.values as Partial<DiscoveryStateValue>;
      if (snapshot.config.configurable?.["checkpoint_id"] === undefined || values.options === undefined) throw new SetupError(`There is no discovery thread ${command.threadId} to resume.`);
      if (snapshot.next.length === 0) throw new SetupError(`Discovery thread ${command.threadId} already finished; start a new one instead.`);
      requireCertificates(values.options, dependencies);
      log(`Resuming discovery thread ${command.threadId}.`);
      final = await graph.invoke(null, threadConfig(command.threadId, dependencies.signal));
    } else {
      const options = dependencies.resolveOptions(command.arguments);
      requireCertificates(options, dependencies);
      threadId = newThreadId(dependencies.now(), "disc");
      const cache = options.canonicalCache === null ? "off (--live-canonical)" : `${options.canonicalCache} (${options.canonicalCacheSource})`;
      log(`Discovery thread ${threadId}: baseline ${options.from}, ${options.targets} targets at most, canonical cache ${cache}.`);
      log(`Resume it after an interruption with: npm run discover -- --resume ${threadId}`);
      const input: DiscoveryStateValue = {
        threadId, options, startedUtc: dependencies.now().toISOString(), prepared: null, rankJob: pendingJob(), selected: null, scenarios: {}, agentMilliseconds: 0,
        execution: null, registered: null, concluded: null,
      };
      final = await graph.invoke(input, threadConfig(threadId, dependencies.signal));
    }
    if (final.concluded === null) throw new SetupError(`Discovery thread ${final.threadId} ended without its conclusion.`);
    for (const line of final.concluded.lines) log(line);
    log(`Discovery thread ${final.threadId} finished: exit ${final.concluded.exitStatus}.`);
    return final.concluded.exitStatus;
  } catch (error) {
    if (dependencies.signal?.aborted === true) log("Interrupted: the running steps were stopped.");
    else log(`Setup error: ${error instanceof SetupError ? error.message : (error as Error).stack ?? String(error)}`);
    if (threadId !== null) log(`Discovery thread ${threadId} stopped; resume it with: npm run discover -- --resume ${threadId}`);
    return setupErrorStatus;
  }
}
