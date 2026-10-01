import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { join } from "node:path";
import type { Git } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import type { WorkflowPaths } from "../paths.js";
import { addBenchmarkItem, checkBenchmarkItem, readBenchmark } from "./benchmark.js";
import { CommandOptions } from "./command-options.js";
import { listRecords } from "./eval-record.js";
import { labelHindsight } from "./hindsight.js";
import { recordSummary } from "./record-summary.js";

export const evalUsage = `Usage: npm run eval -- <command> [options]

  records                         count the eval records by origin, job kind, result and label
  benchmark add --cluster <id> --fix <commit> --mechanism <class> [--thread <id>] [--regression <commit>]
                                  write a benchmark item for an accepted fix and grade earlier answers by it
  benchmark check                 verify that every benchmark item still replays from git
  hindsight                       grade the answers every benchmark item covers

Exit status: 0 done, 1 certificate refused, 2 a grader job failed, 3 setup error.`;

/** What the evaluation commands use; the composition root makes the real ones. */
export type EvalContext = {
  readonly paths: WorkflowPaths;
  readonly store: BaseStore;
  readonly git: Git;
  readonly now: () => Date;
  readonly log: (line: string) => void;
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

const commands: Readonly<Record<string, Command>> = { records, benchmark, hindsight };

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
