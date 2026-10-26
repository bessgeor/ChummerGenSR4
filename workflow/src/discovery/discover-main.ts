// Composition root of discovery: `npm run discover -- --from <thread>` runs or resumes a discovery thread of the graph
// prepare → rank → select → scenario jobs → validate → execute → register → conclude and exits with 0, 1, 2 or 3 (see --help).
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { agentRunners } from "../agents/agent-runners.js";
import { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { processGit } from "../diagnosis/source-snapshot.js";
import { certificateProblems } from "../evals/certificate.js";
import { setupErrorStatus } from "../graph/run-workflow.js";
import { HostSteps } from "../host-steps.js";
import { CpuPool, defaultCpuPoolSize } from "../host/cpu-pool.js";
import { ProcessHostRunner } from "../host/host-runner.js";
import { hostLanePool } from "../lanes/host-lanes.js";
import { laneDefinitions } from "../lanes/lane-settings.js";
import { startAgentWithRider } from "../lanes/rider-dispatch.js";
import { interruptSignal } from "../host/interrupt-signal.js";
import { createScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { loadProfile, localDataFolder } from "../options/profile.js";
import { workflowPaths } from "../paths.js";
import { CaptureStep } from "../steps/capture-step.js";
import { CompareStep } from "../steps/compare-step.js";
import { changedInputs } from "../steps/input-fingerprints.js";
import { StepStore } from "../steps/step-store.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { discoverUsage, parseDiscoverArguments, resolveDiscoveryOptions } from "./discover-arguments.js";
import { discoveryPaths } from "./discovery-paths.js";
import { composeDiscovery, hostDiscovery } from "./discovery-runner.js";
import { registryPaths } from "./registry.js";
import { runDiscovery } from "./run-discovery.js";

process.on("uncaughtException", (error) => {
  console.error(`npm run discover failed: ${error.stack ?? String(error)}`);
  process.exit(setupErrorStatus);
});

async function main(): Promise<number> {
  const log = (line: string) => console.log(line);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  let command;
  let profile;
  try {
    command = parseDiscoverArguments(process.argv.slice(2));
    if (command.kind === "help") {
      log(discoverUsage);
      return 0;
    }
    profile = loadProfile(process.env);
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Setup error: ${error.message}`);
    return setupErrorStatus;
  }

  const paths = workflowPaths(repositoryRoot);
  const folders = discoveryPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  mkdirSync(folders.root, { recursive: true });
  const now = () => new Date();
  const lanes = hostLanePool(laneDefinitions(profile.lanes), localDataFolder(process.env), log, startAgentWithRider);
  const host = new ProcessHostRunner(repositoryRoot, lanes, new CpuPool(profile.cpuPool ?? defaultCpuPoolSize()), (text) => process.stdout.write(text));
  const stepStore = new StepStore(paths.steps);
  const hostSteps = new HostSteps(paths, host,
    new CaptureStep({ paths, host, store: stepStore, log, now, createScratchFolder, changedInputs }),
    new CompareStep({ paths, host, store: stepStore, log, now, changedInputs }), stepStore, now, createScratchFolder);
  const checkpointer = SqliteSaver.fromConnString(folders.checkpoints);
  const store = new SqliteStore(paths.store);
  try {
    const runner = composeDiscovery({
      repositoryRoot, paths, folders, registry: registryPaths(repositoryRoot), git: processGit(repositoryRoot), host: hostDiscovery(paths, host, hostSteps, createScratchFolder),
      agents: agentRunners(process.env), quota: new QuotaWaiter(randomBytes(8).toString("hex"), undefined, log), createScratchFolder, checkpointer, store, now, log,
    });
    return await runDiscovery(command, {
      runner, log, now, signal: interruptSignal(log),
      resolveOptions: (args) => resolveDiscoveryOptions(args, profile, process.env, repositoryRoot),
      certificateProblems: (options) => (options.unattended ? certificateProblems(options.certificates, ["rank", "scenario"], options.agents, options.tuning) : []),
    });
  } finally {
    store.close();
    checkpointer.db.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run discover failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
