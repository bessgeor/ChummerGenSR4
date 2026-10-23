import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { efforts, providers, type AgentRunner } from "../agents/agent-job.js";
import type { AgentSettings } from "../agents/agent-settings.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import { TuningSchema } from "../tuning/tuning.js";
import { evaluatedJobKinds } from "./evaluated-job-kinds.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { recordNamespace } from "./eval-record.js";

export const runPartitions = ["test", "development", "all"] as const;
export type RunPartition = (typeof runPartitions)[number];

export { evaluatedJobKinds, promptVersions, type EvaluatedJobKind } from "./evaluated-job-kinds.js";

const ChoiceSchema = z.strictObject({ provider: z.enum(providers), model: z.string().nullable(), effort: z.enum(efforts), timeoutMinutes: z.number().positive() });

/** What an eval run was started with; a resumed run keeps it. */
export const RunSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  name: z.string().nullable(),
  dataset: z.strictObject({ folder: z.string(), name: z.string(), version: z.number().int(), hash: z.string() }),
  jobKind: z.enum(evaluatedJobKinds),
  partition: z.enum(runPartitions),
  repeat: z.number().int().positive(),
  choice: ChoiceSchema,
  promptVersion: z.string(),
  /** The tuning configuration the run measures; none for the code's prompt, and none in a run stored before tuning existed. */
  tuning: TuningSchema.nullable().default(null),
  modelPool: z.number().int().positive(),
  executables: z.strictObject({ claude: z.string(), codex: z.string().nullable() }),
  /** Every sample the run has to finish: `<item>-<repetition>`. */
  samples: z.array(z.string()).min(1),
  startedUtc: z.string(),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;

/**
 * One finished sample. A diagnosis sample has `prediction` and `rootCause`, a discovery sample `valid` and `reached`;
 * the metrics a job kind does not score are null, and a sample stored before discovery existed reads them as null.
 */
export const SampleSchema = z.strictObject({
  /** `clusterId`: the item's cluster, or for a discovery item its partition key. */
  key: z.string(), itemId: z.string(), clusterId: z.string(), repetition: z.number().int().positive(), recordId: z.string(),
  status: z.enum(["succeeded", "invalid_output", "refused"]), message: z.string().nullable(), output: z.unknown().nullable(),
  prediction: z.boolean().nullable(), rootCause: z.boolean().nullable(),
  valid: z.boolean().nullable().default(null), reached: z.boolean().nullable().default(null),
  durationMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type Sample = z.infer<typeof SampleSchema>;

export type EvalRunDependencies = {
  readonly store: BaseStore;
  readonly agents: (settings: AgentSettings) => AgentRunner;
  readonly quota: QuotaWaiter;
  readonly runsFolder: string;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly newRunId: () => string;
  readonly signal?: AbortSignal;
};

/** What a sample runner gets: the run's dependencies and settings, its agent runner and the signal that stops it. */
export type SampleContext = {
  readonly dependencies: EvalRunDependencies;
  readonly runner: AgentRunner;
  readonly settings: RunSettings;
  readonly signal: AbortSignal;
};

/** The first attempt of a sample without a stored record: attempts stored by an earlier invocation of the run are never replaced. */
export async function nextAttempt(store: BaseStore, settings: RunSettings, itemId: string, repetition: number): Promise<{ recordId: string; attempt: number }> {
  for (let attempt = 1; ; attempt++) {
    const recordId = `${settings.runId}/${itemId}/${repetition}/${attempt}`;
    if ((await store.get(recordNamespace(settings.jobKind), recordId)) === null) return { recordId, attempt };
  }
}
