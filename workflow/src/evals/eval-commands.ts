import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoveryPaths } from "../discovery/discovery-paths.js";
import { SetupError } from "../host/setup-error.js";
import { addBenchmarkItem, checkBenchmarkItem, readBenchmark } from "./benchmark.js";
import { CommandOptions } from "./command-options.js";
import { runDependencies, type EvalContext } from "./eval-context.js";
import { listRecords } from "./eval-record.js";
import { certify as issueCertificate } from "./certificate.js";
import { comparisonLines, compareRuns, metrics } from "./comparison.js";
import { metricsOfJobKind } from "./metrics.js";
import { freezeDataset } from "./dataset.js";
import { freezeDiscoveryDataset } from "./discovery-dataset.js";
import { datasetJobKind, readRun, resumeEvalRun, runPartitions, startEvalRun, summaryLines, type StartRun } from "./eval-run.js";
import { gradeRecords } from "./grader.js";
import { labelHindsight } from "./hindsight.js";
import { recordSummary } from "./record-summary.js";
import { snapshotBaseCheck } from "./snapshot-base.js";
import { compareThreads, threadComparisonLines, threadMeasures } from "./thread-comparison.js";
import { defaultQueueOptions, queueLines, reviewQueue } from "./review-queue.js";
import { requireNoHoldoutExposure, selectedTuning } from "../tuning/run-tuning.js";
import { runTuneCommand, tuneUsage } from "../tuning/tune-commands.js";

export const evalUsage = `Usage: npm run eval -- <command> [options]

  records                         count the eval records by origin, job kind, result and label
  benchmark add --cluster <id> --fix <commit> --mechanism <class> [--thread <id>] [--regression <commit>]
                                  write a benchmark item for an accepted fix and grade earlier answers by it
  benchmark check                 verify that every benchmark item still replays from git
  hindsight                       grade the answers every benchmark item covers
  grade [--record <ids>] [--limit <n>]
                                  advisory model grades of answers without one (or of the named records, again)
  queue [--seed <text>] [--per-stratum <n>]
                                  print the review queue (npm run review shows it)
  freeze --job <hypothesis|challenge|rank|scenario> --name <name> [--seed <text>] [--test-percent <0-100>] [--reason <text>]
                                  freeze the next version of a dataset under out/evals/datasets/<name>/
  run --dataset <folder> [--partition test|development|all] [--repeat <n>] [--name <text>] [--tuning active|none|<candidate>]
                                  run the current prompt with the profile's agent choice on a dataset (out/evals/runs/<run>/),
                                  with the active tuning configuration (default), the code's prompt or a candidate (not on test)
  run --resume <run>              finish a stopped eval run with its stored settings
  compare --baseline <run> --candidate <run> [--metric prediction|rootCause|valid|reached]  (default: prediction, or valid for rank and scenario runs)
                                  paired comparison of two eval runs with a 95% confidence interval
  compare-threads --baseline <threads> --candidate <threads>
                                  paired comparison of finished workflow threads (comma-separated IDs) by cluster:
                                  fix rate and model time, with 95% confidence intervals
  certify --run <run> --metric prediction|rootCause|valid|reached --min-pass <0-1> [--max-mean-cost-usd <usd>]
                                  certify the run's job kind configuration for unattended runs (npm start or npm run discover -- --unattended)
${tuneUsage}

Exit status: 0 done, 1 certificate, holdout or activation refused, 2 a grader or tune job failed, 3 setup error.`;

export type { EvalContext } from "./eval-context.js";

type Command = (args: readonly string[], context: EvalContext) => Promise<number>;

const records: Command = async (args, context) => {
  CommandOptions.parse("records", args, []);
  for (const line of recordSummary(await listRecords(context.store))) context.log(line);
  return 0;
};

async function hindsightFor(context: EvalContext): Promise<void> {
  const summary = await labelHindsight(context.store, readBenchmark(context.paths.benchmark), context.now, snapshotBaseCheck(context.git, context.paths.threadFolder));
  const grades = Object.entries(summary.grades).map(([grade, count]) => `${grade} ${count}`).join(", ");
  context.log(`Hindsight: ${summary.graded} answers graded (${grades}); ${summary.changed} labels set; ${summary.ungraded.length} not graded.`);
  for (const item of summary.ungraded) context.log(`  ${item.recordId} is not graded by ${item.itemId}: ${item.reason}.`);
}

const hindsight: Command = async (args, context) => {
  CommandOptions.parse("hindsight", args, []);
  await hindsightFor(context);
  return 0;
};

const benchmark: Command = async (args, context) => {
  const [action, ...rest] = args;
  if (action === "add") {
    const options = CommandOptions.parse("benchmark add", rest, ["cluster", "fix", "mechanism", "thread", "regression"]);
    const item = addBenchmarkItem(context.git, {
      clusterId: options.required("cluster"), fix: options.required("fix"), mechanism: options.required("mechanism"),
      regression: options.text("regression"), threadId: options.text("thread"),
      threadsFolder: join(context.paths.workflowFolder, "threads"), benchmarkFolder: context.paths.benchmark,
    });
    context.log(`Benchmark item ${item.itemId} (${item.kind}): base ${item.base.commit.slice(0, 12)}, fix ${item.fix.commit.slice(0, 12)}, `
      + `${item.fix.files.length} files, from thread ${item.provenance.threadId}.`);
    await hindsightFor(context);
    return 0;
  }
  if (action === "check") {
    CommandOptions.parse("benchmark check", rest, []);
    const items = readBenchmark(context.paths.benchmark);
    const problems = items.flatMap((item) => checkBenchmarkItem(context.git, item));
    if (problems.length > 0) throw new SetupError(problems.join("\n"));
    context.log(`Benchmark: ${items.length} items replay from git.`);
    return 0;
  }
  throw new SetupError("'benchmark' needs 'add' or 'check'. See npm run eval -- --help.");
};

const grade: Command = async (args, context) => {
  const options = CommandOptions.parse("grade", args, ["record", "limit"]);
  const settings = context.agentSettings();
  const ids = options.text("record");
  const { graded, failed, skipped } = await gradeRecords({
    store: context.store, agents: context.agents(settings), choice: settings.jobs.grade, quota: context.quota,
    threadFolder: context.paths.threadFolder, logsFolder: join(context.paths.evalsFolder, "grader", "logs"),
    createScratchFolder: context.createScratchFolder, now: context.now, log: context.log,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  }, {
    recordIds: ids === null ? null : ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0),
    limit: options.text("limit") === null ? null : options.number("limit", 0, 1, Number.MAX_SAFE_INTEGER, true),
  });
  context.log(`Grader: ${graded} graded, ${failed} failed, ${skipped} not graded (context gone or challenged hypothesis unknown).`);
  return failed > 0 ? 2 : 0;
};

const queue: Command = async (args, context) => {
  const options = CommandOptions.parse("queue", args, ["seed", "per-stratum"]);
  const entries = reviewQueue(await listRecords(context.store), {
    seed: options.text("seed") ?? defaultQueueOptions.seed,
    perStratum: options.number("per-stratum", defaultQueueOptions.perStratum, 0, 1000, true),
  });
  for (const line of queueLines(entries)) context.log(line);
  return 0;
};

const freeze: Command = async (args, context) => {
  const options = CommandOptions.parse("freeze", args, ["job", "name", "seed", "test-percent", "reason"]);
  options.required("job");
  const jobKind = options.choice("job", ["hypothesis", "challenge", "rank", "scenario"] as const, "hypothesis");
  if (jobKind === "rank" || jobKind === "scenario") return freezeDiscovery(options, jobKind, context);
  const { folder, dataset } = await freezeDataset({
    name: options.required("name"), jobKind, seed: options.text("seed") ?? "dataset", testPercent: options.number("test-percent", 50, 0, 100, true),
    reason: options.text("reason"), datasetsFolder: join(context.paths.evalsFolder, "datasets"), threadFolder: context.paths.threadFolder,
    records: await listRecords(context.store), benchmark: readBenchmark(context.paths.benchmark),
    snapshotBase: snapshotBaseCheck(context.git, context.paths.threadFolder), now: context.now, log: context.log,
  });
  const count = (partition: string) => dataset.items.filter((item) => item.partition === partition).length;
  context.log(`Dataset ${dataset.name} v${dataset.version} (${jobKind}): ${dataset.items.length} items, ${count("test")} test and ${count("development")} development, `
    + `${dataset.items.filter((item) => item.gold !== null).length} with gold; hash ${dataset.datasetHash}; ${folder}`);
  return 0;
};

async function freezeDiscovery(options: CommandOptions, jobKind: "rank" | "scenario", context: EvalContext): Promise<number> {
  const { folder, dataset } = await freezeDiscoveryDataset({
    name: options.required("name"), jobKind, seed: options.text("seed") ?? "dataset", testPercent: options.number("test-percent", 50, 0, 100, true),
    reason: options.text("reason"), datasetsFolder: join(context.paths.evalsFolder, "datasets"),
    threadFolder: (threadId) => discoveryPaths(context.paths.repositoryRoot).thread(threadId).root, records: await listRecords(context.store), now: context.now, log: context.log,
  });
  const count = (partition: string) => dataset.items.filter((item) => item.partition === partition).length;
  context.log(`Dataset ${dataset.name} v${dataset.version} (${jobKind}): ${dataset.items.length} items, ${count("test")} test and ${count("development")} development, `
    + `${dataset.items.filter((item) => item.gold !== null).length} with gold; hash ${dataset.datasetHash}; ${folder}`);
  return 0;
}

/** How `run` starts: the dataset, partition and repetitions, and the configuration `--tuning` names (a candidate never on the holdout). */
function runStart(options: CommandOptions, context: EvalContext): StartRun {
  const datasetFolder = resolve(options.required("dataset"));
  const partition = options.choice("partition", runPartitions, "test");
  const jobKind = datasetJobKind(datasetFolder);
  const tuning = selectedTuning(options.text("tuning") ?? "active", jobKind, { tuningFolder: context.tuningFolder(), evalsFolder: context.paths.evalsFolder });
  requireNoHoldoutExposure(tuning, jobKind, partition, context.tuningFolder());
  return { datasetFolder, partition, repeat: options.number("repeat", 1, 1, 100, true), name: options.text("name"), settings: context.agentSettings(), tuning };
}

const run: Command = async (args, context) => {
  const options = CommandOptions.parse("run", args, ["dataset", "partition", "repeat", "name", "resume", "tuning"]);
  const resumed = options.text("resume");
  if (resumed !== null) {
    for (const other of ["dataset", "partition", "repeat", "name", "tuning"]) {
      if (options.text(other) !== null) throw new SetupError(`--resume takes no --${other}: a run keeps the settings it started with.`);
    }
  }
  const { folder, summary } = resumed !== null
    ? await resumeEvalRun(runDependencies(context), resumed)
    : await startEvalRun(runDependencies(context), runStart(options, context));
  for (const line of summaryLines(summary)) context.log(line);
  context.log(`Run folder: ${folder}`);
  return 0;
};

const compare: Command = async (args, context) => {
  const options = CommandOptions.parse("compare", args, ["baseline", "candidate", "metric"]);
  const runs = join(context.paths.evalsFolder, "runs");
  // Without --metric, the first metric the runs' job kind scores.
  const fallback = metricsOfJobKind[readRun(join(runs, options.required("baseline"))).settings.jobKind][0];
  const metric = options.choice("metric", metrics, fallback);
  const comparison = compareRuns(join(runs, options.required("baseline")), join(runs, options.required("candidate")), metric, context.now());
  const folder = join(context.paths.evalsFolder, "comparisons");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${comparison.baseline}--${comparison.candidate}-${metric}.json`);
  writeFileSync(path, `${JSON.stringify(comparison, null, 2)}\n`);
  for (const line of comparisonLines(comparison)) context.log(line);
  context.log(`Comparison: ${path}`);
  return 0;
};

const compareThreadsCommand: Command = async (args, context) => {
  const options = CommandOptions.parse("compare-threads", args, ["baseline", "candidate"]);
  const ids = (name: string) => {
    const list = options.required(name).split(",").map((id) => id.trim()).filter((id) => id.length > 0);
    if (list.length === 0) throw new SetupError(`--${name} names no thread.`);
    return list;
  };
  const sides = { baseline: ids("baseline"), candidate: ids("candidate") };
  const records = await listRecords(context.store);
  const measures = (threads: readonly string[]) => threads.flatMap((threadId) => threadMeasures(context.paths.threadFolder(threadId), threadId, records));
  const comparison = compareThreads(measures(sides.baseline), measures(sides.candidate), sides, context.now());
  const folder = join(context.paths.evalsFolder, "comparisons");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `threads-${comparison.createdUtc.replace(/[-:]/g, "").replace(/\.\d+/, "")}-${randomBytes(4).toString("hex")}.json`);
  writeFileSync(path, `${JSON.stringify(comparison, null, 2)}\n`);
  for (const line of threadComparisonLines(comparison)) context.log(line);
  context.log(`Comparison: ${path}`);
  return 0;
};

const certify: Command = async (args, context) => {
  const options = CommandOptions.parse("certify", args, ["run", "metric", "min-pass", "max-mean-cost-usd"]);
  options.required("metric");
  options.required("min-pass");
  const folder = context.certificatesFolder();
  const outcome = issueCertificate(join(context.paths.evalsFolder, "runs", options.required("run")), {
    metric: options.choice("metric", metrics, "prediction"), minPass: options.number("min-pass", 0, 0, 1),
    maxMeanCostUsd: options.text("max-mean-cost-usd") === null ? null : options.number("max-mean-cost-usd", 0, Number.MIN_VALUE, Number.MAX_VALUE),
  }, folder, context.now());
  if ("refused" in outcome) {
    context.log(`Certificate refused:\n  ${outcome.refused.join("\n  ")}`);
    return 1;
  }
  const certificate = outcome.certificate;
  context.log(`Certificate for ${certificate.jobKind}: ${certificate.agent.provider} (${certificate.agent.model ?? "default model"}, effort ${certificate.agent.effort}), `
    + `${certificate.promptVersion}; ${certificate.metric} ${certificate.passes}/${certificate.items} items, 95% Wilson [${certificate.interval.low.toFixed(3)}, ${certificate.interval.high.toFixed(3)}] `
    + `>= ${certificate.thresholds.minPass}; ${join(folder, `${certificate.jobKind}.json`)}`);
  return 0;
};

const commands: Readonly<Record<string, Command>> = {
  records, benchmark, hindsight, grade, queue, freeze, run, compare, "compare-threads": compareThreadsCommand, certify, tune: runTuneCommand,
};

/** Runs one evaluation command and returns its exit status; a setup error is thrown. */
export async function runEvalCommand(args: readonly string[], context: EvalContext): Promise<number> {
  const [name, ...rest] = args;
  if (name === undefined || name === "--help" || name === "-h") {
    context.log(evalUsage);
    return 0;
  }
  const command = commands[name];
  if (command === undefined) throw new SetupError(`Unknown command '${name}'. See npm run eval -- --help.`);
  return command(rest, context);
}
