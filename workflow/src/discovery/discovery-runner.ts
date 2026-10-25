import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";
import type { AgentRunners } from "../agents/agent-runners.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import type { Git } from "../diagnosis/source-snapshot.js";
import { threadConfig } from "../graph/run-workflow.js";
import type { HostSteps } from "../host-steps.js";
import type { HostRunner } from "../host/host-runner.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { WorkflowPaths } from "../paths.js";
import { readEnvironmentFingerprint, runCaptureRunner } from "../steps/capture-step.js";
import { captureInputs, changedInputs } from "../steps/input-fingerprints.js";
import { concludeDiscovery } from "./discovery-document.js";
import { buildDiscoveryGraph, type DiscoverySteps } from "./discovery-graph.js";
import { DiscoveryJobs } from "./discovery-jobs.js";
import type { DiscoveryPaths } from "./discovery-paths.js";
import { DiscoveryService, type DiscoveryDependencies } from "./discovery-service.js";
import { pendingJob, type Concluded, type DiscoveryOptions, type DiscoveryStateValue } from "./discovery-state.js";
import type { RegistryPaths } from "./registry.js";
import { ScenarioRun, type ScenarioRunDependencies } from "./scenario-run.js";

export type DiscoveryGraph = ReturnType<ReturnType<typeof buildDiscoveryGraph>["compile"]>;

/** The discovery's work on the host: the capture tools' build, the scenario capture run and the capture inputs it checks. */
export type DiscoveryHost = {
  readonly buildTools: DiscoveryDependencies["buildTools"];
  readonly capture: ScenarioRunDependencies["capture"];
  readonly changedInputs: ScenarioRunDependencies["changedInputs"];
  readonly environment: ScenarioRunDependencies["environment"];
};

/** The discovery's host work through the host runner and its lanes. */
export function hostDiscovery(paths: WorkflowPaths, host: HostRunner, steps: HostSteps, createScratchFolder: (prefix: string, parent?: string) => ScratchFolder): DiscoveryHost {
  return {
    buildTools: (options, signal) => steps.build(options, false, signal),
    capture: (options, cases, signal) => runCaptureRunner({
      paths, host, createScratchFolder, options, selection: { cases, captures: null }, subject: "discovery capture", uiTrees: true, ...(signal === undefined ? {} : { signal }),
    }),
    changedInputs: (options, fingerprints) => changedInputs(paths, options, fingerprints, captureInputs),
    environment: (signal) => readEnvironmentFingerprint(paths, host, createScratchFolder, "environment discovery", signal),
  };
}

export type DiscoveryComposition = {
  readonly repositoryRoot: string;
  readonly paths: WorkflowPaths;
  readonly folders: DiscoveryPaths;
  readonly registry: RegistryPaths;
  readonly git: Git;
  readonly host: DiscoveryHost;
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  /** The discovery threads' checkpointer, apart from the workflow's. */
  readonly checkpointer: BaseCheckpointSaver;
  /** The eval record store. */
  readonly store: BaseStore;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** Where a discovery thread stands in the checkpointer. */
export type DiscoveryThread =
  | { readonly kind: "absent" }
  | { readonly kind: "unfinished"; readonly options: DiscoveryOptions }
  | { readonly kind: "finished"; readonly options: DiscoveryOptions; readonly concluded: Concluded };

/** Starts, resumes and reads discovery threads by ID; every failure is thrown, and an unfinished thread stays resumable. */
export interface DiscoveryRunner {
  readonly graph: DiscoveryGraph;
  thread(threadId: string): Promise<DiscoveryThread>;
  /** Runs a new thread with this ID to its conclusion; a setup error when the ID already has a thread. */
  start(threadId: string, options: DiscoveryOptions, signal?: AbortSignal): Promise<Concluded>;
  /** Continues an unfinished thread to its conclusion; a setup error when there is none or it finished. */
  resume(threadId: string, signal?: AbortSignal): Promise<Concluded>;
  /** The conclusion of a finished thread, without running anything; a setup error when there is none or it is unfinished. */
  read(threadId: string): Promise<Concluded>;
}

function conclusionOf(final: DiscoveryStateValue): Concluded {
  if (final.concluded === null) throw new SetupError(`Discovery thread ${final.threadId} ended without its conclusion.`);
  return final.concluded;
}

/** A runner over a compiled discovery graph. */
export function discoveryRunner(graph: DiscoveryGraph, now: () => Date): DiscoveryRunner {
  const thread = async (threadId: string): Promise<DiscoveryThread> => {
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    const values = snapshot.values as Partial<DiscoveryStateValue>;
    if (snapshot.config.configurable?.["checkpoint_id"] === undefined || values.options === undefined) return { kind: "absent" };
    if (snapshot.next.length > 0) return { kind: "unfinished", options: values.options };
    return { kind: "finished", options: values.options, concluded: conclusionOf(values as DiscoveryStateValue) };
  };
  return {
    graph,
    thread,
    async start(threadId, options, signal) {
      if ((await thread(threadId)).kind !== "absent") throw new SetupError(`Discovery thread ${threadId} already exists; resume it instead.`);
      const input: DiscoveryStateValue = {
        threadId, options, startedUtc: now().toISOString(), prepared: null, rankJob: pendingJob(), selected: null, scenarios: {}, agentMilliseconds: 0,
        execution: null, registered: null, concluded: null,
      };
      return conclusionOf(await graph.invoke(input, threadConfig(threadId, signal)));
    },
    async resume(threadId, signal) {
      const found = await thread(threadId);
      if (found.kind === "absent") throw new SetupError(`There is no discovery thread ${threadId} to resume.`);
      if (found.kind === "finished") throw new SetupError(`Discovery thread ${threadId} already finished; start a new one instead.`);
      return conclusionOf(await graph.invoke(null, threadConfig(threadId, signal)));
    },
    async read(threadId) {
      const found = await thread(threadId);
      if (found.kind === "absent") throw new SetupError(`There is no discovery thread ${threadId} to read.`);
      if (found.kind === "unfinished") throw new SetupError(`Discovery thread ${threadId} has not finished; resume it instead.`);
      return found.concluded;
    },
  };
}

/** The discovery graph's steps: the service, the scenario run and the conclusion over the given host work. */
export function discoverySteps(composition: Omit<DiscoveryComposition, "checkpointer" | "store">): DiscoverySteps {
  const { repositoryRoot, paths, folders, registry, git, host, now, log } = composition;
  const jobs = new DiscoveryJobs({ agents: composition.agents, quota: composition.quota, createScratchFolder: composition.createScratchFolder, now, log });
  const service = new DiscoveryService({ repositoryRoot, paths, folders, registry, git, jobs, buildTools: host.buildTools, now, log });
  const scenarioRun = new ScenarioRun({ repositoryRoot, folders, registry, now, log, capture: host.capture, changedInputs: host.changedInputs, environment: host.environment });
  return {
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
}

/** The discovery's composition: its graph over the host work, compiled with its checkpointer and the record store. */
export function composeDiscovery(composition: DiscoveryComposition): DiscoveryRunner {
  const graph = buildDiscoveryGraph(discoverySteps(composition)).compile({ checkpointer: composition.checkpointer, store: composition.store });
  return discoveryRunner(graph, composition.now);
}
