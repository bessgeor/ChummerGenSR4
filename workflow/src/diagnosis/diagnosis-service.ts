import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { CompareReport } from "../../../contracts/generated/typescript/parity-compare-report.js";
import { wasNotStarted, type AgentResult, type JobKind, type NotStarted } from "../agents/agent-job.js";
import type { AgentRunners } from "../agents/agent-runners.js";
import type { PlannedCase } from "../cases/case-plan.js";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { ExecutionCoverageSchema } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import { compiledFoldersIn } from "../compiled-source.js";
import { fixArchiveOf, fixesRootOf } from "../fixes/fix-archiver.js";
import { readArchivedFixes } from "../fixes/retrieval.js";
import { labelRecordById, nextRecordId, noLabels, putRecord, type EvalRecord } from "../evals/eval-record.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import { readDocument } from "../steps/read-document.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";
import { dispatchedTuningOf, tunedPromptVersion } from "../tuning/tuning.js";
import { judge, observe, planCheck, type CheckResult, type ClusterCheck } from "./check.js";
import type { CheckCapture } from "./check-capture.js";
import type { ClusterDiagnosis, ClusterUpdate, QuotaWaitMark } from "./cluster-diagnosis.js";
import { diagnosisDocument, writeDiagnosisDocument } from "./diagnosis-document.js";
import { ContextManifestSchema, contextHash, sealContext, type ContextManifest } from "./context.js";
import { jobFolderIn, stageJobFolder } from "./job-folder.js";
import {
  ChallengeOutputSchema, challengePromptVersion, HypothesisOutputSchema,
  type ChallengeOutput, type Explanation, type HypothesisOutput,
} from "./job-schemas.js";
import { challengePrompt, hypothesisPrompt, hypothesisPromptVersionOf } from "./prompts.js";
import type { QuotaWaiter } from "./quota-waiter.js";
import { requireRecordedSource, requireSameSource } from "./candidate-source.js";
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
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly git: Git;
  /** Every case of a case file, unfiltered: the check vocabulary. */
  readonly allCases: (caseFile: string) => readonly PlannedCase[];
  readonly readReport: (runFolder: string) => CompareReport;
  readonly checkCapture: CheckCapture;
  /** A scratch folder outside the repository, where a job gets its copy of the context and the snapshot. */
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

export type PrepareInput = {
  readonly threadId: string; readonly triagePath: string; readonly caseFile: string; readonly candidate: string; readonly candidateSource: string;
  /** Whether the thread works in fix changes: then the repository's archived fixes are ranked into each context as priors. */
  readonly fixChanges: boolean;
};

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
  /** Model time the jobs finished in this process charged to each thread, before the graph state has them. */
  private readonly charged = new Map<string, number>();

  constructor(private readonly dependencies: DiagnosisDependencies) {}

  /** Takes the source snapshot and seals one context per triage cluster; no cluster needs no snapshot. */
  async prepare(input: PrepareInput): Promise<Record<string, ClusterDiagnosis>> {
    const triage = readDocument(input.triagePath, TriageDocumentSchema);
    if (triage.clusters.length === 0) return {};
    const folders = diagnosisFolders(this.dependencies.threadFolder(input.threadId));
    // The models explain this source, so its compiled part must be the source the captured candidate was built from, as its build recorded it.
    // Without a record nothing can be compared, so no snapshot is taken.
    requireRecordedSource(input.candidateSource, "it was not built by the workflow's build step. Run without --only so that the build records it.");
    const snapshot = await createSourceSnapshot(this.dependencies.repositoryRoot, folders.source, this.dependencies.git);
    requireSameSource(input.candidateSource, snapshot.compiledIdentity, "the pixels do not show this source. Build again: run without --only.");
    this.dependencies.log(`Diagnosis: source snapshot of ${snapshot.files} files at ${snapshot.commit.slice(0, 12)}; ${triage.clusters.length} clusters.`);
    const cases = this.dependencies.allCases(input.caseFile);
    // Clusters share run folders, and a report is large: read and validate each once.
    const reports = new Map<string, CompareReport>();
    const readReport = (runFolder: string): CompareReport => {
      let report = reports.get(runFolder);
      if (report === undefined) {
        report = this.dependencies.readReport(runFolder);
        reports.set(runFolder, report);
      }
      return report;
    };
    // Read from the working tree the snapshot was taken from, once for every cluster.
    const fixes = input.fixChanges ? readArchivedFixes(fixArchiveOf(fixesRootOf(this.dependencies.repositoryRoot))) : null;
    if (fixes !== null) this.dependencies.log(`Diagnosis: ${fixes.length} archived fix changes to rank as priors.`);
    const clusters: Record<string, ClusterDiagnosis> = {};
    for (const cluster of triage.clusters) {
      const sealed = await sealContext({ triage, clusterId: cluster.id, cases, readReport, snapshot, candidate: input.candidate, fixes },
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
    const observations = plan.predicted.map((item) => observe(results, item.case, item.capture));
    const clusters: Record<string, ClusterCheck> = {};
    for (const id of plan.checked) {
      const cluster = input.clusters[id]!;
      const checked = judge(cluster, observations);
      clusters[id] = checked;
      // Every job of the cluster, the quota and interrupted attempts included.
      for (const recordId of cluster.records) await labelRecordById(store, recordId, checked.outcome);
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
    return readSealedManifest(cluster);
  }

  /**
   * The ID of the next record of a kind, and the earlier records of that kind the state never saw: a job that failed
   * with `infra` stored its record and then ended the run, so only the store knows it.
   */
  private nextRecord(store: BaseStore, threadId: string, cluster: ClusterDiagnosis, kind: JobKind): Promise<{ recordId: string; unlisted: string[] }> {
    // The listed records of a kind are attempts 1 to n, so a stored record the state does not list comes after them.
    return nextRecordId(store, kind, `${threadId}/${cluster.clusterId}/${kind}`, cluster.records.filter((id) => id.includes(`/${kind}/`)).length);
  }

  /** Model time charged to a thread: the state's total, or more when finished jobs of the same step are not in it yet. */
  private spentMs(threadId: string, stateMs: number): number {
    return Math.max(stateMs, this.charged.get(threadId) ?? 0);
  }

  private charge(threadId: string, stateMs: number, milliseconds: number): void {
    this.charged.set(threadId, this.spentMs(threadId, stateMs) + milliseconds);
  }

  private budgetExhausted(label: string, clusterId: string, budgetMinutes: number): JobStep {
    this.dependencies.log(`${label}: the run budget of ${budgetMinutes} min is spent; not started.`);
    return { update: { clusterId, status: "budget_exhausted" }, chargedMs: 0 };
  }

  private async runJob(kind: "hypothesis" | "challenge", input: JobInput, store: BaseStore): Promise<JobStep> {
    const { cluster, options } = input;
    const label = `${kind} ${cluster.clusterId}`;
    const budgetMs = options.agents.runBudgetMinutes * 60_000;
    const budgetSpent = () => this.spentMs(input.threadId, input.spentMs) >= budgetMs;
    if (budgetSpent()) return this.budgetExhausted(label, cluster.clusterId, options.agents.runBudgetMinutes);
    const manifest = this.manifest(cluster);
    const folders = diagnosisFolders(this.dependencies.threadFolder(input.threadId));
    const hypothesis: Explanation | null = cluster.hypothesis?.output.explanation ?? null;
    if (kind === "challenge" && hypothesis === null) throw new Error(`${label}: there is no hypothesis to challenge.`);
    const { recordId, unlisted } = await this.nextRecord(store, input.threadId, cluster, kind);
    const choice = options.agents.jobs[kind];
    const tuning = dispatchedTuningOf(options.tuning, kind);
    const scratch = this.dependencies.createScratchFolder("workflow-job-");
    let started = this.dependencies.now();
    let result: AgentResult<unknown> | NotStarted;
    try {
      const staged = jobFolderIn(scratch, cluster.clusterId);
      const paths = { contextFolder: staged.context, snapshotFolder: staged.source, compiledFolders: compiledFoldersIn(folders.source) };
      const common = {
        kind, label, choice, images: manifest.members.flatMap((member) => [join(staged.context, member.canonicalCrop), join(staged.context, member.candidateCrop)]),
        workspace: { folder: staged.context, readOnly: [staged.source] },
        logFile: join(folders.logs, `${recordId.split("/").slice(1).join("-")}.jsonl`),
        // Asked when the job gets its place in the model pool, after the jobs queued before it were charged. The
        // copy is made only now, so jobs that wait or are refused hold none.
        mayStart: () => {
          if (budgetSpent()) return false;
          stageJobFolder(staged, cluster.contextFolder, folders.source, kind === "challenge");
          started = this.dependencies.now();
          return true;
        },
        onResult: (outcome: AgentResult<unknown>) => this.charge(input.threadId, input.spentMs, chargedMilliseconds(label, outcome)),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      };
      this.dependencies.log(`${label}: running on ${choice.provider} (${choice.model ?? "default model"}, effort ${choice.effort}).`);
      const runner = this.dependencies.agents(options.agents);
      result = kind === "hypothesis"
        ? await runner.run<HypothesisOutput>({ ...common, prompt: hypothesisPrompt(manifest, paths, tuning), schema: HypothesisOutputSchema,
          validate: (output) => validateHypothesis(output, manifest, folders.source) })
        : await runner.run<ChallengeOutput>({ ...common, prompt: challengePrompt(manifest, hypothesis!, paths, tuning), schema: ChallengeOutputSchema,
          validate: (output) => validateChallenge(output, hypothesis!, manifest, folders.source) });
    } finally {
      // A leftover copy is not a failure of the job: its result is still recorded, and the copy is named for the operator.
      try {
        scratch.remove();
      } catch (error) {
        this.dependencies.log(`${label}: the scratch copy ${scratch.path} could not be removed (${(error as Error).message}); remove it by hand.`);
      }
    }
    if (wasNotStarted(result)) return this.budgetExhausted(label, cluster.clusterId, options.agents.runBudgetMinutes);
    const finished = this.dependencies.now();
    const record: EvalRecord = {
      schemaVersion: 2, recordId, jobKind: kind, origin: "workflow", threadId: input.threadId, subject: { kind: "discrepancy-cluster", id: cluster.clusterId },
      challenged: kind === "challenge" ? cluster.hypothesis!.recordId : null,
      contextHash: cluster.contextHash, promptVersion: tunedPromptVersion(kind === "hypothesis" ? hypothesisPromptVersionOf(manifest) : challengePromptVersion, tuning),
      agent: { provider: choice.provider, model: choice.model, effort: choice.effort },
      startedUtc: started.toISOString(), finishedUtc: finished.toISOString(), durationMs: measuredDuration(label, result),
      usage: result.usage,
      result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
      output: result.ok ? result.output : null,
      labels: noLabels,
    };
    await putRecord(store, record);
    const records = [...cluster.records, ...unlisted, recordId];
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
    if (failure.kind === "infra" || failure.kind === "timeout") throw new SetupError(`${label} failed: ${failure.message} (record ${recordId})`);
    return { update: { clusterId: cluster.clusterId, status: "failed", failure: { job: kind, kind: failure.kind, message: failure.message }, records }, chargedMs: record.durationMs };
  }
}

/** A cluster's sealed manifest; a context that changed since it was sealed is a setup error. */
export function readSealedManifest(cluster: Pick<ClusterDiagnosis, "clusterId" | "contextFolder" | "contextHash">): ContextManifest {
  const manifest = readDocument(join(cluster.contextFolder, "context.json"), ContextManifestSchema);
  if (contextHash(manifest) !== cluster.contextHash) {
    throw new SetupError(`The context of cluster ${cluster.clusterId} in ${cluster.contextFolder} changed after it was sealed.`);
  }
  return manifest;
}

/** The model time a result charges to the run budget: a finished job, a failed one too; not a usage limit, and an infra failure or timeout ends the run. */
export function chargedMilliseconds(label: string, result: AgentResult<unknown>): number {
  return !result.ok && ["quota_exhausted", "infra", "timeout"].includes(result.failure.kind) ? 0 : measuredDuration(label, result);
}

/** The adapter's duration in whole milliseconds. A negative or non-finite duration or cost is a bug in the adapter and fails the run. */
export function measuredDuration(label: string, result: AgentResult<unknown>): number {
  if (!Number.isFinite(result.durationMs) || result.durationMs < 0) {
    throw new SetupError(`${label}: the agent runner reported the duration ${result.durationMs} ms.`);
  }
  if (result.usage?.costUsd != null && (!Number.isFinite(result.usage.costUsd) || result.usage.costUsd < 0)) {
    throw new SetupError(`${label}: the agent runner reported the cost ${result.usage.costUsd} USD.`);
  }
  return Math.round(result.durationMs);
}