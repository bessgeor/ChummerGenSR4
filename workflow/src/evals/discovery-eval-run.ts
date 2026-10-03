import type { RankContext, ScenarioContext } from "../discovery/discovery-context.js";
import { readLabels } from "../discovery/discovery-context.js";
import { RankOutputSchema, ScenarioOutputSchema, type RankOutput, type ScenarioOutput } from "../discovery/job-schemas.js";
import { rankPrompt, scenarioPrompt } from "../discovery/prompts.js";
import { validateRank, validateScenario } from "../discovery/validation.js";
import { datasetFolders } from "./dataset.js";
import type { DiscoveryDatasetItem } from "./discovery-dataset.js";
import { failedDiscoveryScores, scoreRank, scoreScenario, type DiscoveryScores } from "./discovery-scoring.js";
import { runEvalSample, verdictText, type EvalJob, type SampleScores } from "./eval-job.js";
import type { Sample, SampleContext } from "./eval-sample.js";

function scores(value: DiscoveryScores): SampleScores {
  return { prediction: null, rootCause: null, valid: value.valid, reached: value.reached };
}

function describe(value: SampleScores): string {
  return `valid ${verdictText(value.valid)}, reached ${verdictText(value.reached)}`;
}

/** Runs one sample of a rank or scenario item: the current prompt on the frozen context, scored by `valid` and `reached`. */
export function runDiscoverySample(context: SampleContext, item: DiscoveryDatasetItem, frozen: RankContext | ScenarioContext, repetition: number): Promise<Sample> {
  const copies = datasetFolders(context.settings.dataset.folder);
  const common = {
    itemId: item.itemId, partitionKey: item.key, contextHash: item.contextHash, contextCopy: copies.context(item.contextHash), sourceCopy: copies.source(item.sourceIdentity),
    contextName: "context", withoutPriors: false, images: () => [], failed: scores(failedDiscoveryScores(item)), describe,
  };
  if (frozen.kind === "rank") {
    const job: EvalJob<RankOutput> = {
      ...common, subject: { kind: "discovery-thread", id: item.key }, prompt: (paths) => rankPrompt(frozen, paths), schema: RankOutputSchema,
      validate: (output) => validateRank(output, frozen), score: (output) => scores(scoreRank(output, item)),
    };
    return runEvalSample(context, job, repetition);
  }
  const labels = readLabels(copies.context(item.contextHash), frozen);
  const job: EvalJob<ScenarioOutput> = {
    ...common, subject: { kind: "discovery-target", id: item.key }, prompt: (paths) => scenarioPrompt(frozen, paths), schema: ScenarioOutputSchema,
    validate: (output) => validateScenario(output, frozen), score: (output) => scores(scoreScenario(output, item, frozen, labels)),
  };
  return runEvalSample(context, job, repetition);
}
