import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { efforts, failureKinds, jobKinds, providers } from "../agents/agent-job.js";
import { SetupError } from "../host/setup-error.js";

export const checkLabels = ["confirmed", "refuted", "undecided"] as const;
export type CheckLabel = (typeof checkLabels)[number];

/** One model job, in the schema every job kind shares. */
export const EvalRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordId: z.string().min(1),
  jobKind: z.enum(jobKinds),
  threadId: z.string().min(1),
  subject: z.strictObject({ kind: z.literal("discrepancy-cluster"), id: z.string().min(1) }),
  contextHash: z.string().regex(/^[0-9a-f]{64}$/),
  promptVersion: z.string().min(1),
  agent: z.strictObject({ provider: z.enum(providers), model: z.string().nullable(), effort: z.enum(efforts) }),
  startedUtc: z.string(),
  finishedUtc: z.string(),
  durationMs: z.number().int().nonnegative(),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(), cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(), costUsd: z.number().nonnegative().nullable(),
  }).nullable(),
  result: z.strictObject({ status: z.enum(["succeeded", ...failureKinds]), message: z.string().nullable() }),
  output: z.unknown().nullable(),
  labels: z.strictObject({ check: z.enum(checkLabels).nullable() }),
});
export type EvalRecord = z.infer<typeof EvalRecordSchema>;

export function recordNamespace(jobKind: EvalRecord["jobKind"]): string[] {
  return ["eval-record", jobKind];
}

export async function putRecord(store: BaseStore, record: EvalRecord): Promise<void> {
  await store.put(recordNamespace(record.jobKind), record.recordId, EvalRecordSchema.parse(record));
}

export async function getRecord(store: BaseStore, jobKind: EvalRecord["jobKind"], recordId: string): Promise<EvalRecord> {
  const item = await store.get(recordNamespace(jobKind), recordId);
  if (item === null) throw new SetupError(`The eval record ${recordId} is not in the store.`);
  return EvalRecordSchema.parse(item.value);
}

/** Sets the check label of a stored record. */
export async function labelRecord(store: BaseStore, jobKind: EvalRecord["jobKind"], recordId: string, check: CheckLabel): Promise<void> {
  const record = await getRecord(store, jobKind, recordId);
  await putRecord(store, { ...record, labels: { ...record.labels, check } });
}

/** Sets the check label of a stored record whose job kind is not known: the record says it, in its own namespace. */
export async function labelRecordById(store: BaseStore, recordId: string, check: CheckLabel): Promise<void> {
  for (const jobKind of jobKinds) {
    if ((await store.get(recordNamespace(jobKind), recordId)) !== null) {
      await labelRecord(store, jobKind, recordId, check);
      return;
    }
  }
  throw new SetupError(`The eval record ${recordId} is in no job kind's namespace of the store.`);
}
