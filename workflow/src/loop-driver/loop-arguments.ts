import { SetupError } from "../host/setup-error.js";
import { parseArguments, type Arguments } from "../options/arguments.js";
import { checkLoopId } from "./loop-document.js";

/**
 * `npm run loop`: a start with the options every thread is started with and the most threads the loop runs (null: no
 * limit), a resume of a loop that stopped, or a stop request for a loop.
 */
export type LoopCommand =
  | { readonly kind: "help" }
  | { readonly kind: "start"; readonly options: readonly string[]; readonly arguments: Arguments; readonly maxRuns: number | null }
  | { readonly kind: "resume"; readonly loopId: string }
  | { readonly kind: "stop"; readonly loopId: string }
  /** `--pause` or `--unpause` of a loop, or of one of its desktop lanes (`lane`). */
  | { readonly kind: "pause"; readonly loopId: string; readonly paused: boolean; readonly lane: string | null };

/** Options of `npm start` a loop does not take: every thread runs the whole workflow. */
const excluded = new Map([
  ["--only", "every thread of a loop runs the whole workflow"],
]);

/** The options that name a loop and take no other option. */
const loopOptions = new Map([
  ["--resume", "a loop keeps the options it was started with"],
  ["--stop", "a stop request names only its loop"],
] as const);

export const loopUsage = `Usage: npm run loop -- [options]
       npm run loop -- --resume <loop>
       npm run loop -- --stop <loop>
       npm run loop -- --pause <loop> | --unpause <loop> [--lane <lane>]

Runs workflow threads one after another, each started as npm start would start it with these options, and after each
an automatic tuning (npm run eval -- tune auto), which tunes only when it is due. The next thread starts when the last
one merged a fix or admitted a scenario, or the tuning activated a configuration. The loop is recorded in
out/loop/<loop>/loop.json and checkpointed in out/loop/checkpoints.sqlite.

  --max-runs <n>               run at most n threads (default: no limit)
  --resume <loop>              continue a loop that stopped with a setup error or Ctrl+C, with the options it was
                               started with: the thread or tuning it was running is resumed, then the loop goes on
  --stop <loop>                ask a loop to stop: it ends stopped before its next thread or tuning, after the step
                               that is running; a paused loop once it is unpaused
  --pause <loop>               pause the loop: running jobs and captures finish, and nothing new starts until --unpause
  --unpause <loop>             go on with the paused loop
  --lane <lane>                with --pause or --unpause: pause or unpause only this desktop lane of the profile, which
                               takes no new capture while paused
  --help
  Every other option is an option of npm start (see npm start -- --help) and is given to every thread; --only is not
  taken.

Exit status: 0 converged (a thread and the tuning after it changed nothing), limit or stopped (also for --stop), 2 failed
(a thread exited with 2 or a tuning's job failed), 3 setup error: a loop that started stays running and resumes with
--resume; a refused --resume or --stop changes nothing. --pause and --unpause exit with 0 once the control file
(out/loop/<loop>/control.json) is written.`;

function maxRuns(text: string | undefined): number {
  if (text === undefined || text.startsWith("--")) throw new SetupError("Option '--max-runs' needs a value.");
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new SetupError(`--max-runs must be a positive integer, got '${text}'.`);
  return Number(text);
}

function value(args: readonly string[], index: number, option: string): string {
  const text = args[index];
  if (text === undefined || text.startsWith("--")) throw new SetupError(`Option '${option}' needs a value.`);
  return text;
}

/** `--pause <loop>` or `--unpause <loop>`, with `--lane <lane>` at most, and nothing else. */
function parsePause(args: readonly string[]): LoopCommand {
  let pause: { loopId: string; paused: boolean } | null = null;
  let lane: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    if (option === "--pause" || option === "--unpause") {
      if (pause !== null) throw new SetupError("Give one --pause or --unpause.");
      pause = { loopId: value(args, ++index, option), paused: option === "--pause" };
    } else if (option === "--lane") {
      if (lane !== null) throw new SetupError("Give --lane once.");
      lane = value(args, ++index, option);
    } else {
      throw new SetupError(`--pause and --unpause take only --lane, not ${option}.`);
    }
  }
  if (pause === null) throw new SetupError("--lane goes with --pause or --unpause.");
  return { kind: "pause", ...pause, lane };
}

/** Parses `npm run loop`'s command line; an unknown or excluded option and a missing or invalid value are setup errors. */
export function parseLoopArguments(args: readonly string[]): LoopCommand {
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  if (args.some((option) => option === "--pause" || option === "--unpause" || option === "--lane")) return parsePause(args);
  for (const [option, reason] of loopOptions) {
    const index = args.indexOf(option);
    if (index === -1) continue;
    const loopId = value(args, index + 1, option);
    if (args.length !== 2) throw new SetupError(`${option} takes no other options: ${reason}.`);
    return { kind: option === "--resume" ? "resume" : "stop", loopId: checkLoopId(loopId) };
  }
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
