import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { efforts, failureKinds, jobKinds, providers } from "../agents/agent-job.js";
import { SetupError } from "../host/setup-error.js";

export const checkLabels = ["confirmed", "refuted", "undecided"] as const;
export type CheckLabel = (typeof checkLabels)[number];

/** How an explanation compares with a known root cause; `symbol` and `file` count as right. */
export const grades = ["symbol", "file", "mechanism", "wrong", "abstained"] as const;
export type Grade = (typeof grades)[number];

export const verdicts = ["correct", "wrong", "unclear"] as const;
export type Verdict = (typeof verdicts)[number];

/** `workflow`: a job of the graph; `eval-run` and `grader`: jobs of the evaluation commands. */
export const origins = ["workflow", "eval-run", "grader"] as const;
export type Origin = (typeof origins)[number];

const HindsightLabelSchema = z.strictObject({ grade: z.enum(grades), item: z.string().min(1), labelledUtc: z.string() });
const ReviewLabelSchema = z.strictObject({ verdict: z.enum(verdicts), note: z.string().nullable(), reviewer: z.string().min(1), reviewedUtc: z.string() });
const GraderLabelSchema = z.strictObject({ score: z.number().min(0).max(1), rationale: z.string().min(1), record: z.string().min(1), gradedUtc: z.string() });

/** The labels of a record, each from its own source; only hindsight and review verdicts are gold. */
const LabelsSchema = z.strictObject({
  check: z.enum(checkLabels).nullable(),
  hindsight: HindsightLabelSchema.nullable(),
  review: ReviewLabelSchema.nullable(),
  grader: GraderLabelSchema.nullable(),
});
export type Labels = z.infer<typeof LabelsSchema>;
export type HindsightLabel = z.infer<typeof HindsightLabelSchema>;
export type ReviewLabel = z.infer<typeof ReviewLabelSchema>;
export type GraderLabel = z.infer<typeof GraderLabelSchema>;

export const noLabels: Labels = { check: null, hindsight: null, review: null, grader: null };

const common = {
  recordId: z.string().min(1),
  jobKind: z.enum(jobKinds),
  /** The workflow thread, eval run or grading session the job ran in. */
  threadId: z.string().min(1),
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
};

/** One model job, in the schema every job kind shares. */
export const EvalRecordSchema = z.strictObject({
  schemaVersion: z.literal(2),
  ...common,
  origin: z.enum(origins),
  subject: z.strictObject({ kind: z.enum(["discrepancy-cluster", "eval-record"]), id: z.string().min(1) }),
  labels: LabelsSchema,
});
export type EvalRecord = z.infer<typeof EvalRecordSchema>;

/** The first version: diagnosis jobs only, with the check label only. */
const EvalRecordV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  ...common,
  subject: z.strictObject({ kind: z.literal("discrepancy-cluster"), id: z.string().min(1) }),
  labels: z.strictObject({ check: z.enum(checkLabels).nullable() }),
});

/** Reads a stored record of either version; a version-1 record is a workflow job without the later labels. */
export function readRecord(value: unknown): EvalRecord {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 1) {
    const old = EvalRecordV1Schema.parse(value);
    return { ...old, schemaVersion: 2, origin: "workflow", labels: { ...noLabels, check: old.labels.check } };
  }
  return EvalRecordSchema.parse(value);
}

export function recordNamespace(jobKind: EvalRecord["jobKind"]): string[] {
  return ["eval-record", jobKind];
}

export async function putRecord(store: BaseStore, record: EvalRecord): Promise<void> {
  await store.put(recordNamespace(record.jobKind), record.recordId, EvalRecordSchema.parse(record));
}

export async function getRecord(store: BaseStore, jobKind: EvalRecord["jobKind"], recordId: string): Promise<EvalRecord> {
  const item = await store.get(recordNamespace(jobKind), recordId);
  if (item === null) throw new SetupError(`The eval record ${recordId} is not in the store.`);
  return readRecord(item.value);
}

/** The record of an ID in whichever job kind's namespace holds it. */
export async function findRecord(store: BaseStore, recordId: string): Promise<EvalRecord> {
  for (const jobKind of jobKinds) {
    const item = await store.get(recordNamespace(jobKind), recordId);
    if (item !== null) return readRecord(item.value);
  }
  throw new SetupError(`The eval record ${recordId} is in no job kind's namespace of the store.`);
}

/** Sets some labels of a stored record and leaves its other labels and fields as they are. */
export async function setLabels(store: BaseStore, record: Pick<EvalRecord, "jobKind" | "recordId">, labels: Partial<Labels>): Promise<EvalRecord> {
  const current = await getRecord(store, record.jobKind, record.recordId);
  const updated = { ...current, labels: { ...current.labels, ...labels } };
  await putRecord(store, updated);
  return updated;
}

/** Sets the check label of a stored record. */
export async function labelRecord(store: BaseStore, jobKind: EvalRecord["jobKind"], recordId: string, check: CheckLabel): Promise<void> {
  await setLabels(store, { jobKind, recordId }, { check });
}

/** Sets the check label of a stored record whose job kind is not known: the record says it, in its own namespace. */
export async function labelRecordById(store: BaseStore, recordId: string, check: CheckLabel): Promise<void> {
  const record = await findRecord(store, recordId);
  await labelRecord(store, record.jobKind, recordId, check);
}

/** Every stored record, of every job kind, in the store's order. */
export async function listRecords(store: BaseStore): Promise<EvalRecord[]> {
  const records: EvalRecord[] = [];
  const page = 200;
  for (let offset = 0; ; offset += page) {
    const items = await store.search(["eval-record"], { limit: page, offset });
    records.push(...items.map((item) => readRecord(item.value)));
    if (items.length < page) return records;
  }
}
