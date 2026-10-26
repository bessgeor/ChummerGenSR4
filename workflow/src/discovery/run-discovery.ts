import { newThreadId, setupErrorStatus } from "../graph/run-workflow.js";
import { SetupError } from "../host/setup-error.js";
import type { DiscoverCommand, DiscoverArguments } from "./discover-arguments.js";
import type { DiscoveryRunner } from "./discovery-runner.js";
import type { Concluded, DiscoveryOptions } from "./discovery-state.js";

export type DiscoveryRunDependencies = {
  readonly runner: DiscoveryRunner;
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
  const { runner, log } = dependencies;
  let threadId: string | null = command.kind === "resume" ? command.threadId : null;
  try {
    let concluded: Concluded;
    if (command.kind === "resume") {
      const found = await runner.thread(command.threadId);
      if (found.kind === "absent") throw new SetupError(`There is no discovery thread ${command.threadId} to resume.`);
      if (found.kind === "finished") throw new SetupError(`Discovery thread ${command.threadId} already finished; start a new one instead.`);
      requireCertificates(found.options, dependencies);
      log(`Resuming discovery thread ${command.threadId}.`);
      concluded = await runner.resume(command.threadId, dependencies.signal);
    } else {
      const options = dependencies.resolveOptions(command.arguments);
      requireCertificates(options, dependencies);
      threadId = newThreadId(dependencies.now(), "disc");
      const cache = options.canonicalCache === null ? "off (--live-canonical)" : `${options.canonicalCache} (${options.canonicalCacheSource})`;
      log(`Discovery thread ${threadId}: baseline ${options.from}, ${options.targets} targets at most, canonical cache ${cache}.`);
      log(`Resume it after an interruption with: npm run discover -- --resume ${threadId}`);
      concluded = await runner.start(threadId, options, dependencies.signal);
    }
    for (const line of concluded.lines) log(line);
    log(`Discovery thread ${threadId} finished: exit ${concluded.exitStatus}.`);
    return concluded.exitStatus;
  } catch (error) {
    if (dependencies.signal?.aborted === true) log("Interrupted: the running steps were stopped.");
    else log(`Setup error: ${error instanceof SetupError ? error.message : (error as Error).stack ?? String(error)}`);
    if (threadId !== null) log(`Discovery thread ${threadId} stopped; resume it with: npm run discover -- --resume ${threadId}`);
    return setupErrorStatus;
  }
}
