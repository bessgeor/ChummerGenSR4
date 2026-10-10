import { resolve } from "node:path";
import { CommandOptions } from "../evals/command-options.js";
import type { EvalContext } from "../evals/eval-commands.js";
import { metrics } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import { candidatesFolder, parseTuningFile, storeCandidate } from "./candidates.js";
import { proposeCandidate, type TuneDependencies } from "./propose.js";
import { requireCurrent } from "./tuning.js";

export const tuneUsage = `  tune add --file <json>          store a tuning configuration as a candidate (out/evals/tuning/candidates/)
  tune propose --run <run> [--metric <m>]
                                  let a tune job propose a candidate from a complete development run`;

type TuneCommand = (args: readonly string[], context: EvalContext) => Promise<number>;

/** What a tune job needs from the evaluation context. */
export function tuneDependencies(context: EvalContext): TuneDependencies {
  return {
    store: context.store, agents: context.agents, settings: context.agentSettings(), quota: context.quota, evalsFolder: context.paths.evalsFolder,
    createScratchFolder: context.createScratchFolder, now: context.now, log: context.log, ...(context.signal === undefined ? {} : { signal: context.signal }),
  };
}

const add: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune add", args, ["file"]);
  const path = resolve(options.required("file"));
  const tuning = requireCurrent(parseTuningFile(path), path);
  const { candidate, existed } = storeCandidate(candidatesFolder(context.paths.evalsFolder), {
    tuning, origin: "added", record: null, fromRun: null, datasetHash: null, rationale: null, createdUtc: context.now().toISOString(),
  });
  context.log(existed ? `Tuning candidate ${candidate.id} (${candidate.tuning.jobKind}) is already stored; it is kept.` : `Tuning candidate ${candidate.id} (${candidate.tuning.jobKind}) stored.`);
  return 0;
};

const propose: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune propose", args, ["run", "metric"]);
  const metric = options.text("metric") === null ? null : options.choice("metric", metrics, "prediction");
  const outcome = await proposeCandidate(tuneDependencies(context), options.required("run"), metric);
  if (outcome.outcome === "failed") {
    context.log(`Tune job failed: ${outcome.kind}: ${outcome.message} (record ${outcome.record}).`);
    return 2;
  }
  if (outcome.outcome === "abstain") {
    context.log(`Tune job abstained: ${outcome.reason} (record ${outcome.record}).`);
    return 0;
  }
  const { candidate } = outcome;
  context.log(`Tuning candidate ${candidate.id} (${candidate.tuning.jobKind}, context ${candidate.tuning.context}, ${candidate.tuning.guidance.length} guidance lines)`
    + `${outcome.existed ? ", already stored" : ""}: ${candidate.rationale ?? ""} (record ${outcome.record}).`);
  return 0;
};

const commands: Readonly<Record<string, TuneCommand>> = { add, propose };

/** Runs a `tune` subcommand and returns its exit status; a setup error is thrown. */
export async function runTuneCommand(args: readonly string[], context: EvalContext): Promise<number> {
  const [name, ...rest] = args;
  const command = name === undefined ? undefined : commands[name];
  if (command === undefined) throw new SetupError(`'tune' needs one of ${Object.keys(commands).join(", ")}. See npm run eval -- --help.`);
  return command(rest, context);
}
