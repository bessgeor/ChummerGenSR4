import { join } from "node:path";
import type { z } from "zod";
import { wasNotStarted, type AgentResult, type NotStarted } from "../agents/agent-job.js";
import { compiledFoldersIn } from "../compiled-source.js";
import { stageJobFolder } from "../diagnosis/job-folder.js";
import type { PromptPaths } from "../diagnosis/prompts.js";
import { removalFailure } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { noLabels, putRecord, type EvalRecord } from "./eval-record.js";
import { nextAttempt, type Sample, type SampleContext } from "./eval-sample.js";

/** A sample's metric values; the ones its job kind does not score are null. */
export type SampleScores = Pick<Sample, "prediction" | "rootCause" | "valid" | "reached">;

/** One eval sample's job: the item's copies, how to prompt, check and score the answer, and what a failed job scores. */
export type EvalJob<T> = {
  readonly itemId: string;
  /** The item's cluster, or a discovery item's partition key; samples carry it as `clusterId`. */
  readonly partitionKey: string;
  readonly contextHash: string;
  readonly contextCopy: string;
  readonly sourceCopy: string;
  /** The context folder's name in the scratch folder; the snapshot is always `source` beside it. */
  readonly contextName: string;
  /** Leave out the priors a context carries (diagnosis prompts measured without them). */
  readonly withoutPriors: boolean;
  readonly subject: EvalRecord["subject"];
  readonly images: (stagedContext: string) => string[];
  readonly prompt: (paths: PromptPaths) => string;
  readonly schema: z.ZodType<T>;
  readonly validate: (output: T) => readonly string[];
  readonly score: (output: T) => SampleScores;
  readonly failed: SampleScores;
  readonly describe: (scores: SampleScores) => string;
};

/**
 * Runs one sample of an eval run in a scratch copy of the item's context and snapshot and stores its record with origin
 * `eval-run`. A usage limit waits and runs it again as the next attempt; `infra` and `timeout` end the run.
 */
export async function runEvalSample<T>(context: SampleContext, job: EvalJob<T>, repetition: number): Promise<Sample> {
  const { dependencies, runner, settings, signal } = context;
  const label = `${settings.jobKind} ${job.itemId}#${repetition}`;
  for (;;) {
    // Every attempt keeps its record: a resumed run, or a retry after a usage limit, continues after the stored ones.
    const { recordId, attempt } = await nextAttempt(dependencies.store, settings, job.itemId, repetition);
    const scratch = dependencies.createScratchFolder("workflow-eval-");
    const staged = { context: join(scratch.path, job.contextName), source: join(scratch.path, "source") };
    let started = dependencies.now();
    let result: AgentResult<T> | NotStarted;
    try {
      const paths = { contextFolder: staged.context, snapshotFolder: staged.source, compiledFolders: compiledFoldersIn(job.sourceCopy) };
      result = await runner.run<T>({
        kind: settings.jobKind, label, choice: settings.choice, images: job.images(staged.context), prompt: job.prompt(paths), schema: job.schema, validate: job.validate,
        workspace: { folder: staged.context, readOnly: [staged.source] },
        logFile: join(dependencies.runsFolder, settings.runId, "logs", `${job.itemId}-${repetition}-${attempt}.jsonl`),
        mayStart: () => {
          stageJobFolder(staged, job.contextCopy, job.sourceCopy, job.withoutPriors);
          started = dependencies.now();
          return true;
        },
        signal,
      });
    } catch (error) {
      const leftover = removalFailure(scratch);
      if (leftover !== null) dependencies.log(`${label}: ${leftover.message}`);
      throw error;
    }
    // The job's result is stored first; a copy that stays then fails the sample.
    const leftover = removalFailure(scratch);
    if (wasNotStarted(result)) throw leftover ?? new Error(`${label} was not started.`);
    if (!Number.isFinite(result.durationMs) || result.durationMs < 0) throw new SetupError(`${label}: the agent runner reported the duration ${result.durationMs} ms.`);
    const durationMs = Math.round(result.durationMs);
    await putRecord(dependencies.store, {
      schemaVersion: 2, recordId, jobKind: settings.jobKind, origin: "eval-run", threadId: settings.runId, subject: job.subject,
      contextHash: job.contextHash, promptVersion: settings.promptVersion,
      agent: { provider: settings.choice.provider, model: settings.choice.model, effort: settings.choice.effort },
      startedUtc: started.toISOString(), finishedUtc: dependencies.now().toISOString(), durationMs, usage: result.usage,
      result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
      output: result.ok ? result.output : null, challenged: null, labels: noLabels,
    });
    if (leftover !== null) throw leftover;
    const common = { key: `${job.itemId}-${repetition}`, itemId: job.itemId, clusterId: job.partitionKey, repetition, recordId, durationMs, costUsd: result.usage?.costUsd ?? null };
    if (result.ok) {
      dependencies.quota.reset();
      const scores = job.score(result.output);
      dependencies.log(`${label}: ${job.describe(scores)}.`);
      return { ...common, status: "succeeded", message: null, output: result.output, ...scores };
    }
    const failure = result.failure;
    dependencies.log(`${label}: ${failure.kind}: ${failure.message}`);
    if (failure.kind === "quota_exhausted") {
      await dependencies.quota.wait([dependencies.quota.processId], signal);
      continue;
    }
    if (failure.kind === "infra" || failure.kind === "timeout") {
      throw new SetupError(`${label} failed: ${failure.message} (record ${recordId}); resume the run with --resume ${settings.runId}.`);
    }
    return { ...common, status: failure.kind, message: failure.message, output: null, ...job.failed };
  }
}

/** `pass`, `fail` or `no gold` for a metric value. */
export function verdictText(value: boolean | null, missing = "no gold"): string {
  return value === null ? missing : value ? "pass" : "fail";
}
