import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { notStarted, type AgentFailure, type AgentJob, type AgentResult, type AgentRunner, type NotStarted } from "../src/agents/agent-job.js";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { finishOutput } from "../src/agents/job-output.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import type { CheckCapture, CheckCaptureRequest } from "../src/diagnosis/check-capture.js";
import { DiagnosisService } from "../src/diagnosis/diagnosis-service.js";
import { unattendedProblems } from "../src/evals/certificate.js";
import type { ChallengeOutput, HypothesisOutput } from "../src/diagnosis/job-schemas.js";
import { QuotaWaiter, type Sleep } from "../src/diagnosis/quota-waiter.js";
import { compiledSourceIdentity, processGit } from "../src/diagnosis/source-snapshot.js";
import { buildWorkflowGraph, type WorkflowSteps } from "../src/graph/workflow-graph.js";
import { runWorkflow, type RunDependencies } from "../src/graph/run-workflow.js";
import type { WorkflowStateValue } from "../src/graph/workflow-state.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import type { Arguments } from "../src/options/arguments.js";
import type { CaseDetails } from "../src/steps/case-details.js";
import type { InputFingerprints } from "../src/steps/input-fingerprints.js";
import type { StepOutcome } from "../src/steps/step-outcome.js";
import { RepairService } from "../src/repair/repair-service.js";
import { FakeRepairHost } from "./repair-fixtures.js";
import { FakeWideningHost } from "./widening-fixtures.js";
import { captureNames } from "../src/cases/case-plan.js";
import { processBranchGit, type BranchGit } from "../src/git/branch-git.js";
import { Worktrees } from "../src/git/worktrees.js";
import { headBranch, integrate } from "../src/git/integration.js";
import { WideningService, type WideningDependencies } from "../src/widening/widening-service.js";
import { LoopService } from "../src/loop/loop-service.js";
import { fixesRootOf, openSpecArchiver, processOpenSpecCli, type FixChangeArchiver } from "../src/fixes/fix-archiver.js";
import { plannedCase, readReport, repository, runFolders, scratch, triageDocument, type Spot } from "./diagnosis-fixtures.js";
import type { DispatchedTuning } from "../src/tuning/tuning.js";
import { noDiscovery } from "./thread-discovery-fixtures.js";

export const hypothesisAnswer = (claim = "The Skills tab label moved in frmCreate."): HypothesisOutput => ({
  outcome: "hypothesis", reason: "The crops show a shifted label.",
  explanation: {
    claim, mechanism: "layout", locations: [{ path: "Chummer/frmCreate.cs", symbol: "frmCreate", line: 1 }],
    evidence: "The candidate crop shows the label further right.", confidence: 0.7,
    predictions: [
      { case: "build-alpha", capture: "skills", expect: "differs", why: "The moved label is on the Skills tab." },
      { case: "career-beta", capture: "common", expect: "matches", why: "The career form is not affected." },
    ],
  },
});

export const challengeAnswer = (): ChallengeOutput => ({
  outcome: "alternative", reason: "The data file could also change the label's width.",
  alternative: {
    claim: "The skills data changed the label text.", mechanism: "data", locations: [{ path: "bin/data/skills.xml", symbol: null, line: 1 }],
    evidence: "OCR differs.", confidence: 0.3,
    predictions: [{ case: "career-beta", capture: "common", expect: "differs", why: "Both forms read the same data." }],
  },
});

/** What the fake agent does for a job: answer (validated like a real adapter), fail, or run until the run stops. */
export type Reply = { readonly answer: unknown } | { readonly failure: AgentFailure } | { readonly hang: true };

export type JobCall = {
  readonly kind: string; readonly cluster: string;
  /** The cluster's hypothesis a diagnosis job is for, from its label: 1 unless the label names another. */
  readonly variant: number;
  readonly prompt: string; readonly images: readonly string[]; readonly provider: string;
  /** The job's folders and what they held while the job ran. */
  readonly workspace: { readonly folder: string; readonly readOnly: readonly string[]; readonly contextFiles: readonly string[]; readonly snapshotFiles: readonly string[] };
};

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * An agent runner that answers from a script and records every job, with the order of starts and ends. Like the
 * pooled runner it runs at most `poolSize` jobs at a time and asks each job `mayStart` when it gets its place.
 */
export class FakeAgents implements AgentRunner {
  readonly calls: JobCall[] = [];
  readonly events: string[] = [];
  /** For each job `mayStart` refused: whether a copy of its folders existed anyway. */
  readonly refusedWithCopy: boolean[] = [];
  running = 0;
  peak = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    public reply: (call: JobCall, attempt: number) => Reply = (call) => ({ answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() }),
    private readonly poolSize = Number.POSITIVE_INFINITY,
    /** The duration each job reports. */
    private readonly durationMs = 1000,
  ) {}

  private async place(): Promise<void> {
    if (this.running >= this.poolSize) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.running++;
  }

  private release(): void {
    const next = this.queue.shift();
    if (next === undefined) this.running--;
    else next();
  }

  async run<T>(job: AgentJob<T>): Promise<AgentResult<T> | NotStarted> {
    await this.place();
    this.peak = Math.max(this.peak, this.running);
    if (job.mayStart?.() === false) {
      this.refusedWithCopy.push(existsSync(job.workspace.folder) || (job.workspace.readOnly[0] !== undefined && existsSync(job.workspace.readOnly[0])));
      this.release();
      return notStarted;
    }
    const call: JobCall = {
      kind: job.kind, cluster: job.label.split(" ")[1]!, variant: Number(/ #(\d+)$/.exec(job.label)?.[1] ?? 1), prompt: job.prompt, images: job.images, provider: job.choice.provider,
      workspace: { ...job.workspace, contextFiles: readdirSync(job.workspace.folder), snapshotFiles: job.workspace.readOnly[0] === undefined ? [] : readdirSync(job.workspace.readOnly[0]) },
    };
    this.calls.push(call);
    const attempt = this.calls.filter((other) => other.kind === call.kind && other.cluster === call.cluster && other.variant === call.variant).length;
    this.events.push(`${job.label} start`);
    try {
      await delay(15);
      const reply = this.reply(call, attempt);
      if ("hang" in reply) {
        await new Promise((_resolve, reject) => job.signal?.addEventListener("abort", () => reject(new SetupError(`${job.label}: stopped`)), { once: true }));
      }
      const common = { usage: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, costUsd: 0.01 }, durationMs: this.durationMs, sessionId: "s-1" };
      if ("failure" in reply) {
        const failed: AgentResult<T> = { ok: false, failure: reply.failure, ...common };
        job.onResult?.(failed);
        return failed;
      }
      const finished = finishOutput(job, (reply as { answer: unknown }).answer);
      const result: AgentResult<T> = finished.ok ? { ok: true, output: finished.output, ...common } : { ok: false, failure: finished.failure, ...common };
      job.onResult?.(result);
      return result;
    } finally {
      this.release();
      this.events.push(`${job.label} end`);
    }
  }
}

const fingerprints = (candidateSource: string): InputFingerprints => ({
  canonicalExecutable: "e", canonicalSupport: "s", canonicalSupportStat: "ss", tessdata: "default", candidate: "candidate", overlay: "none", captureTools: "ct", compareTools: "mt", candidateSource, environment: "environment-1",
});

const baseArguments: Arguments = {
  cases: [], captures: [], settingsOverlay: null, threshold: null, caseFile: null, canonicalCache: null,
  liveCanonical: false, noOcr: false, tessdata: null, only: null, recapture: false, noDiagnosis: false, noRepair: false, noWidening: false, noDiscovery: false, unattended: false, fixChanges: false,
};

const details: CaseDetails = {
  execution: { coverageValid: true, invalidReasons: [], contiguous: true, failures: 0, optionalAbsent: 0, canonicalSource: "live" },
  visual: { passed: 0, failed: 1, report: null },
};

export type HarnessOptions = {
  readonly spots: readonly Spot[];
  readonly agents?: FakeAgents;
  readonly checkpointer?: MemorySaver;
  readonly store?: InMemoryStore;
  readonly processId?: string;
  readonly sleep?: Sleep;
  readonly budgetMinutes?: number;
  readonly root?: string;
  /** The fixture repository the candidate is built from; by default a new one. */
  readonly repository?: string;
  readonly signal?: AbortSignal;
  readonly extraSteps?: Partial<WorkflowSteps>;
  /** What the check capture observes per `case/capture`; anything not named passes. */
  readonly observed?: Readonly<Record<string, "passed" | "failed" | "missing-candidate" | "missing">>;
  readonly checkStatus?: 0 | 1 | 2;
  /** Makes the scratch folders of the model jobs; by default real ones. */
  readonly createScratchFolder?: typeof createScratchFolder;
  /** The compiled-source identity the candidate's build recorded; by default that of the fixture repository when the build step runs. */
  readonly candidateSource?: string;
  /** Runs after triage, before diagnosis, with the fixture repository's folder: an edit made between the build and the diagnosis. */
  readonly afterTriage?: (repository: string) => void;
  /** How many hypotheses each cluster gets; a new thread's options lack the field when absent, like a thread stored before it existed. */
  readonly hypotheses?: number;
  /** The active configurations a new thread stores in its options. */
  readonly tuning?: DispatchedTuning;
  /** Turns repair on (it is off by default here), with this deadline and fake host for builds and narrow checks. */
  readonly repair?: { readonly deadlineMinutes: number; readonly maxAttempts?: number; readonly host: (root: string) => FakeRepairHost };
  /**
   * Turns widening on (with repair; off by default here), with a fake host for builds and captures, more build cases
   * for the case file, and a wrapper around the git of the accepted branch.
   */
  readonly widening?: {
    readonly host: (root: string, captureNames: (caseName: string) => readonly string[]) => FakeWideningHost;
    readonly extraCases?: readonly string[];
    readonly git?: (git: BranchGit) => BranchGit;
    /** The environment and changed-input checks; by default nothing ever changes. */
    readonly inputs?: WideningDependencies["inputs"];
    /** The fix change archiver; by default the real OpenSpec CLI with this checkout's fixes root. */
    readonly archive?: FixChangeArchiver;
  };
  /** Runs when the thread concludes, before its fixes are merged, with the fixture repository's folder. */
  readonly beforeMerge?: (repository: string) => void;
};

/** A workflow whose host steps are fakes over fixture run folders, with the real diagnosis service and fake agents. */
export function diagnosisHarness(options: HarnessOptions) {
  const root = options.root ?? scratch();
  const sourceRepository = options.repository ?? repository();
  const folders = runFolders(root, options.spots);
  const cases: PlannedCase[] = [plannedCase(root, "alpha"), plannedCase(root, "beta", "career")];
  const triagePath = join(root, "triage.json");
  const agents = options.agents ?? new FakeAgents();
  const sleeps: number[] = [];
  const lines: string[] = [];
  /** The threads whose start got as far as writing what the thread needs. */
  const prepared: string[] = [];
  const log = (line: string) => lines.push(line);
  const steps: WorkflowSteps = {
    captureLanes: 1,
    // The build records the compiled source it started from; by default that is the fixture repository as it is now.
    build: async () => fingerprints(options.candidateSource ?? await compiledSourceIdentity(sourceRepository, processGit(sourceRepository))),
    capture: async (_context, item): Promise<StepOutcome> => ({ case: item.name, status: 1, runFolder: folders[item.name] ?? join(root, "runs", item.name), key: "k", reusedFrom: null }),
    compare: async (_context, capture) => capture,
    triage: async (input) => {
      options.afterTriage?.(sourceRepository);
      writeFileSync(triagePath, JSON.stringify(triageDocument(input.threadId, options.spots, folders)));
      const clusters = new Set(options.spots.map((spot) => spot.x)).size;
      return { path: triagePath, discrepancies: options.spots.length, clusters, newClusters: clusters, otherFindings: 0 };
    },
    inventory: async () => ({
      folder: join(root, "inventory"), classes: 1, activeClasses: 1, controls: { active: 0, observed: 0 }, interactions: { active: 0, exercised: 0 },
      tuples: { planned: 0, observed: 0 }, unresolved: 0,
    }),
    ...options.extraSteps,
  };
  const checks: CheckCaptureRequest[] = [];
  const reportReads: string[] = [];
  const checkCapture: CheckCapture = async (request) => {
    checks.push(request);
    const runFolder = join(root, "check-runs", String(checks.length));
    mkdirSync(runFolder, { recursive: true });
    const observed = options.observed ?? defaultObserved;
    const results = request.cases.flatMap((name) => request.captures.flatMap((capture) => {
      const value = observed[`${name}/${capture}`] ?? "passed";
      if (value === "missing") return [];
      return [{
        case: name, characterFile: `${name}.chum`, mode: "build" as const, capture, passed: value === "passed",
        reason: value === "passed" ? "within-threshold" as const : value === "failed" ? "visual-difference" as const : "missing-candidate" as const,
        difference: value === "passed" ? 0 : 0.01,
      }];
    }));
    writeFileSync(join(runFolder, "results.json"), JSON.stringify({ runId: "check", threshold: 0.00004, results }));
    const coverage = JSON.parse(readFileSync(join(examples, "parity-execution-coverage.example.json"), "utf8")) as { valid: boolean; invalidReasons: string[] };
    // The example coverage is invalid; a check run is valid unless it ends with execution failures.
    coverage.valid = options.checkStatus !== 2;
    coverage.invalidReasons = options.checkStatus === 2 ? ["an action failed"] : [];
    writeFileSync(join(runFolder, "coverage.json"), JSON.stringify(coverage));
    return { status: options.checkStatus ?? (results.some((row) => !row.passed) ? 1 : 0), runFolder };
  };
  const quota = new QuotaWaiter(options.processId ?? "process-1", options.sleep ?? (async (milliseconds) => {
    sleeps.push(milliseconds);
  }), log);
  const diagnosis = new DiagnosisService({
    repositoryRoot: sourceRepository, threadFolder: (threadId) => join(root, "threads", threadId), agents: () => agents, quota,
    git: processGit(sourceRepository), allCases: () => cases, readReport: (runFolder) => {
      reportReads.push(runFolder);
      return readReport(runFolder);
    }, checkCapture, createScratchFolder: options.createScratchFolder ?? createScratchFolder, now: () => new Date("2026-10-01T12:00:00Z"), log,
  });
  const repairHost = options.repair?.host(root) ?? new FakeRepairHost(root);
  const plainGit = processBranchGit(sourceRepository);
  const branchGit = options.widening?.git?.(plainGit) ?? plainGit;
  const worktrees = new Worktrees(branchGit, sourceRepository);
  const repair = new RepairService({
    threadFolder: (threadId) => join(root, "threads", threadId), agents: () => agents, quota, build: repairHost.build, narrowCheck: repairHost.narrowCheck,
    createScratchFolder: options.createScratchFolder ?? createScratchFolder, git: branchGit, worktrees, now: () => new Date(), log,
  });
  const allCases = [...cases, ...(options.widening?.extraCases ?? []).map((name) => plannedCase(root, name))];
  const caseCaptures = (caseName: string) => captureNames(allCases.find((item) => item.name === caseName)!);
  const wideningHost = options.widening?.host(root, caseCaptures) ?? new FakeWideningHost(root, caseCaptures);
  const widening = new WideningService({
    threadFolder: (threadId) => join(root, "threads", threadId), build: wideningHost.build, capture: wideningHost.capture, allCases: () => allCases,
    git: branchGit, worktrees, now: () => new Date("2026-10-01T13:00:00Z"), log,
    // The fixture repository has no fixes root; the real one of this checkout holds the schema.
    fixes: { root: fixesRootOf(fixesRepository), archive: options.widening?.archive ?? openSpecArchiver(processOpenSpecCli(fixesRepository)) },
    inputs: options.widening?.inputs ?? { environment: async () => "environment-1", changed: async () => [] },
  });
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const store = options.store ?? new InMemoryStore();
  const loop = new LoopService({
    threadFolder: (threadId) => join(root, "threads", threadId), now: () => new Date("2026-10-01T14:00:00Z"),
    integrate: (request) => {
      options.beforeMerge?.(sourceRepository);
      return integrate(branchGit, worktrees, request);
    },
  });
  const graph = buildWorkflowGraph(steps, diagnosis, repair, widening, loop, noDiscovery).compile({ checkpointer, store });
  const settings = resolveAgentSettings({ ...(options.budgetMinutes === undefined ? {} : { runBudgetMinutes: options.budgetMinutes }) });
  const dependencies: RunDependencies = {
    graph,
    resolveOptions: (command) => ({
      caseFile: join(root, "cases.json"), cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: "cache",
      canonicalCacheSource: "default", noOcr: false, tessdata: null, only: command.arguments.only, recapture: false,
      diagnosis: !command.arguments.noDiagnosis, agents: settings, unattended: command.arguments.unattended, certificates: join(root, "certificates"),
      repair: options.repair === undefined || command.arguments.noRepair ? null : { deadlineMinutes: options.repair.deadlineMinutes, maxAttempts: options.repair.maxAttempts ?? 1 },
      widening: options.repair !== undefined && options.widening !== undefined && !command.arguments.noRepair && !command.arguments.noWidening,
      fixChanges: command.arguments.fixChanges, ...(options.hypotheses === undefined ? {} : { hypotheses: options.hypotheses }), ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
    }),
    prepareThread: (_command, resolved, threadId) => {
      prepared.push(threadId);
      return resolved;
    },
    planCases: () => ({ cases: cases.filter((item) => folders[item.name] !== undefined), excluded: [] }),
    readCase: () => details,
    certificateProblems: unattendedProblems,
    threadTraces: () => [],
    head: () => headBranch(plainGit),
    log,
    now: () => new Date("2026-10-01T12:00:00Z"),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return {
    root, agents, sleeps, checks, reportReads, lines, prepared, store, checkpointer, graph, repairHost, wideningHost, sourceRepository,
    start: (overrides: Partial<Arguments> = {}) => runWorkflow({ kind: "start", arguments: { ...baseArguments, ...overrides } }, dependencies),
    resume: (threadId: string) => runWorkflow({ kind: "resume", threadId }, dependencies),
    threadId: () => /Thread (wf-\S+):/.exec(lines.join("\n"))?.[1] ?? "",
    /** The thread's latest state: a thread stopped inside a stage holds it in that stage's checkpoint. */
    state: async (threadId: string) => {
      const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
      const stage = snapshot.tasks[0];
      if (stage === undefined) return snapshot.values as WorkflowStateValue;
      const inner = await graph.getState({ configurable: { thread_id: threadId, checkpoint_ns: `${stage.name}:${stage.id}` } });
      return (inner.config.configurable?.["checkpoint_id"] === undefined ? snapshot : inner).values as WorkflowStateValue;
    },
  };
}

const examples = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "examples");

/** This checkout, whose `fixes/` root holds the `fix` schema and whose node_modules hold the OpenSpec CLI. */
const fixesRepository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The hypothesis's predictions hold and the alternative's does not. */
const defaultObserved: Readonly<Record<string, "passed" | "failed" | "missing-candidate" | "missing">> = { "build-alpha/skills": "failed", "career-beta/common": "passed" };

export const twoClusters: Spot[] = [
  { case: "build-alpha", capture: "skills", x: 100 },
  { case: "career-beta", capture: "common", x: 400 },
];
