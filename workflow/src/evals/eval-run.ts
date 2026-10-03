import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { jobKinds, type AgentChoice, type JobKind } from "../agents/agent-job.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { ContextManifest } from "../diagnosis/context.js";
import { ChallengeOutputSchema, HypothesisOutputSchema, type ChallengeOutput, type HypothesisOutput } from "../diagnosis/job-schemas.js";
import { challengePrompt, hypothesisPrompt, withoutPriors } from "../diagnosis/prompts.js";
import { validateChallenge, validateHypothesis } from "../diagnosis/validation.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { datasetFolders, loadDataset, type DatasetItem, type Partition } from "./dataset.js";
import { loadDiscoveryDataset } from "./discovery-dataset.js";
import { runDiscoverySample } from "./discovery-eval-run.js";
import { runEvalSample, verdictText, type EvalJob, type SampleScores } from "./eval-job.js";
import {
  evaluatedJobKinds, promptVersions, RunSettingsSchema, SampleSchema, type EvalRunDependencies, type RunPartition, type RunSettings, type Sample, type SampleContext,
} from "./eval-sample.js";
import { metrics, metricsOfJobKind, type Metric } from "./metrics.js";
import { failedScores, scoreChallenge, scoreHypothesis, type Scores } from "./scoring.js";
import { wilsonInterval } from "./statistics.js";

export {
  evaluatedJobKinds, promptVersions, runPartitions, RunSettingsSchema, SampleSchema, type EvaluatedJobKind, type EvalRunDependencies, type RunPartition, type RunSettings, type Sample,
} from "./eval-sample.js";

/** A metric over the items of a run: `count` items have a value, `passes` is the sum of their pass shares over their repetitions. */
export type MetricSummary = { readonly passes: number; readonly count: number; readonly rate: number | null; readonly interval: { low: number; high: number } | null };

export type RunSummary = {
  readonly runId: string;
  readonly jobKind: RunSettings["jobKind"];
  readonly samples: number;
  /** Every metric; those the job kind does not score have no items. */
  readonly metrics: Readonly<Record<Metric, MetricSummary>>;
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

export function summarize(runId: string, jobKind: RunSettings["jobKind"], samples: readonly Sample[], finished: Date): RunSummary {
  return {
    runId, jobKind, samples: samples.length,
    metrics: Object.fromEntries(metrics.map((name) => [name, metric(samples, (sample) => sample[name])])) as Record<Metric, MetricSummary>,
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

/** A loaded dataset of any evaluated job kind: its identity, its items, and how one of its samples runs. */
type RunnableDataset = {
  readonly jobKind: RunSettings["jobKind"];
  readonly name: string;
  readonly version: number;
  readonly hash: string;
  readonly items: readonly { readonly itemId: string; readonly partition: Partition }[];
  readonly run: (context: SampleContext, itemId: string, repetition: number) => Promise<Sample>;
};

function diagnosisScores(value: Scores): SampleScores {
  return { prediction: value.prediction, rootCause: value.rootCause, valid: null, reached: null };
}

function diagnosisSample(context: SampleContext, item: DatasetItem, manifest: ContextManifest, repetition: number): Promise<Sample> {
  const copies = datasetFolders(context.settings.dataset.folder);
  const sourceCopy = copies.source(item.sourceIdentity);
  const common = {
    itemId: item.itemId, partitionKey: item.clusterId, contextHash: item.contextHash, contextCopy: copies.context(item.contextHash), sourceCopy, contextName: item.clusterId,
    // Runs measure the prompt versions of `promptVersions`, which have no priors section: a context frozen from a thread with fix changes is shown without its priors.
    withoutPriors: true, subject: { kind: "discrepancy-cluster" as const, id: item.clusterId },
    images: (staged: string) => manifest.members.flatMap((member) => [join(staged, member.canonicalCrop), join(staged, member.candidateCrop)]),
    failed: diagnosisScores(failedScores(item)), describe: (value: SampleScores) => `prediction ${verdictText(value.prediction)}, root cause ${verdictText(value.rootCause)}`,
  };
  if (context.settings.jobKind === "hypothesis") {
    const job: EvalJob<HypothesisOutput> = {
      ...common, prompt: (paths) => hypothesisPrompt(withoutPriors(manifest), paths), schema: HypothesisOutputSchema,
      validate: (output) => validateHypothesis(output, manifest, sourceCopy), score: (output) => diagnosisScores(scoreHypothesis(output, item)),
    };
    return runEvalSample(context, job, repetition);
  }
  const job: EvalJob<ChallengeOutput> = {
    ...common, prompt: (paths) => challengePrompt(manifest, item.hypothesis!, paths), schema: ChallengeOutputSchema,
    validate: (output) => validateChallenge(output, item.hypothesis!, manifest, sourceCopy), score: (output) => diagnosisScores(scoreChallenge(output, item)),
  };
  return runEvalSample(context, job, repetition);
}

/** Loads a dataset of any job kind, verifying its hash and copies. */
async function loadRunnable(folder: string): Promise<RunnableDataset> {
  const { jobKind } = readDocument(join(folder, "dataset.json"), z.looseObject({ jobKind: z.enum(evaluatedJobKinds) }));
  if (jobKind === "rank" || jobKind === "scenario") {
    const { dataset, contexts } = await loadDiscoveryDataset(folder);
    return {
      jobKind: dataset.jobKind, name: dataset.name, version: dataset.version, hash: dataset.datasetHash, items: dataset.items,
      run: (context, itemId, repetition) => runDiscoverySample(context, dataset.items.find((item) => item.itemId === itemId)!, contexts.get(itemId)!, repetition),
    };
  }
  const { dataset, manifests } = await loadDataset(folder);
  return {
    jobKind: dataset.jobKind, name: dataset.name, version: dataset.version, hash: dataset.datasetHash, items: dataset.items,
    run: (context, itemId, repetition) => diagnosisSample(context, dataset.items.find((item) => item.itemId === itemId)!, manifests.get(itemId)!, repetition),
  };
}

export type StartRun = { readonly datasetFolder: string; readonly partition: RunPartition; readonly repeat: number; readonly name: string | null; readonly settings: AgentSettings };

/** Starts an eval run of the dataset's job kind with the given agent settings, and runs every sample. */
export async function startEvalRun(dependencies: EvalRunDependencies, start: StartRun): Promise<{ folder: string; summary: RunSummary }> {
  const dataset = await loadRunnable(start.datasetFolder);
  const items = dataset.items.filter((item) => start.partition === "all" || item.partition === start.partition);
  if (items.length === 0) throw new SetupError(`The dataset ${start.datasetFolder} has no item in the ${start.partition} partition.`);
  const runId = dependencies.newRunId();
  const folder = join(dependencies.runsFolder, runId);
  const settings = RunSettingsSchema.parse({
    schemaVersion: 1, runId, name: start.name, dataset: { folder: start.datasetFolder, name: dataset.name, version: dataset.version, hash: dataset.hash },
    jobKind: dataset.jobKind, partition: start.partition, repeat: start.repeat, choice: start.settings.jobs[dataset.jobKind],
    promptVersion: promptVersions[dataset.jobKind], modelPool: start.settings.modelPool, executables: start.settings.executables,
    samples: items.flatMap((item) => Array.from({ length: start.repeat }, (_, index) => `${item.itemId}-${index + 1}`)),
    startedUtc: dependencies.now().toISOString(),
  });
  mkdirSync(runFolders(folder).samples, { recursive: true });
  writeFileSync(runFolders(folder).settings, `${JSON.stringify(settings, null, 2)}\n`);
  return { folder, summary: await runSamples(dependencies, folder, settings, dataset) };
}

/** Continues a run with its stored settings: only the samples without a file run. */
export async function resumeEvalRun(dependencies: EvalRunDependencies, runId: string): Promise<{ folder: string; summary: RunSummary }> {
  const folder = join(dependencies.runsFolder, runId);
  if (!existsSync(runFolders(folder).settings)) throw new SetupError(`There is no eval run ${runId} in ${dependencies.runsFolder}.`);
  const { settings } = readRun(folder);
  if (settings.promptVersion !== promptVersions[settings.jobKind]) {
    throw new SetupError(`Eval run ${runId} used prompt ${settings.promptVersion}; the code now has ${promptVersions[settings.jobKind]}. Start a new run.`);
  }
  const dataset = await loadRunnable(settings.dataset.folder);
  if (dataset.hash !== settings.dataset.hash) throw new SetupError(`The dataset ${settings.dataset.folder} is not the one eval run ${runId} started with.`);
  return { folder, summary: await runSamples(dependencies, folder, settings, dataset) };
}

async function runSamples(dependencies: EvalRunDependencies, folder: string, settings: RunSettings, dataset: RunnableDataset): Promise<RunSummary> {
  const paths = runFolders(folder);
  const missing = settings.samples.filter((key) => !existsSync(paths.sample(key)));
  dependencies.log(`Eval run ${settings.runId}: ${settings.jobKind} on ${dataset.name} v${dataset.version} (${settings.partition}), ${settings.choice.provider} `
    + `(${settings.choice.model ?? "default model"}, effort ${settings.choice.effort}); ${missing.length} of ${settings.samples.length} samples to run.`);
  const agentSettings: AgentSettings = {
    jobs: Object.fromEntries(jobKinds.map((kind) => [kind, settings.choice])) as Record<JobKind, AgentChoice>, modelPool: settings.modelPool,
    runBudgetMinutes: 0, executables: settings.executables,
  };
  const runner = dependencies.agents(agentSettings);
  // An infra failure stops the jobs still running beside it before the run ends.
  const stop = new AbortController();
  const stopOnSignal = () => stop.abort();
  let firstError: unknown = undefined;
  dependencies.signal?.addEventListener("abort", stopOnSignal, { once: true });
  if (dependencies.signal?.aborted === true) throw new SetupError(`Eval run ${settings.runId} was stopped before its jobs started.`);
  const context: SampleContext = { dependencies, runner, settings, signal: stop.signal };
  const outcomes = await Promise.allSettled(missing.map(async (key) => {
    try {
      const separator = key.lastIndexOf("-");
      const itemId = key.slice(0, separator);
      if (!dataset.items.some((entry) => entry.itemId === itemId)) throw new SetupError(`Eval run ${settings.runId} names sample ${key}, whose item the dataset does not have.`);
      const sample = await dataset.run(context, itemId, Number(key.slice(separator + 1)));
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
  const summary = summarize(settings.runId, settings.jobKind, samples, dependencies.now());
  writeFileSync(paths.summary, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

const metricNames: Readonly<Record<Metric, string>> = { prediction: "prediction", rootCause: "root cause", valid: "valid", reached: "reached" };

/** Summary lines of a finished run: the metrics its job kind scores. */
export function summaryLines(summary: RunSummary): string[] {
  const line = (name: string, value: MetricSummary) => `  ${name}: ${Number.isInteger(value.passes) ? value.passes : value.passes.toFixed(2)}/${value.count} items`
    + (value.rate === null ? " (no samples)" : ` = ${value.rate.toFixed(3)}, 95% Wilson [${value.interval!.low.toFixed(3)}, ${value.interval!.high.toFixed(3)}]`);
  return [
    `Eval run ${summary.runId}: ${summary.samples} samples.`,
    ...metricsOfJobKind[summary.jobKind].map((name) => line(metricNames[name], summary.metrics[name])),
    `  failures: invalid_output ${summary.failures.invalid_output}, refused ${summary.failures.refused}; model time ${(summary.modelMs / 1000).toFixed(1)} s; `
      + `cost ${summary.costUsd.toFixed(4)} USD (${summary.unknownCosts} samples without a reported cost)`,
  ];
}
