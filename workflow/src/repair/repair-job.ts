import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { z } from "zod";
import { wasNotStarted, type AgentChoice, type AgentJob, type AgentResult, type AgentRunner } from "../agents/agent-job.js";
import { measuredDuration } from "../diagnosis/diagnosis-service.js";
import { noLabels, putRecord, type EvalRecord } from "../evals/eval-record.js";
import { SetupError } from "../host/setup-error.js";

/** What every model job of one repair attempt shares. */
export type AttemptJobs = {
  readonly runner: AgentRunner;
  readonly store: BaseStore;
  readonly threadId: string;
  readonly clusterId: string;
  readonly contextHash: string;
  readonly choice: AgentChoice;
  readonly now: () => Date;
  /** Whether the run budget is spent, asked when a job gets its place in the model pool. */
  readonly budgetSpent: () => boolean;
  /** Charges a finished job's model time to the thread while the job still holds its place. */
  readonly charge: (milliseconds: number) => void;
  readonly signal?: AbortSignal;
};

/** One recorded repair job: its prompt, output schema, folders and record. */
export type RecordedJobSpec<T> = {
  readonly label: string;
  readonly recordId: string;
  readonly promptVersion: string;
  readonly prompt: string;
  readonly images: readonly string[];
  readonly schema: z.ZodType<T>;
  readonly validate: (output: T) => readonly string[];
  readonly workspace: AgentJob<T>["workspace"];
  /** The job's time limit, asked when the job gets its place in the model pool, so time spent waiting for it is not given to it. */
  readonly timeoutMinutes: () => number;
  readonly logFile: string;
  /** Makes the job's folders once it got its place and the budget allows it; the job's start is taken after it. */
  readonly stage: () => void;
  /** What the job changed that it may not change; anything makes its result `infra`. */
  readonly outside: () => Promise<string[]>;
};

/** A job that ran: its stored record and its result. */
export type RecordedJob<T> = { readonly record: EvalRecord; readonly result: AgentResult<T> };

/** The model time a result charges to the run budget: not a usage limit, and an infra failure ends the run. */
export function chargedMilliseconds(label: string, result: AgentResult<unknown>): number {
  return !result.ok && (result.failure.kind === "quota_exhausted" || result.failure.kind === "infra") ? 0 : measuredDuration(label, result);
}

/**
 * Runs a repair job and stores its record, a failed one too; null when the budget did not let it start. A job that
 * changed what it may not is `infra`, and an `infra` result ends the run as a setup error once it is recorded.
 */
export async function runRecordedJob<T>(jobs: AttemptJobs, spec: RecordedJobSpec<T>): Promise<RecordedJob<T> | null> {
  let started = jobs.now();
  // The adapter reads the time limit when the job runs, after `mayStart` set it.
  const choice = { ...jobs.choice, timeoutMinutes: jobs.choice.timeoutMinutes };
  const ran = await jobs.runner.run<T>({
    kind: "repair", label: spec.label, prompt: spec.prompt, images: spec.images, schema: spec.schema, validate: spec.validate,
    workspace: spec.workspace, choice, logFile: spec.logFile,
    mayStart: () => {
      if (jobs.budgetSpent()) return false;
      choice.timeoutMinutes = spec.timeoutMinutes();
      spec.stage();
      started = jobs.now();
      return true;
    },
    onResult: (outcome) => jobs.charge(chargedMilliseconds(spec.label, outcome)),
    ...(jobs.signal === undefined ? {} : { signal: jobs.signal }),
  });
  if (wasNotStarted(ran)) return null;
  // Only the job's own folder may change, whichever provider ran it.
  const outside = await spec.outside();
  const result: AgentResult<T> = outside.length === 0 ? ran
    : { ok: false, failure: { kind: "infra", message: `${spec.label}: the job changed files outside its source copy: ${outside.join("; ")}.` }, usage: ran.usage, durationMs: ran.durationMs, sessionId: ran.sessionId };
  const record: EvalRecord = {
    schemaVersion: 2, recordId: spec.recordId, jobKind: "repair", origin: "workflow", threadId: jobs.threadId, subject: { kind: "discrepancy-cluster", id: jobs.clusterId },
    challenged: null, contextHash: jobs.contextHash, promptVersion: spec.promptVersion,
    agent: { provider: jobs.choice.provider, model: jobs.choice.model, effort: jobs.choice.effort },
    startedUtc: started.toISOString(), finishedUtc: jobs.now().toISOString(), durationMs: measuredDuration(spec.label, result), usage: result.usage,
    result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
    output: result.ok ? result.output : null, labels: noLabels,
  };
  await putRecord(jobs.store, record);
  if (!result.ok && result.failure.kind === "infra") throw new SetupError(`${spec.label} failed: ${result.failure.message} (record ${spec.recordId})`);
  return { record, result };
}
