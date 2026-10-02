import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { efforts, providers, wasNotStarted, type AgentResult, type AgentRunner } from "../agents/agent-job.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { ContextManifest } from "../diagnosis/context.js";
import {
  ChallengeOutputSchema, challengePromptVersion, HypothesisOutputSchema, hypothesisPromptVersion, type ChallengeOutput, type HypothesisOutput,
} from "../diagnosis/job-schemas.js";
import { stageJobFolder } from "../diagnosis/job-folder.js";
import { challengePrompt, hypothesisPrompt, withoutPriors } from "../diagnosis/prompts.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { validateChallenge, validateHypothesis } from "../diagnosis/validation.js";
import { removalFailure, type ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { datasetFolders, loadDataset, type Dataset, type DatasetItem } from "./dataset.js";
import { noLabels, putRecord, recordNamespace } from "./eval-record.js";
import { failedScores, scoreChallenge, scoreHypothesis, type Scores } from "./scoring.js";
import { wilsonInterval } from "./statistics.js";

export const runPartitions = ["test", "development", "all"] as const;
export type RunPartition = (typeof runPartitions)[number];

export const promptVersions = { hypothesis: hypothesisPromptVersion, challenge: challengePromptVersion } as const;

const ChoiceSchema = z.strictObject({ provider: z.enum(providers), model: z.string().nullable(), effort: z.enum(efforts), timeoutMinutes: z.number().positive() });

/** What an eval run was started with; a resumed run keeps it. */
export const RunSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  name: z.string().nullable(),
  dataset: z.strictObject({ folder: z.string(), name: z.string(), version: z.number().int(), hash: z.string() }),
  jobKind: z.enum(["hypothesis", "challenge"]),
  partition: z.enum(runPartitions),
  repeat: z.number().int().positive(),
  choice: ChoiceSchema,
  promptVersion: z.string(),
  modelPool: z.number().int().positive(),
  executables: z.strictObject({ claude: z.string(), codex: z.string().nullable() }),
  /** Every sample the run has to finish: `<item>-<repetition>`. */
  samples: z.array(z.string()).min(1),
  startedUtc: z.string(),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;

export const SampleSchema = z.strictObject({
  key: z.string(), itemId: z.string(), clusterId: z.string(), repetition: z.number().int().positive(), recordId: z.string(),
  status: z.enum(["succeeded", "invalid_output", "refused"]), message: z.string().nullable(), output: z.unknown().nullable(),
  prediction: z.boolean(), rootCause: z.boolean().nullable(),
  durationMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type Sample = z.infer<typeof SampleSchema>;

/** A metric over the items of a run: `count` items have a value, `passes` is the sum of their pass shares over their repetitions. */
export type MetricSummary = { readonly passes: number; readonly count: number; readonly rate: number | null; readonly interval: { low: number; high: number } | null };

export type RunSummary = {
  readonly runId: string;
  readonly samples: number;
  readonly metrics: { readonly prediction: MetricSummary; readonly rootCause: MetricSummary };
  readonly failures: { readonly invalid_output: number; readonly refused: number };
  readonly modelMs: number;
  readonly costUsd: number;
  readonly unknownCosts: number;
  readonly finishedUtc: string;
};

export function runFolders(folder: string) {
  return { settings: join(folder, "run.json"), samples: join(folder, "samples"), sample: (key: string) => join(folder, "samples", `${key}.json`), summary: join(folder, "summary.json") };
}

/** The share of an item's repetitions that pass a metric, by item; items without a value leave out. Repetitions of one item are not independent samples. */
export function itemShares(samples: readonly Sample[], value: (sample: Sample) => boolean | null): Map<string, number> {
  const byItem = new Map<string, boolean[]>();
  for (const sample of samples) {
    const known = value(sample);
    if (known !== null) byItem.set(sample.itemId, [...(byItem.get(sample.itemId) ?? []), known]);
  }
  return new Map([...byItem].map(([itemId, values]) => [itemId, values.filter((known) => known).length / values.length]));
}

function metric(samples: readonly Sample[], value: (sample: Sample) => boolean | null): MetricSummary {
  const shares = [...itemShares(samples, value).values()];
  const passes = shares.reduce((sum, share) => sum + share, 0);
  return { passes, count: shares.length, rate: shares.length === 0 ? null : passes / shares.length, interval: wilsonInterval(passes, shares.length) };
}

export function summarize(runId: string, samples: readonly Sample[], finished: Date): RunSummary {
  return {
    runId, samples: samples.length,
    metrics: { prediction: metric(samples, (sample) => sample.prediction), rootCause: metric(samples, (sample) => sample.rootCause) },
    failures: { invalid_output: samples.filter((sample) => sample.status === "invalid_output").length, refused: samples.filter((sample) => sample.status === "refused").length },
    modelMs: samples.reduce((sum, sample) => sum + sample.durationMs, 0),
    costUsd: samples.reduce((sum, sample) => sum + (sample.costUsd ?? 0), 0),
    unknownCosts: samples.filter((sample) => sample.costUsd === null).length,
    finishedUtc: finished.toISOString(),
  };
}

/** The settings and finished samples of a run folder. */
export function readRun(folder: string): { settings: RunSettings; samples: Sample[] } {
  const paths = runFolders(folder);
  const settings = readDocument(paths.settings, RunSettingsSchema);
  const samples = existsSync(paths.samples)
    ? readdirSync(paths.samples).filter((name) => name.endsWith(".json")).sort().map((name) => readDocument(join(paths.samples, name), SampleSchema))
    : [];
  return { settings, samples };
}

export type EvalRunDependencies = {
  readonly store: BaseStore;
  readonly agents: (settings: AgentSettings) => AgentRunner;
  readonly quota: QuotaWaiter;
  readonly runsFolder: string;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly newRunId: () => string;
  readonly signal?: AbortSignal;
};

export type StartRun = { readonly datasetFolder: string; readonly partition: RunPartition; readonly repeat: number; readonly name: string | null; readonly settings: AgentSettings };

/** Starts an eval run of the dataset's job kind with the given agent settings, and runs every sample. */
export async function startEvalRun(dependencies: EvalRunDependencies, start: StartRun): Promise<{ folder: string; summary: RunSummary }> {
  const { dataset, manifests } = await loadDataset(start.datasetFolder);
  const items = dataset.items.filter((item) => start.partition === "all" || item.partition === start.partition);
  if (items.length === 0) throw new SetupError(`The dataset ${start.datasetFolder} has no item in the ${start.partition} partition.`);
  const runId = dependencies.newRunId();
  const folder = join(dependencies.runsFolder, runId);
  const settings = RunSettingsSchema.parse({
    schemaVersion: 1, runId, name: start.name, dataset: { folder: start.datasetFolder, name: dataset.name, version: dataset.version, hash: dataset.datasetHash },
    jobKind: dataset.jobKind, partition: start.partition, repeat: start.repeat, choice: start.settings.jobs[dataset.jobKind],
    promptVersion: promptVersions[dataset.jobKind], modelPool: start.settings.modelPool, executables: start.settings.executables,
    samples: items.flatMap((item) => Array.from({ length: start.repeat }, (_, index) => `${item.itemId}-${index + 1}`)),
    startedUtc: dependencies.now().toISOString(),
  });
  mkdirSync(runFolders(folder).samples, { recursive: true });
  writeFileSync(runFolders(folder).settings, `${JSON.stringify(settings, null, 2)}\n`);
  return { folder, summary: await runSamples(dependencies, folder, settings, dataset, manifests) };
}

/** Continues a run with its stored settings: only the samples without a file run. */
export async function resumeEvalRun(dependencies: EvalRunDependencies, runId: string): Promise<{ folder: string; summary: RunSummary }> {
  const folder = join(dependencies.runsFolder, runId);
  if (!existsSync(runFolders(folder).settings)) throw new SetupError(`There is no eval run ${runId} in ${dependencies.runsFolder}.`);
  const { settings } = readRun(folder);
  if (settings.promptVersion !== promptVersions[settings.jobKind]) {
    throw new SetupError(`Eval run ${runId} used prompt ${settings.promptVersion}; the code now has ${promptVersions[settings.jobKind]}. Start a new run.`);
  }
  const { dataset, manifests } = await loadDataset(settings.dataset.folder);
  if (dataset.datasetHash !== settings.dataset.hash) throw new SetupError(`The dataset ${settings.dataset.folder} is not the one eval run ${runId} started with.`);
  return { folder, summary: await runSamples(dependencies, folder, settings, dataset, manifests) };
}

async function runSamples(dependencies: EvalRunDependencies, folder: string, settings: RunSettings, dataset: Dataset, manifests: ReadonlyMap<string, ContextManifest>): Promise<RunSummary> {
  const paths = runFolders(folder);
  const missing = settings.samples.filter((key) => !existsSync(paths.sample(key)));
  dependencies.log(`Eval run ${settings.runId}: ${settings.jobKind} on ${dataset.name} v${dataset.version} (${settings.partition}), ${settings.choice.provider} `
    + `(${settings.choice.model ?? "default model"}, effort ${settings.choice.effort}); ${missing.length} of ${settings.samples.length} samples to run.`);
  const agentSettings: AgentSettings = {
    jobs: { hypothesis: settings.choice, challenge: settings.choice, grade: settings.choice, repair: settings.choice }, modelPool: settings.modelPool,
    runBudgetMinutes: 0, executables: settings.executables,
  };
  const runner = dependencies.agents(agentSettings);
  // An infra failure stops the jobs still running beside it before the run ends.
  const stop = new AbortController();
  const stopOnSignal = () => stop.abort();
  let firstError: unknown = undefined;
  dependencies.signal?.addEventListener("abort", stopOnSignal, { once: true });
  if (dependencies.signal?.aborted === true) throw new SetupError(`Eval run ${settings.runId} was stopped before its jobs started.`);
  const outcomes = await Promise.allSettled(missing.map(async (key) => {
    try {
      const separator = key.lastIndexOf("-");
      const item = dataset.items.find((entry) => entry.itemId === key.slice(0, separator));
      if (item === undefined) throw new SetupError(`Eval run ${settings.runId} names sample ${key}, whose item the dataset does not have.`);
      const sample = await runSample(dependencies, runner, settings, item, manifests.get(item.itemId)!, Number(key.slice(separator + 1)), stop.signal);
      writeFileSync(paths.sample(key), `${JSON.stringify(sample, null, 2)}\n`);
    } catch (error) {
      firstError ??= error;
      stop.abort();
      throw error;
    }
  }));
  dependencies.signal?.removeEventListener("abort", stopOnSignal);
  if (outcomes.some((outcome) => outcome.status === "rejected")) throw firstError;
  const { samples } = readRun(folder);
  const summary = summarize(settings.runId, samples, dependencies.now());
  writeFileSync(paths.summary, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

/** The first attempt of a sample without a stored record: attempts stored by an earlier invocation of the run are never replaced. */
async function nextAttempt(store: BaseStore, settings: RunSettings, itemId: string, repetition: number): Promise<{ recordId: string; attempt: number }> {
  for (let attempt = 1; ; attempt++) {
    const recordId = `${settings.runId}/${itemId}/${repetition}/${attempt}`;
    if ((await store.get(recordNamespace(settings.jobKind), recordId)) === null) return { recordId, attempt };
  }
}

async function runSample(
  dependencies: EvalRunDependencies, runner: AgentRunner, settings: RunSettings, item: DatasetItem, manifest: ContextManifest, repetition: number, signal: AbortSignal,
): Promise<Sample> {
  const copies = datasetFolders(settings.dataset.folder);
  const sourceCopy = copies.source(item.sourceIdentity);
  const label = `${settings.jobKind} ${item.itemId}#${repetition}`;
  for (;;) {
    // Every attempt keeps its record: a resumed run, or a retry after a usage limit, continues after the stored ones.
    const { recordId, attempt } = await nextAttempt(dependencies.store, settings, item.itemId, repetition);
    const scratch = dependencies.createScratchFolder("workflow-eval-");
    const staged = { context: join(scratch.path, item.clusterId), source: join(scratch.path, "source") };
    let started = dependencies.now();
    let result: AgentResult<HypothesisOutput | ChallengeOutput> | { started: false };
    try {
      const common = {
        kind: settings.jobKind, label, choice: settings.choice,
        images: manifest.members.flatMap((member) => [join(staged.context, member.canonicalCrop), join(staged.context, member.candidateCrop)]),
        workspace: { folder: staged.context, readOnly: [staged.source] },
        logFile: join(dependencies.runsFolder, settings.runId, "logs", `${item.itemId}-${repetition}-${attempt}.jsonl`),
        mayStart: () => {
          // Runs measure the prompt versions of `promptVersions`, which have no priors section: a context frozen from a
          // thread with fix changes is shown without its priors.
          stageJobFolder(staged, copies.context(item.contextHash), sourceCopy, true);
          started = dependencies.now();
          return true;
        },
        signal,
      };
      const paths = { contextFolder: staged.context, snapshotFolder: staged.source };
      result = settings.jobKind === "hypothesis"
        ? await runner.run<HypothesisOutput>({ ...common, prompt: hypothesisPrompt(withoutPriors(manifest), paths), schema: HypothesisOutputSchema,
          validate: (output) => validateHypothesis(output, manifest, sourceCopy) })
        : await runner.run<ChallengeOutput>({ ...common, prompt: challengePrompt(manifest, item.hypothesis!, paths), schema: ChallengeOutputSchema,
          validate: (output) => validateChallenge(output, item.hypothesis!, manifest, sourceCopy) });
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
      schemaVersion: 2, recordId, jobKind: settings.jobKind, origin: "eval-run", threadId: settings.runId, subject: { kind: "discrepancy-cluster", id: item.clusterId },
      contextHash: item.contextHash, promptVersion: settings.promptVersion,
      agent: { provider: settings.choice.provider, model: settings.choice.model, effort: settings.choice.effort },
      startedUtc: started.toISOString(), finishedUtc: dependencies.now().toISOString(), durationMs, usage: result.usage,
      result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
      output: result.ok ? result.output : null, challenged: null, labels: noLabels,
    });
    if (leftover !== null) throw leftover;
    const common = { key: `${item.itemId}-${repetition}`, itemId: item.itemId, clusterId: item.clusterId, repetition, recordId, durationMs, costUsd: result.usage?.costUsd ?? null };
    if (result.ok) {
      dependencies.quota.reset();
      const scores: Scores = settings.jobKind === "hypothesis"
        ? scoreHypothesis(result.output as HypothesisOutput, item)
        : scoreChallenge(result.output as ChallengeOutput, item);
      dependencies.log(`${label}: prediction ${scores.prediction ? "pass" : "fail"}, root cause ${scores.rootCause === null ? "no gold" : scores.rootCause ? "pass" : "fail"}.`);
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
    return { ...common, status: failure.kind, message: failure.message, output: null, ...failedScores(item) };
  }
}

/** Summary lines of a finished run. */
export function summaryLines(summary: RunSummary): string[] {
  const line = (name: string, value: MetricSummary) => `  ${name}: ${Number.isInteger(value.passes) ? value.passes : value.passes.toFixed(2)}/${value.count} items`
    + (value.rate === null ? " (no samples)" : ` = ${value.rate.toFixed(3)}, 95% Wilson [${value.interval!.low.toFixed(3)}, ${value.interval!.high.toFixed(3)}]`);
  return [
    `Eval run ${summary.runId}: ${summary.samples} samples.`,
    line("prediction", summary.metrics.prediction),
    line("root cause", summary.metrics.rootCause),
    `  failures: invalid_output ${summary.failures.invalid_output}, refused ${summary.failures.refused}; model time ${(summary.modelMs / 1000).toFixed(1)} s; `
      + `cost ${summary.costUsd.toFixed(4)} USD (${summary.unknownCosts} samples without a reported cost)`,
  ];
}
