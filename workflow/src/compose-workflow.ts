// The parity workflow composed on this machine: the host, the steps, the services, the workflow graph and its checkpointers.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
import { runWorkflow, type RunDependencies, type RunRequest } from "./graph/run-workflow.js";
import { HostSteps } from "./host-steps.js";
import { CpuPool, defaultCpuPoolSize } from "./host/cpu-pool.js";
import { ProcessHostRunner } from "./host/host-runner.js";
import { hostLanePool } from "./lanes/host-lanes.js";
import { laneDefinitions } from "./lanes/lane-settings.js";
import { startAgentWithRider } from "./lanes/rider-dispatch.js";
import { createScratchFolder } from "./host/scratch-folder.js";
import { processBranchGit } from "./git/branch-git.js";
import { headBranch, integrate } from "./git/integration.js";
import { Worktrees } from "./git/worktrees.js";
import { threadTraces } from "./thread-traces.js";
import { LoopService } from "./loop/loop-service.js";
import type { Command } from "./options/arguments.js";
import { localDataFolder, type Profile } from "./options/profile.js";
import { resolveRunOptions } from "./options/run-options.js";
import { threadSuite } from "./cases/suite.js";
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

/** The workflow composed once: it runs or resumes threads, one after another, until it is closed. */
export type ComposedWorkflow = {
  /** Runs or resumes a thread as `npm start` does and returns its exit status; a start given `request.threadId` runs its new thread under that ID. */
  readonly run: (command: Exclude<Command, { kind: "help" }>, request?: RunRequest) => Promise<number>;
  /** Closes the store and the checkpoint databases. */
  readonly close: () => void;
};

/** Composes the workflow of `npm start` for the repository; `signal` aborts the running steps of a thread (Ctrl+C). */
export function composeWorkflow(repositoryRoot: string, profile: Profile, log: (line: string) => void, signal?: AbortSignal): ComposedWorkflow {
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
      environment: (environmentSignal) => readEnvironmentFingerprint(paths, host, createScratchFolder, "environment widening", environmentSignal),
      // The levels run widened builds, so the thread's candidate folder is not an input of theirs.
      changed: (options, fingerprints) => changedInputs(paths, options, fingerprints, captureInputs.filter((name) => name !== "candidate")),
    },
  });

  const checkpointer = SqliteSaver.fromConnString(paths.checkpoints);
  // A thread's discovery is a discovery thread like those of npm run discover, in their checkpointer and folders.
  const folders = discoveryPaths(repositoryRoot);
  let store: SqliteStore | undefined;
  let discoveryCheckpointer: SqliteSaver | undefined;
  const close = () => {
    store?.close();
    checkpointer.db.close();
    discoveryCheckpointer?.db.close();
  };
  try {
    store = new SqliteStore(paths.store);
    mkdirSync(folders.root, { recursive: true });
    discoveryCheckpointer = SqliteSaver.fromConnString(folders.checkpoints);
    const discovery = new RunnerDiscovery(composeDiscovery({
      repositoryRoot, paths, folders, registry: registryPaths(repositoryRoot), git: processGit(repositoryRoot), host: hostDiscovery(paths, host, steps, createScratchFolder),
      agents, quota, createScratchFolder, checkpointer: discoveryCheckpointer, store, now, log,
    }), log);
    const loop = new LoopService({ threadFolder: paths.threadFolder, integrate: (request) => integrate(branchGit, worktrees, request), now });
    const graph = buildWorkflowGraph(steps, diagnosis, repair, widening, loop, discovery).compile({ checkpointer, store });
    const dependencies: RunDependencies = {
      graph,
      resolveOptions: (start) => resolveRunOptions(start.arguments, profile, process.env, repositoryRoot),
      prepareThread: (start, options, threadId) => threadSuite(start.arguments, options, repositoryRoot, paths.threadFolder(threadId)),
      planCases: (options) => planCases(options.caseFile, options.cases, options.captures),
      readCase: readCaseDetails,
      certificateProblems: unattendedProblems,
      head: () => headBranch(branchGit),
      threadTraces: (threadId) => threadTraces({
        threadFolder: paths.threadFolder, discoveryThreadFolder: (id) => folders.thread(id).root, git: branchGit,
      }, threadId),
      log,
      now,
      ...(signal === undefined ? {} : { signal }),
    };
    return { run: (command, request = {}) => runWorkflow(command, dependencies, request), close };
  } catch (error) {
    close();
    throw error;
  }
}
