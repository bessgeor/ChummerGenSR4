import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ContextManifestSchema, canonicalJson, contextHash, type ContextManifest } from "../diagnosis/context.js";
import { ExplanationSchema, mechanisms, type Explanation } from "../diagnosis/job-schemas.js";
import { SetupError } from "../host/setup-error.js";
import { fingerprintFolder, sha256File, sha256Text } from "../steps/fingerprint.js";
import { readDocument } from "../steps/read-document.js";
import { rootCauseOfItem, type BenchmarkItem } from "./benchmark.js";
import type { EvalRecord } from "./eval-record.js";
import { isGradable, itemFor } from "./hindsight.js";
import { threadObservations, type ObservationRow } from "./observations.js";
import { challengedHypothesis, contextExists, missingHypothesisMessage, recordContext } from "./record-context.js";
import { rootCauseOfExplanation, type RootCause } from "./root-cause.js";

const RootCauseSchema = z.strictObject({
  source: z.string().min(1), mechanism: z.enum(mechanisms),
  files: z.array(z.strictObject({
    path: z.string().min(1), ranges: z.array(z.strictObject({ start: z.number().int(), end: z.number().int() })),
    symbols: z.array(z.string()), changedLines: z.array(z.string()),
  })),
});

export const partitions = ["development", "test"] as const;
export type Partition = (typeof partitions)[number];

const DatasetItemSchema = z.strictObject({
  itemId: z.string().min(1),
  clusterId: z.string().min(1),
  contextHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceIdentity: z.string().regex(/^[0-9a-f]{64}$/),
  /** For a challenge item: the hypothesis to challenge. */
  hypothesis: ExplanationSchema.nullable(),
  /** The workflow records the item was taken from. */
  records: z.array(z.string()).min(1),
  observations: z.array(z.strictObject({ case: z.string(), capture: z.string(), observation: z.enum(["differs", "matches", "not-observed"]) })),
  gold: RootCauseSchema.nullable(),
  partition: z.enum(partitions),
});
export type DatasetItem = z.infer<typeof DatasetItemSchema>;

export const DatasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.number().int().positive(),
  previousHash: z.string().nullable(),
  reason: z.string().nullable(),
  jobKind: z.enum(["hypothesis", "challenge"]),
  seed: z.string().min(1),
  testPercent: z.number().int().min(0).max(100),
  frozenUtc: z.string(),
  items: z.array(DatasetItemSchema).min(1),
  /** SHA-256 of the canonical JSON of every other field. */
  datasetHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Dataset = z.infer<typeof DatasetSchema>;

/** Where a dataset version keeps its copies of the contexts and snapshots. */
export function datasetFolders(folder: string) {
  return { context: (hash: string) => join(folder, "contexts", hash), source: (identity: string) => join(folder, "sources", identity) };
}

/** `test` or `development` from the seed and the cluster alone, so one discrepancy never lies in both. */
export function partitionOf(seed: string, clusterId: string, testPercent: number): Partition {
  return Number.parseInt(sha256Text(`${seed}:${clusterId}`).slice(0, 8), 16) % 100 < testPercent ? "test" : "development";
}

export function datasetHash(dataset: Omit<Dataset, "datasetHash">): string {
  return sha256Text(canonicalJson(dataset));
}

/** Verifies a copied context against its hash and crops, and a copied snapshot against its identity. */
async function verifyCopies(folder: string, item: Pick<DatasetItem, "itemId" | "contextHash" | "sourceIdentity">): Promise<ContextManifest> {
  const folders = datasetFolders(folder);
  const contextFolder = folders.context(item.contextHash);
  const path = join(contextFolder, "context.json");
  if (!existsSync(path)) throw new SetupError(`Dataset item ${item.itemId}: its context copy ${contextFolder} is missing.`);
  const manifest = readDocument(path, ContextManifestSchema);
  if (contextHash(manifest) !== item.contextHash) throw new SetupError(`Dataset item ${item.itemId}: its context copy ${contextFolder} differs from its hash.`);
  for (const member of manifest.members) {
    for (const [crop, hash] of [[member.canonicalCrop, member.canonicalCropSha256], [member.candidateCrop, member.candidateCropSha256]] as const) {
      if (!existsSync(join(contextFolder, crop)) || await sha256File(join(contextFolder, crop)) !== hash) {
        throw new SetupError(`Dataset item ${item.itemId}: the crop ${crop} of its context copy differs from the manifest.`);
      }
    }
  }
  const source = folders.source(item.sourceIdentity);
  if (!existsSync(source) || await fingerprintFolder(source, true) !== item.sourceIdentity) {
    throw new SetupError(`Dataset item ${item.itemId}: its snapshot copy ${source} differs from its identity.`);
  }
  return manifest;
}

/** Reads a dataset version and verifies its hash and every copy; any difference is a setup error naming it. */
export async function loadDataset(folder: string): Promise<{ dataset: Dataset; manifests: ReadonlyMap<string, ContextManifest> }> {
  const dataset = readDocument(join(folder, "dataset.json"), DatasetSchema);
  const { datasetHash: stored, ...rest } = dataset;
  if (datasetHash(rest) !== stored) throw new SetupError(`The dataset ${folder} differs from its hash.`);
  const manifests = new Map<string, ContextManifest>();
  for (const item of dataset.items) manifests.set(item.itemId, await verifyCopies(folder, item));
  return { dataset, manifests };
}

export type FreezeInput = {
  readonly name: string;
  readonly jobKind: "hypothesis" | "challenge";
  readonly seed: string;
  readonly testPercent: number;
  readonly reason: string | null;
  readonly datasetsFolder: string;
  readonly threadFolder: (threadId: string) => string;
  readonly records: readonly EvalRecord[];
  readonly benchmark: readonly BenchmarkItem[];
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** The root cause a correct review verdict on a record confirms, or null. */
function reviewedRootCause(record: EvalRecord, records: readonly EvalRecord[]): RootCause | null {
  if (record.labels.review?.verdict !== "correct") return null;
  const source = `review:${record.recordId}`;
  const output = record.output as { explanation?: Explanation | null; alternative?: Explanation | null; outcome: string };
  if (record.jobKind === "hypothesis") return output.explanation == null ? null : rootCauseOfExplanation(source, output.explanation);
  if (output.alternative != null) return rootCauseOfExplanation(source, output.alternative);
  // A challenge rightly without alternative confirms the hypothesis it challenged.
  const hypothesis = challengedHypothesis(records, record);
  return hypothesis === null ? null : rootCauseOfExplanation(source, hypothesis.explanation);
}

type Draft = { clusterId: string; contextHash: string; sourceIdentity: string; hypothesis: Explanation | null; records: EvalRecord[]; contextFolder: string; sourceFolder: string };

/** Freezes the next version of a dataset from the job kind's workflow records; an existing version is never changed. */
export async function freezeDataset(input: FreezeInput): Promise<{ folder: string; dataset: Dataset }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.name)) throw new SetupError(`A dataset name is lower-case letters, digits and dashes, got '${input.name}'.`);
  const drafts = new Map<string, Draft>();
  for (const record of input.records.filter((item) => isGradable(item) && item.jobKind === input.jobKind)) {
    if (!contextExists(input.threadFolder, record)) {
      input.log(`Freeze: record ${record.recordId} is left out: its context or its thread's snapshot no longer exists.`);
      continue;
    }
    const found = recordContext(input.threadFolder, record);
    const hypothesis = record.jobKind === "challenge" ? challengedHypothesis(input.records, record)?.explanation ?? null : null;
    if (record.jobKind === "challenge" && hypothesis === null) {
      input.log(`Freeze: ${missingHypothesisMessage(record)} It is left out.`);
      continue;
    }
    const itemId = sha256Text(`${record.contextHash}:${hypothesis === null ? "" : canonicalJson(hypothesis)}`).slice(0, 16);
    const draft = drafts.get(itemId) ?? {
      clusterId: record.subject.id, contextHash: record.contextHash, sourceIdentity: found.manifest.source.identity, hypothesis, records: [],
      contextFolder: found.contextFolder, sourceFolder: found.sourceFolder,
    };
    draft.records.push(record);
    drafts.set(itemId, draft);
  }
  if (drafts.size === 0) throw new SetupError(`No succeeded workflow ${input.jobKind} record has its context in its thread folder; there is nothing to freeze.`);

  const nameFolder = join(input.datasetsFolder, input.name);
  const versions = existsSync(nameFolder) ? readdirSync(nameFolder).map((entry) => /^v(\d+)$/.exec(entry)).flatMap((match) => (match === null ? [] : [Number(match[1])])) : [];
  const previous = versions.length === 0 ? 0 : Math.max(...versions);
  const before = previous === 0 ? null : readDocument(join(nameFolder, `v${previous}`, "dataset.json"), DatasetSchema);
  // A cluster keeps its partition across versions only while the seed and the share stay: a prompt tuned on the development partition of
  // one version must never meet its clusters in the test partition of the next.
  if (before !== null && (before.seed !== input.seed || before.testPercent !== input.testPercent)) {
    throw new SetupError(`Dataset ${input.name} v${previous} was frozen with seed '${before.seed}' and ${before.testPercent}% test; `
      + `v${previous + 1} with seed '${input.seed}' and ${input.testPercent}% test would move clusters between partitions. Keep them, or freeze under a new --name.`);
  }
  const previousHash = before === null ? null : before.datasetHash;
  const version = previous + 1;
  const partial = join(nameFolder, `v${version}.partial`);
  rmSync(partial, { recursive: true, force: true });
  const copies = datasetFolders(partial);

  const observationsByThread = new Map<string, ObservationRow[]>();
  const items: DatasetItem[] = [];
  for (const [itemId, draft] of [...drafts].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const threads = [...new Set(draft.records.map((record) => record.threadId))].sort();
    const rows = threads.flatMap((thread) => {
      let found = observationsByThread.get(thread);
      if (found === undefined) {
        found = threadObservations(input.threadFolder(thread));
        observationsByThread.set(thread, found);
      }
      return found;
    });
    const sameContext = input.records.filter((record) => isGradable(record) && record.contextHash === draft.contextHash).sort((left, right) => (left.recordId < right.recordId ? -1 : 1));
    const fixes = draft.records.flatMap((record) => itemFor(record, input.benchmark) ?? [])
      .sort((left, right) => Date.parse(left.fix.committedUtc) - Date.parse(right.fix.committedUtc) || (left.itemId < right.itemId ? -1 : 1));
    const gold = fixes[0] !== undefined ? rootCauseOfItem(fixes[0]) : sameContext.map((record) => reviewedRootCause(record, input.records)).find((cause) => cause !== null) ?? null;
    if (!existsSync(copies.context(draft.contextHash))) cpSync(draft.contextFolder, copies.context(draft.contextHash), { recursive: true });
    if (!existsSync(copies.source(draft.sourceIdentity))) cpSync(draft.sourceFolder, copies.source(draft.sourceIdentity), { recursive: true });
    items.push({
      itemId, clusterId: draft.clusterId, contextHash: draft.contextHash, sourceIdentity: draft.sourceIdentity, hypothesis: draft.hypothesis,
      records: draft.records.map((record) => record.recordId).sort(), observations: mergeObservations(rows), gold: gold === null ? null : RootCauseSchema.parse(gold),
      partition: partitionOf(input.seed, draft.clusterId, input.testPercent),
    });
  }
  for (const item of items) await verifyCopies(partial, item);
  const content: Omit<Dataset, "datasetHash"> = {
    schemaVersion: 1, name: input.name, version, previousHash, reason: input.reason, jobKind: input.jobKind, seed: input.seed,
    testPercent: input.testPercent, frozenUtc: input.now().toISOString(), items,
  };
  const dataset = DatasetSchema.parse({ ...content, datasetHash: datasetHash(content) });
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, "dataset.json"), `${JSON.stringify(dataset, null, 2)}\n`);
  const folder = join(nameFolder, `v${version}`);
  renameSync(partial, folder);
  return { folder, dataset };
}

/** One observation per case and capture: the observed value when every run that observed it agrees, else `not-observed`. */
export function mergeObservations(rows: readonly ObservationRow[]): DatasetItem["observations"] {
  const byKey = new Map<string, { case: string; capture: string; seen: Set<string> }>();
  for (const row of rows) {
    const key = `${row.case}\u0000${row.capture}`;
    const entry = byKey.get(key) ?? { case: row.case, capture: row.capture, seen: new Set<string>() };
    if (row.observation !== "not-observed") entry.seen.add(row.observation);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .sort((left, right) => (left.case < right.case ? -1 : left.case > right.case ? 1 : left.capture < right.capture ? -1 : left.capture > right.capture ? 1 : 0))
    .map((entry) => ({ case: entry.case, capture: entry.capture, observation: entry.seen.size === 1 ? ([...entry.seen][0] as "differs" | "matches") : "not-observed" }));
}
