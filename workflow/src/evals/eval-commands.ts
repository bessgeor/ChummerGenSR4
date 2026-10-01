import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { join } from "node:path";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { AgentRunners } from "../agents/agent-runners.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import type { Git } from "../diagnosis/source-snapshot.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import type { WorkflowPaths } from "../paths.js";
import { addBenchmarkItem, checkBenchmarkItem, readBenchmark } from "./benchmark.js";
import { CommandOptions } from "./command-options.js";
import { listRecords } from "./eval-record.js";
import { freezeDataset } from "./dataset.js";
import { gradeRecords } from "./grader.js";
import { labelHindsight } from "./hindsight.js";
import { recordSummary } from "./record-summary.js";
import { defaultQueueOptions, queueLines, reviewQueue } from "./review-queue.js";

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
  freeze --job <hypothesis|challenge> --name <name> [--seed <text>] [--test-percent <0-100>] [--reason <text>]
                                  freeze the next version of a dataset under out/evals/datasets/<name>/

Exit status: 0 done, 1 certificate refused, 2 a grader job failed, 3 setup error.`;

/** What the evaluation commands use; the composition root makes the real ones. */
export type EvalContext = {
  readonly paths: WorkflowPaths;
  readonly store: BaseStore;
  readonly git: Git;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** The agent settings of the local profile, read when a command needs them. */
  readonly agentSettings: () => AgentSettings;
  readonly agents: AgentRunners;
  readonly quota: QuotaWaiter;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly signal?: AbortSignal;
};

type Command = (args: readonly string[], context: EvalContext) => Promise<number>;

const records: Command = async (args, context) => {
  CommandOptions.parse("records", args, []);
  for (const line of recordSummary(await listRecords(context.store))) context.log(line);
  return 0;
};

async function hindsightFor(context: EvalContext): Promise<void> {
  const summary = await labelHindsight(context.store, readBenchmark(context.paths.benchmark), context.now);
  const grades = Object.entries(summary.grades).map(([grade, count]) => `${grade} ${count}`).join(", ");
  context.log(`Hindsight: ${summary.graded} answers graded (${grades}); ${summary.changed} labels set.`);
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
  const { graded, failed } = await gradeRecords({
    store: context.store, agents: context.agents(settings), choice: settings.jobs.grade, quota: context.quota,
    threadFolder: context.paths.threadFolder, logsFolder: join(context.paths.evalsFolder, "grader", "logs"),
    createScratchFolder: context.createScratchFolder, now: context.now, log: context.log,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  }, {
    recordIds: ids === null ? null : ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0),
    limit: options.text("limit") === null ? null : options.number("limit", 0, 1, Number.MAX_SAFE_INTEGER, true),
  });
  context.log(`Grader: ${graded} graded, ${failed} failed.`);
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
  const jobKind = options.choice("job", ["hypothesis", "challenge"] as const, "hypothesis");
  const { folder, dataset } = await freezeDataset({
    name: options.required("name"), jobKind, seed: options.text("seed") ?? "dataset", testPercent: options.number("test-percent", 50, 0, 100, true),
    reason: options.text("reason"), datasetsFolder: join(context.paths.evalsFolder, "datasets"), threadFolder: context.paths.threadFolder,
    records: await listRecords(context.store), benchmark: readBenchmark(context.paths.benchmark), now: context.now, log: context.log,
  });
  const count = (partition: string) => dataset.items.filter((item) => item.partition === partition).length;
  context.log(`Dataset ${dataset.name} v${dataset.version} (${jobKind}): ${dataset.items.length} items, ${count("test")} test and ${count("development")} development, `
    + `${dataset.items.filter((item) => item.gold !== null).length} with gold; hash ${dataset.datasetHash}; ${folder}`);
  return 0;
};

const commands: Readonly<Record<string, Command>> = { records, benchmark, hindsight, grade, queue, freeze };

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
