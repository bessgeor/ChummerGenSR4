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
import { defaultLaneSettings, DesktopLane } from "../host/desktop-lane.js";
import { ProcessHostRunner } from "../host/host-runner.js";
import { interruptSignal } from "../host/interrupt-signal.js";
import { createScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { loadProfile, localDataFolder } from "../options/profile.js";
import { workflowPaths } from "../paths.js";
import { CaptureStep, readEnvironmentFingerprint, runCaptureRunner } from "../steps/capture-step.js";
import { CompareStep } from "../steps/compare-step.js";
import { captureInputs, changedInputs } from "../steps/input-fingerprints.js";
import { StepStore } from "../steps/step-store.js";
import { SqliteStore } from "../store/sqlite-store.js";
import { discoverUsage, parseDiscoverArguments, resolveDiscoveryOptions } from "./discover-arguments.js";
import { concludeDiscovery } from "./discovery-document.js";
import { buildDiscoveryGraph, type DiscoverySteps } from "./discovery-graph.js";
import { DiscoveryJobs } from "./discovery-jobs.js";
import { discoveryPaths } from "./discovery-paths.js";
import { DiscoveryService } from "./discovery-service.js";
import { registryPaths } from "./registry.js";
import { runDiscovery } from "./run-discovery.js";
import { ScenarioRun } from "./scenario-run.js";

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
  const lane = new DesktopLane(defaultLaneSettings(join(localDataFolder(process.env), "desktop-lane.lock"), log));
  const host = new ProcessHostRunner(repositoryRoot, lane, new CpuPool(profile.cpuPool ?? defaultCpuPoolSize()), (text) => process.stdout.write(text));
  const stepStore = new StepStore(paths.steps);
  const hostSteps = new HostSteps(paths, host,
    new CaptureStep({ paths, host, store: stepStore, log, now, createScratchFolder, changedInputs }),
    new CompareStep({ paths, host, store: stepStore, log, now, changedInputs }), stepStore, now, createScratchFolder);
  const jobs = new DiscoveryJobs({ agents: agentRunners(process.env), quota: new QuotaWaiter(randomBytes(8).toString("hex"), undefined, log), createScratchFolder, now, log });
  const service = new DiscoveryService({
    repositoryRoot, paths, folders, registry: registryPaths(repositoryRoot), git: processGit(repositoryRoot), jobs, buildTools: (options, signal) => hostSteps.build(options, false, signal), now, log,
  });
  const scenarioRun = new ScenarioRun({
    repositoryRoot, folders, registry: registryPaths(repositoryRoot), now, log,
    capture: (options, cases, signal) => runCaptureRunner({
      paths, host, createScratchFolder, options, selection: { cases, captures: null }, subject: "discovery capture", uiTrees: true, ...(signal === undefined ? {} : { signal }),
    }),
    changedInputs: (options, fingerprints) => changedInputs(paths, options, fingerprints, captureInputs),
    environment: (signal) => readEnvironmentFingerprint(paths, host, createScratchFolder, "environment discovery", signal),
  });
  const steps: DiscoverySteps = {
    prepare: (threadId, options, signal) => service.prepare(threadId, options, signal),
    rank: (state, store, signal) => service.rank(state, store, signal),
    select: (state) => service.select(state),
    scenario: (state, targetId, store, signal) => service.scenario(state, targetId, store, signal),
    waitForQuota: (marks, signal) => service.waitForQuota(marks, signal),
    validate: (state) => service.validate(state),
    execute: (state, signal) => scenarioRun.execute(state, signal),
    register: (state, store) => scenarioRun.register(state, store),
    conclude: (state) => concludeDiscovery(state, folders, now()),
  };

  const checkpointer = SqliteSaver.fromConnString(folders.checkpoints);
  const store = new SqliteStore(paths.store);
  try {
    const graph = buildDiscoveryGraph(steps).compile({ checkpointer, store });
    return await runDiscovery(command, {
      graph, log, now, signal: interruptSignal(log),
      resolveOptions: (args) => resolveDiscoveryOptions(args, profile, process.env, repositoryRoot),
      certificateProblems: (options) => (options.unattended ? certificateProblems(options.certificates, ["rank", "scenario"], options.agents) : []),
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
