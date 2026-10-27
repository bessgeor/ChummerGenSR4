// Composition root of the parity workflow: `npm start -- <options>` runs or resumes a thread of the graph
// build → capture → compare → triage → inventory → discovery or diagnosis → repair → widening and exits with 0, 1, 2 or 3 (see --help).
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { agentRunners } from "./agents/agent-runners.js";
import { planCases } from "./cases/case-plan.js";
import { hostCheckCapture } from "./diagnosis/check-capture.js";
import { DiagnosisService } from "./diagnosis/diagnosis-service.js";
import { unattendedProblems } from "./evals/certificate.js";
import { fixesRootOf, openSpecArchiver, processOpenSpecCli } from "./fixes/fix-archiver.js";
import { QuotaWaiter } from "./diagnosis/quota-waiter.js";
import { processGit } from "./diagnosis/source-snapshot.js";
import { discoveryPaths } from "./discovery/discovery-paths.js";
import { composeDiscovery, hostDiscovery } from "./discovery/discovery-runner.js";
import { registryPaths } from "./discovery/registry.js";
import { RunnerDiscovery } from "./discovery/thread-discovery.js";
import { buildWorkflowGraph } from "./graph/workflow-graph.js";
import { runWorkflow, setupErrorStatus } from "./graph/run-workflow.js";
import { HostSteps } from "./host-steps.js";
import { CpuPool, defaultCpuPoolSize } from "./host/cpu-pool.js";
import { ProcessHostRunner } from "./host/host-runner.js";
import { hostLanePool } from "./lanes/host-lanes.js";
import { laneDefinitions } from "./lanes/lane-settings.js";
import { startAgentWithRider } from "./lanes/rider-dispatch.js";
import { interruptSignal } from "./host/interrupt-signal.js";
import { createScratchFolder } from "./host/scratch-folder.js";
import { SetupError } from "./host/setup-error.js";
import { processBranchGit } from "./git/branch-git.js";
import { Worktrees } from "./git/worktrees.js";
import { LoopService } from "./loop/loop-service.js";
import { parseArguments, usage } from "./options/arguments.js";
import { loadProfile, localDataFolder } from "./options/profile.js";
import { startOptions } from "./cases/suite.js";
import { workflowPaths } from "./paths.js";
import { hostAttemptBuild, hostNarrowCheck } from "./repair/attempt-host.js";
import { RepairService } from "./repair/repair-service.js";
import { CaptureStep, readEnvironmentFingerprint } from "./steps/capture-step.js";
import { CompareStep, reportPath } from "./steps/compare-step.js";
import { readCaseDetails } from "./steps/case-details.js";
import { readDocument } from "./steps/read-document.js";
import { CompareReportSchema } from "../../contracts/generated/typescript/parity-compare-report.js";
import { captureInputs, changedInputs } from "./steps/input-fingerprints.js";
import { StepStore } from "./steps/step-store.js";
import { SqliteStore } from "./store/sqlite-store.js";
import { hostLevelCapture } from "./widening/level-capture.js";
import { WideningService } from "./widening/widening-service.js";

// An unexpected error must not end with Node's status 1, which would read as visual differences.
process.on("uncaughtException", (error) => {
  console.error(`npm start failed: ${error.stack ?? String(error)}`);
  process.exit(setupErrorStatus);
});

async function main(): Promise<number> {
  const log = (line: string) => console.log(line);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let command;
  let profile;
  try {
    command = parseArguments(process.argv.slice(2));
    if (command.kind === "help") {
      log(usage);
      return 0;
    }
    profile = loadProfile(process.env);
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Setup error: ${error.message}`);
    return setupErrorStatus;
  }

  const paths = workflowPaths(repositoryRoot);
  mkdirSync(paths.workflowFolder, { recursive: true });
  const now = () => new Date();
  const lanes = hostLanePool(laneDefinitions(profile.lanes), localDataFolder(process.env), log, startAgentWithRider);
  const host = new ProcessHostRunner(repositoryRoot, lanes, new CpuPool(profile.cpuPool ?? defaultCpuPoolSize()),
    (text) => process.stdout.write(text));
  const stepStore = new StepStore(paths.steps);
  const steps = new HostSteps(paths, host,
    new CaptureStep({ paths, host, store: stepStore, log, now, createScratchFolder, changedInputs }),
    new CompareStep({ paths, host, store: stepStore, log, now, changedInputs }), stepStore, now, createScratchFolder);

  // Diagnosis and repair share the model pools and the count of quota waits.
  const agents = agentRunners(process.env);
  const quota = new QuotaWaiter(randomBytes(8).toString("hex"), undefined, log);
  const diagnosis = new DiagnosisService({
    repositoryRoot, threadFolder: paths.threadFolder, agents, quota,
    git: processGit(repositoryRoot), allCases: (caseFile) => planCases(caseFile, [], []).cases,
    readReport: (runFolder) => readDocument(join(runFolder, reportPath), CompareReportSchema),
    checkCapture: hostCheckCapture(paths, host, createScratchFolder), createScratchFolder, now, log,
  });
  const branchGit = processBranchGit(repositoryRoot);
  const worktrees = new Worktrees(branchGit, repositoryRoot);
  const repair = new RepairService({
    threadFolder: paths.threadFolder, agents, quota, build: hostAttemptBuild(paths, host), narrowCheck: hostNarrowCheck(paths, host, createScratchFolder),
    createScratchFolder, git: branchGit, worktrees, now, log,
  });

  const widening = new WideningService({
    threadFolder: paths.threadFolder, build: hostAttemptBuild(paths, host), capture: hostLevelCapture(paths, host, createScratchFolder),
    allCases: (caseFile) => planCases(caseFile, [], []).cases, git: branchGit, worktrees, now, log,
    fixes: { root: fixesRootOf(repositoryRoot), archive: openSpecArchiver(processOpenSpecCli(repositoryRoot)) },
    inputs: {
      environment: (signal) => readEnvironmentFingerprint(paths, host, createScratchFolder, "environment widening", signal),
      // The levels run widened builds, so the thread's candidate folder is not an input of theirs.
      changed: (options, fingerprints) => changedInputs(paths, options, fingerprints, captureInputs.filter((name) => name !== "candidate")),
    },
  });

  const checkpointer = SqliteSaver.fromConnString(paths.checkpoints);
  const store = new SqliteStore(paths.store);
  // A thread's discovery is a discovery thread like those of npm run discover, in their checkpointer and folders.
  const folders = discoveryPaths(repositoryRoot);
  mkdirSync(folders.root, { recursive: true });
  const discoveryCheckpointer = SqliteSaver.fromConnString(folders.checkpoints);
  try {
    const discovery = new RunnerDiscovery(composeDiscovery({
      repositoryRoot, paths, folders, registry: registryPaths(repositoryRoot), git: processGit(repositoryRoot), host: hostDiscovery(paths, host, steps, createScratchFolder),
      agents, quota, createScratchFolder, checkpointer: discoveryCheckpointer, store, now, log,
    }), log);
    const graph = buildWorkflowGraph(steps, diagnosis, repair, widening, new LoopService({ threadFolder: paths.threadFolder, now }), discovery).compile({ checkpointer, store });
    return await runWorkflow(command, {
      graph,
      resolveOptions: (start, threadId) => startOptions(start.arguments, profile, process.env, repositoryRoot, paths.threadFolder(threadId)),
      planCases: (options) => planCases(options.caseFile, options.cases, options.captures),
      readCase: readCaseDetails,
      certificateProblems: unattendedProblems,
      log,
      now,
      signal: interruptSignal(log),
    });
  } finally {
    store.close();
    checkpointer.db.close();
    discoveryCheckpointer.db.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm start failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
