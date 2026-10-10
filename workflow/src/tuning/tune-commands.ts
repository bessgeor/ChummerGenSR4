import { join, resolve } from "node:path";
import { CommandOptions } from "../evals/command-options.js";
import { runDependencies, type EvalContext } from "../evals/eval-context.js";
import { newEvalRunId, summaryLines } from "../evals/eval-run.js";
import { evaluatedJobKinds } from "../evals/evaluated-job-kinds.js";
import { metrics } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import type { ComparisonSummary } from "./active-configuration.js";
import { activate, entryName, rollback } from "./activation.js";
import { candidatesFolder, parseTuningFile, storeCandidate } from "./candidates.js";
import { defaultMaximumExposures, openHoldout, type HoldoutDependencies } from "./holdout.js";
import { proposeCandidate, type TuneDependencies } from "./propose.js";
import { requireCurrent } from "./tuning.js";

export const tuneUsage = `  tune add --file <json>          store a tuning configuration as a candidate (out/evals/tuning/candidates/)
  tune propose --run <run> [--metric <m>]
                                  let a tune job propose a candidate from a complete development run
  tune holdout --candidate <id> --baseline <run> --run <run> [--metric <m>] [--max-exposures <1-3>]
                                  run a candidate that beat the active configuration on development on the test partition
  tune activate --run <run> --baseline <run> --metric <m> --min-pass <0-1> [--max-mean-cost-usd <usd>]
                                  activate the candidate of a holdout run with its certificate (workflow/evals/tuning/)
  tune rollback --job <kind> [--reason <text>]
                                  restore the job kind's previous configuration and certificate`;

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

function holdoutDependencies(context: EvalContext): HoldoutDependencies {
  return { ...runDependencies(context), evalsFolder: context.paths.evalsFolder, tuningFolder: context.tuningFolder() };
}

const holdout: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune holdout", args, ["candidate", "baseline", "run", "metric", "max-exposures"]);
  const outcome = await openHoldout(holdoutDependencies(context), {
    candidate: options.required("candidate"), baselineRun: options.required("baseline"), candidateRun: options.required("run"),
    metric: options.text("metric") === null ? null : options.choice("metric", metrics, "prediction"),
    maxExposures: options.number("max-exposures", defaultMaximumExposures, 1, defaultMaximumExposures, true),
  });
  if ("refused" in outcome) {
    context.log(`Holdout refused:\n  ${outcome.refused.join("\n  ")}`);
    return 1;
  }
  for (const line of summaryLines(outcome.summary)) context.log(line);
  context.log(`Run folder: ${outcome.folder}`);
  return 0;
};

const activateCommand: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune activate", args, ["run", "baseline", "metric", "min-pass", "max-mean-cost-usd"]);
  options.required("metric");
  options.required("min-pass");
  const outcome = activate({ evalsFolder: context.paths.evalsFolder, tuningFolder: context.tuningFolder(), certificatesFolder: context.certificatesFolder() }, {
    run: options.required("run"), baseline: options.required("baseline"),
    thresholds: {
      metric: options.choice("metric", metrics, "prediction"), minPass: options.number("min-pass", 0, 0, 1),
      maxMeanCostUsd: options.text("max-mean-cost-usd") === null ? null : options.number("max-mean-cost-usd", 0, Number.MIN_VALUE, Number.MAX_VALUE),
    },
  }, context.now());
  if (outcome.comparison !== null) context.log(comparisonLine(outcome.comparison));
  if ("refused" in outcome) {
    context.log(`Activation refused:\n  ${outcome.refused.join("\n  ")}`);
    return 1;
  }
  const certificate = outcome.certificate;
  context.log(`Activated ${entryName(outcome.activated)} for ${certificate.jobKind}: certificate ${certificate.promptVersion}, ${certificate.metric} `
    + `${certificate.passes}/${certificate.items} items, 95% Wilson [${certificate.interval.low.toFixed(3)}, ${certificate.interval.high.toFixed(3)}] >= ${certificate.thresholds.minPass}.`);
  return 0;
};

const rollbackCommand: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune rollback", args, ["job", "reason"]);
  options.required("job");
  const jobKind = options.choice("job", evaluatedJobKinds, "hypothesis");
  const { restored, stale } = rollback({ tuningFolder: context.tuningFolder(), certificatesFolder: context.certificatesFolder() }, jobKind, options.text("reason"), context.now());
  context.log(`Rolled back ${jobKind} to ${entryName(restored)}${restored.certificate === null ? ", without a certificate" : `, certificate ${restored.certificate.promptVersion}`}.`);
  if (stale !== null) context.log(`It cannot be dispatched: ${stale}. Roll back again.`);
  return 0;
};

/** One line of a paired comparison, with n and the 95% interval. */
export function comparisonLine(comparison: ComparisonSummary): string {
  const interval = comparison.interval === null ? "n/a" : `[${comparison.interval.low.toFixed(3)}, ${comparison.interval.high.toFixed(3)}]`;
  return `${comparison.candidate} against ${comparison.baseline}, ${comparison.metric}: ${comparison.pairs} pairs${comparison.unpaired > 0 ? ` (${comparison.unpaired} items without a candidate value)` : ""}, mean difference ${comparison.meanDifference?.toFixed(3) ?? "n/a"}, `
    + `95% t interval ${interval}: ${comparison.verdict}; model time ${comparison.modelTimeMeanDifferenceMs === null ? "n/a" : `${(comparison.modelTimeMeanDifferenceMs / 1000).toFixed(1)} s`}`;
}

const commands: Readonly<Record<string, TuneCommand>> = { add, propose, holdout, activate: activateCommand, rollback: rollbackCommand };

/** Runs a `tune` subcommand and returns its exit status; a setup error is thrown. */
export async function runTuneCommand(args: readonly string[], context: EvalContext): Promise<number> {
  const [name, ...rest] = args;
  const command = name === undefined ? undefined : commands[name];
  if (command === undefined) throw new SetupError(`'tune' needs one of ${Object.keys(commands).join(", ")}. See npm run eval -- --help.`);
  return command(rest, context);
}
