import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { CompareReport } from "../../../contracts/generated/typescript/parity-compare-report.js";
import type { AgentResult, AgentRunner, JobKind } from "../agents/agent-job.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { PlannedCase } from "../cases/case-plan.js";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { ExecutionCoverageSchema } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import { labelRecord, putRecord, recordNamespace, type EvalRecord } from "../evals/eval-record.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import { readDocument } from "../steps/read-document.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";
import { judge, observe, planCheck, type CheckResult, type ClusterCheck } from "./check.js";
import type { CheckCapture } from "./check-capture.js";
import type { ClusterDiagnosis, ClusterUpdate, QuotaWaitMark } from "./cluster-diagnosis.js";
import { diagnosisDocument, writeDiagnosisDocument } from "./diagnosis-document.js";
import { ContextManifestSchema, contextHash, sealContext, type ContextManifest } from "./context.js";
import {
  ChallengeOutputSchema, challengePromptVersion, HypothesisOutputSchema, hypothesisPromptVersion,
  type ChallengeOutput, type Explanation, type HypothesisOutput,
} from "./job-schemas.js";
import { challengePrompt, hypothesisPrompt } from "./prompts.js";
import type { QuotaWaiter } from "./quota-waiter.js";
import { createSourceSnapshot, type Git } from "./source-snapshot.js";
import { validateChallenge, validateHypothesis } from "./validation.js";

/** Where a thread's diagnosis lives: the snapshot, a context folder per cluster, and the agents' logs. */
export function diagnosisFolders(threadFolder: string) {
  const root = join(threadFolder, "diagnosis");
  return { root, source: join(root, "source"), logs: join(root, "logs"), cluster: (id: string) => join(root, id) };
}

export type DiagnosisDependencies = {
  readonly repositoryRoot: string;
  readonly threadFolder: (threadId: string) => string;
  /** The agent runner for a thread's agent settings; one runner (and model pool) per settings. */
  readonly agents: (settings: AgentSettings) => AgentRunner;
  readonly quota: QuotaWaiter;
  readonly git: Git;
  /** Every case of a case file, unfiltered: the check vocabulary. */
  readonly allCases: (caseFile: string) => readonly PlannedCase[];
  readonly readReport: (runFolder: string) => CompareReport;
  readonly checkCapture: CheckCapture;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

export type PrepareInput = { readonly threadId: string; readonly triagePath: string; readonly caseFile: string; readonly candidate: string };

export type JobInput = {
  readonly threadId: string;
  readonly options: RunOptions;
  readonly cluster: ClusterDiagnosis;
  /** Model time the thread's finished jobs used, in milliseconds. */
  readonly spentMs: number;
  readonly signal?: AbortSignal;
};

export type CheckInput = {
  readonly options: RunOptions;
  readonly clusters: Readonly<Record<string, ClusterDiagnosis>>;
  readonly signal?: AbortSignal;
};

/** A job node's result: the cluster's change and the model time to charge to the run budget. */
export type JobStep = { readonly update: ClusterUpdate; readonly chargedMs: number };

/** Diagnosis on the real host: contexts, model jobs with their records, and quota waits. */
export class DiagnosisService {
  constructor(private readonly dependencies: DiagnosisDependencies) {}

  /** Takes the source snapshot and seals one context per triage cluster; no cluster needs no snapshot. */
  async prepare(input: PrepareInput): Promise<Record<string, ClusterDiagnosis>> {
    const triage = readDocument(input.triagePath, TriageDocumentSchema);
    if (triage.clusters.length === 0) return {};
    const folders = diagnosisFolders(this.dependencies.threadFolder(input.threadId));
    const snapshot = await createSourceSnapshot(this.dependencies.repositoryRoot, folders.source, this.dependencies.git);
    this.dependencies.log(`Diagnosis: source snapshot of ${snapshot.files} files at ${snapshot.commit.slice(0, 12)}; ${triage.clusters.length} clusters.`);
    const cases = this.dependencies.allCases(input.caseFile);
    const clusters: Record<string, ClusterDiagnosis> = {};
    for (const cluster of triage.clusters) {
      const sealed = await sealContext({ triage, clusterId: cluster.id, cases, readReport: this.dependencies.readReport, snapshot, candidate: input.candidate },
        folders.cluster(cluster.id));
      clusters[cluster.id] = {
        clusterId: cluster.id, contextFolder: sealed.folder, contextHash: sealed.hash, status: "pending",
        hypothesis: null, challenge: null, waiting: null, failure: null, records: [],
      };
    }
    return clusters;
  }

  hypothesize(input: JobInput, store: BaseStore): Promise<JobStep> {
    return this.runJob("hypothesis", input, store);
  }

  challenge(input: JobInput, store: BaseStore): Promise<JobStep> {
    return this.runJob("challenge", input, store);
  }

  /** Waits for the usage limit of the marked jobs; they run again afterwards. */
  async waitForQuota(marks: readonly QuotaWaitMark[], signal?: AbortSignal): Promise<void> {
    await this.dependencies.quota.wait(marks.map((mark) => mark.processId), signal);
  }

  /** Captures every predicted case and capture in one run, judges each challenged cluster and labels its records. */
  async check(input: CheckInput, store: BaseStore): Promise<CheckResult> {
    const plan = planCheck(input.clusters);
    if (plan === null) throw new Error("The diagnosis check ran without a prediction.");
    this.dependencies.log(`Diagnosis check: one capture of ${plan.cases.join(", ")} (${plan.captures.join(", ")}) for ${plan.checked.length} clusters.`);
    const run = await this.dependencies.checkCapture({ cases: plan.cases, captures: plan.captures, options: input.options, ...(input.signal === undefined ? {} : { signal: input.signal }) });
    const results = readDocument(join(run.runFolder, "results.json"), CaptureResultsSchema);
    const coverage = readDocument(join(run.runFolder, "coverage.json"), ExecutionCoverageSchema);
    const predicted = new Map<string, { case: string; capture: string }>();
    for (const id of plan.checked) {
      const cluster = input.clusters[id]!;
      for (const prediction of [...(cluster.hypothesis?.output.explanation?.predictions ?? []), ...(cluster.challenge?.output.alternative?.predictions ?? [])]) {
        predicted.set(`${prediction.case}/${prediction.capture}`, prediction);
      }
    }
    const observations = [...predicted.values()].map((item) => observe(results, item.case, item.capture));
    const clusters: Record<string, ClusterCheck> = {};
    for (const id of plan.checked) {
      const cluster = input.clusters[id]!;
      const checked = judge(cluster, observations);
      clusters[id] = checked;
      for (const answer of [cluster.hypothesis, cluster.challenge]) {
        if (answer !== null) await labelRecord(store, answer.recordId.includes("/hypothesis/") ? "hypothesis" : "challenge", answer.recordId, checked.outcome);
      }
      this.dependencies.log(`Diagnosis check: ${id} ${checked.outcome}.`);
    }
    return {
      runFolder: run.runFolder, cases: plan.cases, captures: plan.captures,
      execution: { status: run.status, coverageValid: coverage.valid, invalidReasons: coverage.invalidReasons, failures: coverage.totals.failures },
      observations, clusters,
    };
  }

  /** Writes the thread's `diagnosis.json` and returns its path. */
  finish(threadId: string, clusters: Readonly<Record<string, ClusterDiagnosis>>, check: CheckResult | null): string {
    const path = join(this.dependencies.threadFolder(threadId), "diagnosis.json");
    writeDiagnosisDocument(path, diagnosisDocument(threadId, clusters, check));
    return path;
  }

  private manifest(cluster: ClusterDiagnosis): ContextManifest {
    const manifest = readDocument(join(cluster.contextFolder, "context.json"), ContextManifestSchema);
    if (contextHash(manifest) !== cluster.contextHash) {
      throw new SetupError(`The context of cluster ${cluster.clusterId} in ${cluster.contextFolder} changed after it was sealed.`);
    }
    return manifest;
  }

  private async recordId(store: BaseStore, threadId: string, cluster: ClusterDiagnosis, kind: JobKind): Promise<string> {
    // A job that a stopped run interrupted, or that failed with infra, may have stored a record the state never saw.
    let attempt = cluster.records.filter((id) => id.includes(`/${kind}/`)).length + 1;
    while ((await store.get(recordNamespace(kind), `${threadId}/${cluster.clusterId}/${kind}/${attempt}`)) !== null) attempt++;
    return `${threadId}/${cluster.clusterId}/${kind}/${attempt}`;
  }

  private async runJob(kind: JobKind, input: JobInput, store: BaseStore): Promise<JobStep> {
    const { cluster, options } = input;
    const label = `${kind} ${cluster.clusterId}`;
    if (input.spentMs >= options.agents.runBudgetMinutes * 60_000) {
      this.dependencies.log(`${label}: the run budget of ${options.agents.runBudgetMinutes} min is spent; not started.`);
      return { update: { clusterId: cluster.clusterId, status: "budget_exhausted" }, chargedMs: 0 };
    }
    const manifest = this.manifest(cluster);
    const folders = diagnosisFolders(this.dependencies.threadFolder(input.threadId));
    const paths = { contextFolder: cluster.contextFolder, snapshotFolder: folders.source };
    const hypothesis: Explanation | null = cluster.hypothesis?.output.explanation ?? null;
    if (kind === "challenge" && hypothesis === null) throw new Error(`${label}: there is no hypothesis to challenge.`);
    const recordId = await this.recordId(store, input.threadId, cluster, kind);
    const choice = options.agents.jobs[kind];
    const common = {
      kind, label, choice, images: manifest.members.flatMap((member) => [join(cluster.contextFolder, member.canonicalCrop), join(cluster.contextFolder, member.candidateCrop)]),
      workspace: { folder: cluster.contextFolder, readOnly: [folders.source] },
      logFile: join(folders.logs, `${recordId.split("/").slice(1).join("-")}.jsonl`),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    this.dependencies.log(`${label}: running on ${choice.provider} (${choice.model ?? "default model"}, effort ${choice.effort}).`);
    const started = this.dependencies.now();
    const runner = this.dependencies.agents(options.agents);
    const result: AgentResult<unknown> = kind === "hypothesis"
      ? await runner.run<HypothesisOutput>({ ...common, prompt: hypothesisPrompt(manifest, paths), schema: HypothesisOutputSchema,
        validate: (output) => validateHypothesis(output, manifest, folders.source) })
      : await runner.run<ChallengeOutput>({ ...common, prompt: challengePrompt(manifest, hypothesis!, paths), schema: ChallengeOutputSchema,
        validate: (output) => validateChallenge(output, hypothesis!, manifest, folders.source) });
    const finished = this.dependencies.now();
    const record: EvalRecord = {
      schemaVersion: 1, recordId, jobKind: kind, threadId: input.threadId, subject: { kind: "discrepancy-cluster", id: cluster.clusterId },
      contextHash: cluster.contextHash, promptVersion: kind === "hypothesis" ? hypothesisPromptVersion : challengePromptVersion,
      agent: { provider: choice.provider, model: choice.model, effort: choice.effort },
      startedUtc: started.toISOString(), finishedUtc: finished.toISOString(), durationMs: Math.max(0, Math.round(result.durationMs)),
      usage: result.usage === null ? null : { ...result.usage, costUsd: result.usage.costUsd === null ? null : Math.max(0, result.usage.costUsd) },
      result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
      output: result.ok ? result.output : null,
      labels: { check: null },
    };
    await putRecord(store, record);
    const records = [...cluster.records, recordId];
    if (result.ok) {
      this.dependencies.quota.reset();
      const answer = { recordId, provider: choice.provider, model: choice.model, effort: choice.effort };
      if (kind === "hypothesis") {
        const output = HypothesisOutputSchema.parse(result.output);
        this.dependencies.log(`${label}: ${output.outcome === "abstain" ? `abstained: ${output.reason}` : output.explanation!.claim}`);
        return { update: { clusterId: cluster.clusterId, status: output.outcome === "abstain" ? "abstained" : "hypothesized", hypothesis: { ...answer, output }, records }, chargedMs: record.durationMs };
      }
      const output = ChallengeOutputSchema.parse(result.output);
      this.dependencies.log(`${label}: ${output.outcome === "no_alternative" ? `no alternative: ${output.reason}` : output.alternative!.claim}`);
      return { update: { clusterId: cluster.clusterId, status: "challenged", challenge: { ...answer, output }, records }, chargedMs: record.durationMs };
    }
    const failure = result.failure;
    this.dependencies.log(`${label}: ${failure.kind}: ${failure.message}`);
    if (failure.kind === "quota_exhausted") {
      const waiting: QuotaWaitMark = { job: kind, provider: choice.provider, since: finished.toISOString(), processId: this.dependencies.quota.processId, message: failure.message };
      return { update: { clusterId: cluster.clusterId, waiting, records }, chargedMs: 0 };
    }
    if (failure.kind === "infra") throw new SetupError(`${label} failed: ${failure.message} (record ${recordId})`);
    return { update: { clusterId: cluster.clusterId, status: "failed", failure: { job: kind, kind: failure.kind, message: failure.message }, records }, chargedMs: record.durationMs };
  }
}
