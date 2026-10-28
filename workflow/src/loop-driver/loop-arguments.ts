import { SetupError } from "../host/setup-error.js";
import { parseArguments, type Arguments } from "../options/arguments.js";

/** `npm run loop`: the options every thread is started with, and the most threads the loop runs (null: no limit). */
export type LoopCommand =
  | { readonly kind: "help" }
  | { readonly kind: "start"; readonly options: readonly string[]; readonly arguments: Arguments; readonly maxRuns: number | null };

/** Options of `npm start` a loop does not take: every thread runs the whole workflow, and the loop starts its threads itself. */
const excluded = new Map([
  ["--only", "every thread of a loop runs the whole workflow"],
  ["--resume", "a loop starts its threads itself"],
]);

export const loopUsage = `Usage: npm run loop -- [options]

Runs workflow threads one after another, each started as npm start would start it with these options, and after each
an automatic tuning (npm run eval -- tune auto), which tunes only when it is due. The next thread starts when the last
one merged a fix or admitted a scenario, or the tuning activated a configuration. The loop is recorded in
out/loop/<loop>/loop.json and checkpointed in out/loop/checkpoints.sqlite.

  --max-runs <n>               run at most n threads (default: no limit)
  --help
  Every other option is an option of npm start (see npm start -- --help) and is given to every thread; --only and
  --resume are not taken.

Exit status: 0 converged (a thread and the tuning after it changed nothing) or limit, 2 failed (a thread exited with 2 or a tuning's job failed),
3 setup error.`;

function maxRuns(text: string | undefined): number {
  if (text === undefined || text.startsWith("--")) throw new SetupError("Option '--max-runs' needs a value.");
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new SetupError(`--max-runs must be a positive integer, got '${text}'.`);
  return Number(text);
}

/** Parses `npm run loop`'s command line; an unknown or excluded option and a missing or invalid value are setup errors. */
export function parseLoopArguments(args: readonly string[]): LoopCommand {
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  const options: string[] = [];
  let runs: number | null = null;
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    const reason = excluded.get(option);
    if (reason !== undefined) throw new SetupError(`npm run loop does not take ${option}: ${reason}.`);
    if (option === "--max-runs") {
      runs = maxRuns(args[++index]);
      continue;
    }
    options.push(option);
  }
  const command = parseArguments(options, "npm run loop -- --help");
  if (command.kind !== "start") throw new Error(`The options ${options.join(" ")} did not parse as a start.`);
  return { kind: "start", options, arguments: command.arguments, maxRuns: runs };
}
