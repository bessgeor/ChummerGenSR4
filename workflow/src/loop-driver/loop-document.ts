import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { newThreadId } from "../graph/run-workflow.js";
import { SetupError } from "../host/setup-error.js";
import { threadOutcomes } from "../loop/outcome.js";
import { readDocument } from "../steps/read-document.js";
import { writeDocument } from "../steps/write-document.js";

/** Where loops keep their checkpoints and folders, relative to the repository root. */
export type LoopPaths = {
  readonly root: string;
  readonly checkpoints: string;
  folder(loopId: string): string;
  document(loopId: string): string;
};

export function loopPaths(repositoryRoot: string): LoopPaths {
  const root = join(repositoryRoot, "out", "loop");
  return {
    root,
    checkpoints: join(root, "checkpoints.sqlite"),
    folder: (loopId) => join(root, loopId),
    document: (loopId) => join(root, loopId, "loop.json"),
  };
}

/** `loop-<time>-<suffix>`. */
export function newLoopId(now: Date): string {
  return newThreadId(now, "loop");
}

export const loopStatuses = ["running", "converged", "limit", "stopped", "failed"] as const;
export type LoopStatus = (typeof loopStatuses)[number];

/** What a thread changed that the next thread would see, read from its `outcome.json`. */
const ThreadSummarySchema = z.strictObject({
  outcome: z.enum(threadOutcomes),
  /** The clusters it fixed (promoted). */
  fixed: z.array(z.string()),
  /** The clusters whose fix it merged into the branch it started on. */
  merged: z.array(z.string()),
  /** Whether the merges changed the branch's tree: a fix the branch had already is merged without changing it. */
  sourceChanged: z.boolean(),
  /** The cases its discovery admitted. */
  admitted: z.array(z.string()),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

const TuningStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("not_due"), count: z.number().int().nonnegative(), every: z.number().int().positive() }),
  /** A tuning recorded before it starts; its outcome and exit status once it ended. */
  z.strictObject({
    kind: z.literal("tuning"), tuningId: z.string().regex(/^tune-/), cycle: z.string().min(1),
    outcome: z.enum(["activated", "no_improvement", "rejected", "failed"]).nullable(), exitStatus: z.number().int().nullable(),
  }),
]);
export type TuningStep = z.infer<typeof TuningStepSchema>;

/** What the loop decided after an iteration, with why. */
const DecisionSchema = z.strictObject({
  next: z.enum(["thread", "converged", "limit", "failed"]),
  reasons: z.array(z.string().min(1)),
});
export type Decision = z.infer<typeof DecisionSchema>;

const IterationSchema = z.strictObject({
  /** The workflow thread's ID, recorded before the thread starts. */
  thread: z.string().min(1),
  startedUtc: z.string(),
  endedUtc: z.string().nullable(),
  exitStatus: z.number().int().nullable(),
  /** Null until the thread ended. */
  summary: ThreadSummarySchema.nullable(),
  /** Null until the tuning step starts. */
  tuning: TuningStepSchema.nullable(),
  decision: DecisionSchema.nullable(),
});
export type Iteration = z.infer<typeof IterationSchema>;

/** `out/loop/<loop>/loop.json`. */
export const LoopDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  loopId: z.string().regex(/^loop-/),
  startedUtc: z.string(),
  /** The options every thread is started with, as given, and the most threads the loop runs. */
  options: z.strictObject({ arguments: z.array(z.string()), maxRuns: z.number().int().positive().nullable() }),
  status: z.enum(loopStatuses),
  iterations: z.array(IterationSchema),
});
export type LoopDocument = z.infer<typeof LoopDocumentSchema>;

export function writeLoopDocument(path: string, document: LoopDocument): void {
  writeDocument(path, LoopDocumentSchema.parse(document));
}

export function readLoopDocument(path: string): LoopDocument {
  return readDocument(path, LoopDocumentSchema);
}

/** The fields of a thread's `outcome.json` the loop reads. */
const OutcomeSchema = z.looseObject({
  outcome: z.enum(threadOutcomes),
  clusters: z.array(z.looseObject({ clusterId: z.string(), disposition: z.string() })),
  merge: z.looseObject({
    before: z.string().nullable(),
    after: z.string().nullable(),
    fixes: z.array(z.looseObject({ clusterId: z.string(), status: z.string(), mergeCommit: z.string().nullable() })),
  }).nullable(),
  discovery: z.looseObject({ admitted: z.array(z.string()) }).nullable(),
});

/**
 * What a finished thread changed, from its `outcome.json`, with `treeOf` giving a commit's tree: the merges changed the
 * source when the branch's tree after them differs from the one before. A thread run without `--only` always concludes,
 * so a thread that finished without its `outcome.json` is a setup error.
 */
export function readThreadSummary(threadId: string, threadFolder: string, treeOf: (commit: string) => string): ThreadSummary {
  const path = join(threadFolder, "outcome.json");
  if (!existsSync(path)) throw new SetupError(`Thread ${threadId} finished without its outcome.json (${path}).`);
  const document = readDocument(path, OutcomeSchema);
  const merge = document.merge;
  return {
    outcome: document.outcome,
    fixed: document.clusters.filter((end) => end.disposition === "fixed").map((end) => end.clusterId),
    merged: (merge?.fixes ?? []).filter((fix) => fix.status === "merged").map((fix) => fix.clusterId),
    sourceChanged: merge?.before != null && merge.after != null && merge.before !== merge.after && treeOf(merge.before) !== treeOf(merge.after),
    admitted: [...(document.discovery?.admitted ?? [])],
  };
}
