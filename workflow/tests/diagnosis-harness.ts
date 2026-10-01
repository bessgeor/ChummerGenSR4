import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import type { AgentFailure, AgentJob, AgentResult, AgentRunner } from "../src/agents/agent-job.js";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { finishOutput } from "../src/agents/job-output.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import { DiagnosisService } from "../src/diagnosis/diagnosis-service.js";
import type { ChallengeOutput, HypothesisOutput } from "../src/diagnosis/job-schemas.js";
import { QuotaWaiter, type Sleep } from "../src/diagnosis/quota-waiter.js";
import { processGit } from "../src/diagnosis/source-snapshot.js";
import { buildWorkflowGraph, type WorkflowSteps } from "../src/graph/workflow-graph.js";
import { runWorkflow, type RunDependencies } from "../src/graph/run-workflow.js";
import { SetupError } from "../src/host/setup-error.js";
import type { Arguments } from "../src/options/arguments.js";
import type { CaseDetails } from "../src/steps/case-details.js";
import type { InputFingerprints } from "../src/steps/input-fingerprints.js";
import type { StepOutcome } from "../src/steps/step-outcome.js";
import { plannedCase, readReport, repository, runFolders, scratch, triageDocument, type Spot } from "./diagnosis-fixtures.js";

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

export type JobCall = { readonly kind: string; readonly cluster: string; readonly prompt: string; readonly images: readonly string[]; readonly provider: string };

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** An agent runner that answers from a script and records every job, with the order of starts and ends. */
export class FakeAgents implements AgentRunner {
  readonly calls: JobCall[] = [];
  readonly events: string[] = [];
  running = 0;
  peak = 0;

  constructor(public reply: (call: JobCall, attempt: number) => Reply = (call) => ({ answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() })) {}

  async run<T>(job: AgentJob<T>): Promise<AgentResult<T>> {
    const call: JobCall = { kind: job.kind, cluster: job.label.split(" ")[1]!, prompt: job.prompt, images: job.images, provider: job.choice.provider };
    this.calls.push(call);
    const attempt = this.calls.filter((other) => other.kind === call.kind && other.cluster === call.cluster).length;
    this.events.push(`${job.kind} ${call.cluster} start`);
    this.running++;
    this.peak = Math.max(this.peak, this.running);
    try {
      await delay(15);
      const reply = this.reply(call, attempt);
      if ("hang" in reply) {
        await new Promise((_resolve, reject) => job.signal?.addEventListener("abort", () => reject(new SetupError(`${job.label}: stopped`)), { once: true }));
      }
      const common = { usage: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, costUsd: 0.01 }, durationMs: 1000, sessionId: "s-1" };
      if ("failure" in reply) return { ok: false, failure: reply.failure, ...common };
      const finished = finishOutput(job, (reply as { answer: unknown }).answer);
      return finished.ok ? { ok: true, output: finished.output, ...common } : { ok: false, failure: finished.failure, ...common };
    } finally {
      this.running--;
      this.events.push(`${job.kind} ${call.cluster} end`);
    }
  }
}

const fingerprints: InputFingerprints = {
  canonicalExecutable: "e", canonicalSupport: "s", canonicalSupportStat: "ss", tessdata: "default", candidate: "candidate", overlay: "none", captureTools: "ct", compareTools: "mt",
};

const baseArguments: Arguments = {
  cases: [], captures: [], settingsOverlay: null, threshold: null, caseFile: null, canonicalCache: null,
  liveCanonical: false, noOcr: false, tessdata: null, only: null, recapture: false, noDiagnosis: false,
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
  readonly signal?: AbortSignal;
  readonly extraSteps?: Partial<WorkflowSteps>;
};

/** A workflow whose host steps are fakes over fixture run folders, with the real diagnosis service and fake agents. */
export function diagnosisHarness(options: HarnessOptions) {
  const root = options.root ?? scratch();
  const sourceRepository = repository();
  const folders = runFolders(root, options.spots);
  const cases: PlannedCase[] = [plannedCase(root, "alpha"), plannedCase(root, "beta", "career")];
  const triagePath = join(root, "triage.json");
  const agents = options.agents ?? new FakeAgents();
  const sleeps: number[] = [];
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const steps: WorkflowSteps = {
    build: async () => fingerprints,
    capture: async (_context, item): Promise<StepOutcome> => ({ case: item.name, status: 1, runFolder: folders[item.name] ?? join(root, "runs", item.name), key: "k", reusedFrom: null }),
    compare: async (_context, capture) => capture,
    triage: async (input) => {
      writeFileSync(triagePath, JSON.stringify(triageDocument(input.threadId, options.spots, folders)));
      const clusters = new Set(options.spots.map((spot) => spot.x)).size;
      return { path: triagePath, discrepancies: options.spots.length, clusters, newClusters: clusters, otherFindings: 0 };
    },
    ...options.extraSteps,
  };
  const quota = new QuotaWaiter(options.processId ?? "process-1", options.sleep ?? (async (milliseconds) => {
    sleeps.push(milliseconds);
  }), log);
  const diagnosis = new DiagnosisService({
    repositoryRoot: sourceRepository, threadFolder: (threadId) => join(root, "threads", threadId), agents: () => agents, quota,
    git: processGit(sourceRepository), allCases: () => cases, readReport, now: () => new Date("2026-10-01T12:00:00Z"), log,
  });
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const store = options.store ?? new InMemoryStore();
  const graph = buildWorkflowGraph(steps, diagnosis).compile({ checkpointer, store });
  const settings = resolveAgentSettings({ ...(options.budgetMinutes === undefined ? {} : { runBudgetMinutes: options.budgetMinutes }) });
  const dependencies: RunDependencies = {
    graph,
    resolveOptions: (command) => ({
      caseFile: join(root, "cases.json"), cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: "cache",
      canonicalCacheSource: "default", noOcr: false, tessdata: null, only: command.arguments.only, recapture: false,
      diagnosis: !command.arguments.noDiagnosis, agents: settings,
    }),
    planCases: () => ({ cases: cases.filter((item) => folders[item.name] !== undefined), excluded: [] }),
    readCase: () => details,
    log,
    now: () => new Date("2026-10-01T12:00:00Z"),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return {
    root, agents, sleeps, lines, store, checkpointer, graph,
    start: (overrides: Partial<Arguments> = {}) => runWorkflow({ kind: "start", arguments: { ...baseArguments, ...overrides } }, dependencies),
    resume: (threadId: string) => runWorkflow({ kind: "resume", threadId }, dependencies),
    threadId: () => /Thread (wf-\S+):/.exec(lines.join("\n"))?.[1] ?? "",
    state: async (threadId: string) => (await graph.getState({ configurable: { thread_id: threadId } })).values,
  };
}

export const twoClusters: Spot[] = [
  { case: "build-alpha", capture: "skills", x: 100 },
  { case: "career-beta", capture: "common", x: 400 },
];
