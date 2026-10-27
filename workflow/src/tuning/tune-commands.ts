import { randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { CommandOptions } from "../evals/command-options.js";
import { runDependencies, type EvalContext } from "../evals/eval-context.js";
import { newEvalRunId, summaryLines } from "../evals/eval-run.js";
import { evaluatedJobKinds } from "../evals/evaluated-job-kinds.js";
import { metrics } from "../evals/metrics.js";
import { SetupError } from "../host/setup-error.js";
import type { ComparisonSummary } from "./active-configuration.js";
import { activate, entryName, rollback } from "./activation.js";
import { autoTuningDefaults, autoTuningPath, checkAutoTuning, newTuningId } from "./auto-tuning.js";
import { candidatesFolder, parseTuningFile, storeCandidate } from "./candidates.js";
import { cycleFolder, cycleOptions, readCycle, type Cycle, type CycleDependencies } from "./cycle.js";
import { defaultMaximumExposures, openHoldout, type HoldoutDependencies } from "./holdout.js";
import { proposeCandidate, type TuneDependencies } from "./propose.js";
import type { TuningStateValue } from "./tuning-graph.js";
import { compileTuningGraph, runTuningThread, type TuningGraph } from "./tuning-runner.js";
import { tuningSteps, type TuningRun } from "./tuning-steps.js";
import { requireCurrent } from "./tuning.js";

export const tuneUsage = `  tune add --file <json>          store a tuning configuration as a candidate (out/evals/tuning/candidates/)
  tune propose --run <run> [--metric <m>]
                                  let a tune job propose a candidate from a complete development run
  tune holdout --candidate <id> --baseline <run> --run <run> [--metric <m>] [--max-exposures <1-3>]
                                  run a candidate that beat the active configuration on development on the test partition
  tune activate --run <run> --baseline <run> --metric <m> --min-pass <0-1> [--max-mean-cost-usd <usd>]
                                  activate the candidate of a holdout run with its certificate (workflow/evals/tuning/)
  tune rollback --job <kind> [--reason <text>]
                                  restore the job kind's previous configuration and certificate
  tune cycle --dataset <folder> --min-pass <0-1> [--metric <m>] [--candidates <1-3>] [--repeat <n>] [--max-exposures <1-3>] [--max-mean-cost-usd <usd>]
                                  development baseline, proposals, holdout and activation in one resumable cycle
  tune cycle --resume <cycle>     continue a stopped cycle with its stored options
  tune auto [--force]             count the new workflow hypothesis records against the profile's autoTuning.every (default ${autoTuningDefaults.every}); a tuning is
                                  due with that many, or with --force: it freezes the next version of autoTuning.dataset (default ${autoTuningDefaults.dataset})
                                  and runs a cycle on it (out/evals/tuning/auto.json); a tuning in progress is continued first`;

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

/** The tuning graph's steps over the evaluation context, and the graph compiled with the tuning threads' checkpointer. */
function tuningGraph(context: EvalContext): { graph: TuningGraph; steps: TuningRun } {
  const cycle: CycleDependencies = {
    run: holdoutDependencies(context), tune: tuneDependencies(context), evalsFolder: context.paths.evalsFolder, tuningFolder: context.tuningFolder(),
    certificatesFolder: context.certificatesFolder(), newRunId: () => newEvalRunId(context.now()),
  };
  const steps = tuningSteps({ cycle, store: context.store, paths: context.paths, git: context.git });
  return { graph: compileTuningGraph(steps, context.tuningCheckpointer()), steps };
}

/** Exit status of a finished cycle: 0 activated or no improvement, 1 rejected, 2 failed. */
function cycleStatus(cycle: Cycle): number {
  return cycle.outcome === "rejected" ? 1 : cycle.outcome === "failed" ? 2 : 0;
}

const cycleCommand: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune cycle", args, ["dataset", "metric", "min-pass", "candidates", "repeat", "max-exposures", "max-mean-cost-usd", "resume"]);
  const resumed = options.text("resume");
  let input: TuningStateValue;
  if (resumed !== null) {
    for (const other of ["dataset", "metric", "min-pass", "candidates", "repeat", "max-exposures", "max-mean-cost-usd"]) {
      if (options.text(other) !== null) throw new SetupError(`--resume takes no --${other}: a cycle keeps the options it was started with.`);
    }
    // A cycle keeps its stored options; its thread continues from its checkpoint, or runs again from the baseline when it
    // has none or concluded, and its steps find what the cycle recorded.
    const stored = readCycle(context.paths.evalsFolder, resumed);
    input = { tuningId: resumed, request: { kind: "cycle", options: stored.options }, dataset: stored.options.dataset, cycle: null, concluded: null };
    if (stored.outcome === "running") context.log(`Tuning cycle ${resumed}: resumed.`);
  } else {
    options.required("min-pass");
    const cycleId = `tc-${context.now().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}-${randomBytes(4).toString("hex")}`;
    const cycle = cycleOptions({
      dataset: resolve(options.required("dataset")), metric: options.text("metric") === null ? null : options.choice("metric", metrics, "prediction"),
      minPass: options.number("min-pass", 0, 0, 1), candidates: options.number("candidates", 1, 1, 3, true), repeat: options.number("repeat", 1, 1, 100, true),
      maxExposures: options.number("max-exposures", defaultMaximumExposures, 1, defaultMaximumExposures, true),
      maxMeanCostUsd: options.text("max-mean-cost-usd") === null ? null : options.number("max-mean-cost-usd", 0, Number.MIN_VALUE, Number.MAX_VALUE),
    });
    input = { tuningId: cycleId, request: { kind: "cycle", options: cycle }, dataset: cycle.dataset, cycle: null, concluded: null };
  }
  const { graph, steps } = tuningGraph(context);
  const cycle = await runTuningThread(graph, steps, input, `npm run eval -- tune cycle --resume ${input.tuningId}`, context.signal);
  for (const line of cycleLines(cycle)) context.log(line);
  context.log(`Cycle folder: ${cycleFolder(context.paths.evalsFolder, cycle.cycleId)}`);
  return cycleStatus(cycle);
};

/** The cycle's runs, comparisons and outcome, with n and the 95% interval of every difference. */
export function cycleLines(cycle: Cycle): string[] {
  return [
    `Tuning cycle ${cycle.cycleId} (${cycle.jobKind}, metric ${cycle.options.metric}): ${cycle.outcome}; active before: ${cycle.active}.`,
    `  development baseline: ${cycle.baseline ?? "none"}`,
    ...cycle.proposals.map((proposal, index) => `  proposal ${index + 1}: ${proposal.outcome}${proposal.candidate === null ? "" : ` ${proposal.candidate}, run ${proposal.run ?? "none"}`}`
      + `${proposal.development === null ? "" : `; ${comparisonLine(proposal.development)}`}`),
    ...(cycle.holdout === null ? [] : [`  holdout: ${cycle.selected} as run ${cycle.holdout.run}${cycle.holdout.refused === null ? "" : " (refused)"}; test baseline ${cycle.testBaseline ?? "none"}`]),
    ...(cycle.activation?.comparison == null ? [] : [`  test: ${comparisonLine(cycle.activation.comparison)}`]),
    ...cycle.reasons.map((reason) => `  ${reason}`),
  ];
}

/**
 * The tuning and certificates folders an automatic tuning would write inside the repository. Its cycle runs on its
 * folders in place, so it runs only when they lie outside the repository's working tree.
 */
function foldersInsideRepository(context: EvalContext): string[] {
  const inside = (folder: string) => {
    const path = relative(resolve(context.paths.repositoryRoot), resolve(folder));
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  };
  return [context.tuningFolder(), context.certificatesFolder()].filter(inside);
}

/**
 * Counts the new hypothesis records. Not due prints the count and exits with 0. A due tuning runs as a new tuning
 * thread: it records the tuning as in progress with the records it counts, freezes the next version of the automatic
 * dataset and runs a cycle on it. A tuning in progress is continued first, without counting or freezing again.
 */
const auto: TuneCommand = async (args, context) => {
  const options = CommandOptions.parse("tune auto", args, [], ["force"]);
  const settings = context.autoTuning();
  const evalsFolder = context.paths.evalsFolder;
  const trigger = await checkAutoTuning({ store: context.store, evalsFolder, now: context.now, newTuningId }, settings, options.flag("force"));
  if (trigger.kind === "not_due") {
    context.log(`Automatic tuning: ${trigger.count} of ${trigger.every} new hypothesis records; not due.`);
    return 0;
  }
  const inside = foldersInsideRepository(context);
  if (inside.length > 0) {
    throw new SetupError(`tune auto runs its cycle on the tuning and certificates folders in place, so they must lie outside the repository; `
      + `${inside.join(" and ")} ${inside.length === 1 ? "lies" : "lie"} inside it. Name other folders with tuning and certificates in the profile.`);
  }
  let input: TuningStateValue;
  if (trigger.kind === "due") {
    context.log(`Automatic tuning: ${trigger.records.length} of ${trigger.every} new hypothesis records${trigger.forced ? ", forced" : ""}; due.`);
    const tuningId = newTuningId(context.now());
    input = { tuningId, request: { kind: "auto", records: trigger.records, forced: trigger.forced, settings }, dataset: null, cycle: null, concluded: null };
    context.log(`Automatic tuning ${tuningId}: resume it after an interruption with: npm run eval -- tune auto`);
  } else {
    const { tuning } = trigger;
    context.log(`Automatic tuning ${tuning.tuningId}: in progress since ${tuning.startedUtc}; continued.`);
    input = { tuningId: tuning.tuningId, request: { kind: "auto", records: tuning.records, forced: tuning.forced, settings }, dataset: tuning.dataset, cycle: null, concluded: null };
  }
  const { graph, steps } = tuningGraph(context);
  const cycle = await runTuningThread(graph, steps, input, "npm run eval -- tune auto", context.signal);
  for (const line of cycleLines(cycle)) context.log(line);
  context.log(`Cycle folder: ${cycleFolder(evalsFolder, cycle.cycleId)}`);
  context.log(`Automatic tuning ${input.tuningId}: ${cycle.outcome}; dataset ${cycle.options.dataset}; state ${autoTuningPath(evalsFolder)}`);
  return cycleStatus(cycle);
};

const commands: Readonly<Record<string, TuneCommand>> = { add, propose, holdout, activate: activateCommand, rollback: rollbackCommand, cycle: cycleCommand, auto };

/** Runs a `tune` subcommand and returns its exit status; a setup error is thrown. */
export async function runTuneCommand(args: readonly string[], context: EvalContext): Promise<number> {
  const [name, ...rest] = args;
  const command = name === undefined ? undefined : commands[name];
  if (command === undefined) throw new SetupError(`'tune' needs one of ${Object.keys(commands).join(", ")}. See npm run eval -- --help.`);
  return command(rest, context);
}
