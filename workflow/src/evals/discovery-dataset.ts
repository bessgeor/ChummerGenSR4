import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../diagnosis/context.js";
import { DiscoveryContextSchema, discoveryContextHash, verifyContextFiles, type RankContext, type ScenarioContext } from "../discovery/discovery-context.js";
import { RankOutputSchema, ScenarioOutputSchema } from "../discovery/job-schemas.js";
import { selectedTabNames } from "../discovery/plan-validator.js";
import { SetupError } from "../host/setup-error.js";
import { fingerprintFolder, sha256Text } from "../steps/fingerprint.js";
import { readDocument } from "../steps/read-document.js";
import { datasetFolders, partitionOf, partitions } from "./dataset.js";
import type { EvalRecord } from "./eval-record.js";
import { renameWithRetry } from "../host/rename-with-retry.js";

/** A proven scenario's plan as gold: its fixture case and the tab names it selected. */
const ScenarioGoldSchema = z.strictObject({ kind: z.literal("scenario"), case: z.string().min(1), selectedTabs: z.array(z.string().min(1)) });
/** What a rank's thread found out: the targets it proved, and the ones it ran without proof. */
const RankGoldSchema = z.strictObject({ kind: z.literal("rank"), proven: z.array(z.string().min(1)), notProven: z.array(z.string().min(1)) });

const ItemSchema = z.strictObject({
  itemId: z.string().min(1),
  /** The partition key: a scenario's target, a rank's context hash. */
  key: z.string().min(1),
  contextHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceIdentity: z.string().regex(/^[0-9a-f]{64}$/),
  records: z.array(z.string()).min(1),
  gold: z.union([ScenarioGoldSchema, RankGoldSchema]).nullable(),
  partition: z.enum(partitions),
});
export type DiscoveryDatasetItem = z.infer<typeof ItemSchema>;

export const DiscoveryDatasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.number().int().positive(),
  previousHash: z.string().nullable(),
  reason: z.string().nullable(),
  jobKind: z.enum(["rank", "scenario"]),
  seed: z.string().min(1),
  testPercent: z.number().int().min(0).max(100),
  frozenUtc: z.string(),
  items: z.array(ItemSchema).min(1),
  datasetHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type DiscoveryDataset = z.infer<typeof DiscoveryDatasetSchema>;

export type DiscoveryFreezeInput = {
  readonly name: string;
  readonly jobKind: "rank" | "scenario";
  readonly seed: string;
  readonly testPercent: number;
  readonly reason: string | null;
  readonly datasetsFolder: string;
  /** A discovery thread's folder. */
  readonly threadFolder: (threadId: string) => string;
  readonly records: readonly EvalRecord[];
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SetupError(`The discovery context ${path} cannot be read: ${(error as Error).message}`);
  }
}

/**
 * The contexts of a discovery thread by hash: its rank folder and its scenario folders, read once per thread. A context sealed in
 * another format than the current one cannot be staged for the current prompts, so it is not listed and its records are left out; one that is not JSON at all is a setup error.
 */
function threadContexts(threadFolder: string): Map<string, { readonly folder: string; readonly kind: "rank" | "scenario" }> {
  const folders = existsSync(threadFolder) ? readdirSync(threadFolder).filter((name) => name === "rank" || /^scenario-\d+$/.test(name)).map((name) => join(threadFolder, name)) : [];
  const contexts = new Map<string, { folder: string; kind: "rank" | "scenario" }>();
  for (const folder of folders.filter((entry) => existsSync(join(entry, "context.json")))) {
    const parsed = DiscoveryContextSchema.safeParse(readJson(join(folder, "context.json")));
    if (parsed.success) contexts.set(discoveryContextHash(parsed.data), { folder, kind: parsed.data.kind });
  }
  return contexts;
}

/**
 * A scenario record's gold is its proven plan; a rank record's is what its thread's scenarios showed: the targets proven, and those
 * that executed without proof. A scenario that did not execute says nothing about its target.
 */
function goldOf(record: EvalRecord, scenariosByThread: ReadonlyMap<string, readonly EvalRecord[]>): DiscoveryDatasetItem["gold"] {
  if (record.jobKind === "scenario") {
    if (record.labels.discovery?.outcome !== "proven") return null;
    const plan = ScenarioOutputSchema.parse(record.output).plan!;
    return { kind: "scenario", case: plan.case, selectedTabs: selectedTabNames(plan.actions) };
  }
  RankOutputSchema.parse(record.output);
  const scenarios = scenariosByThread.get(record.threadId) ?? [];
  const targets = (outcome: string) => [...new Set(scenarios.filter((item) => item.labels.discovery!.outcome === outcome).map((item) => item.subject.id))].sort();
  return { kind: "rank", proven: targets("proven"), notProven: targets("not-proven") };
}

/**
 * One item's gold from its records: the earliest proven plan of a scenario item; for a rank item shared by several threads, every
 * target any of them proved, and the ones they ran without proof that none proved.
 */
export function mergeGold(golds: readonly DiscoveryDatasetItem["gold"][]): DiscoveryDatasetItem["gold"] {
  const ranks = golds.filter((gold): gold is Extract<NonNullable<DiscoveryDatasetItem["gold"]>, { kind: "rank" }> => gold?.kind === "rank");
  if (ranks.length === 0) return golds.find((gold) => gold !== null) ?? null;
  const proven = [...new Set(ranks.flatMap((gold) => gold.proven))].sort();
  return { kind: "rank", proven, notProven: [...new Set(ranks.flatMap((gold) => gold.notProven))].filter((target) => !proven.includes(target)).sort() };
}

export function discoveryDatasetHash(dataset: Omit<DiscoveryDataset, "datasetHash">): string {
  return sha256Text(canonicalJson(dataset));
}

/** Verifies a copied context against its hash (and its labels file) and a copied snapshot against its identity. */
async function verifyCopies(folder: string, jobKind: "rank" | "scenario", item: Pick<DiscoveryDatasetItem, "itemId" | "contextHash" | "sourceIdentity">): Promise<RankContext | ScenarioContext> {
  const copies = datasetFolders(folder);
  const contextFolder = copies.context(item.contextHash);
  if (!existsSync(join(contextFolder, "context.json"))) throw new SetupError(`Dataset item ${item.itemId}: its context copy ${contextFolder} is missing.`);
  const context = readDocument(join(contextFolder, "context.json"), DiscoveryContextSchema);
  if (context.kind !== jobKind || discoveryContextHash(context) !== item.contextHash) throw new SetupError(`Dataset item ${item.itemId}: its context copy ${contextFolder} differs from its hash.`);
  verifyContextFiles(contextFolder, context);
  const source = copies.source(item.sourceIdentity);
  if (!existsSync(source) || await fingerprintFolder(source, true) !== item.sourceIdentity) {
    throw new SetupError(`Dataset item ${item.itemId}: its snapshot copy ${source} differs from its identity.`);
  }
  return context;
}

/** Reads a rank or scenario dataset and verifies its hash and every copy. */
export async function loadDiscoveryDataset(folder: string): Promise<{ dataset: DiscoveryDataset; contexts: ReadonlyMap<string, RankContext | ScenarioContext> }> {
  const dataset = readDocument(join(folder, "dataset.json"), DiscoveryDatasetSchema);
  const { datasetHash: stored, ...rest } = dataset;
  if (discoveryDatasetHash(rest) !== stored) throw new SetupError(`The dataset ${folder} differs from its hash.`);
  const contexts = new Map<string, RankContext | ScenarioContext>();
  for (const item of dataset.items) contexts.set(item.itemId, await verifyCopies(folder, dataset.jobKind, item));
  return { dataset, contexts };
}

/** Freezes the next version of a rank or scenario dataset from the labelled workflow records whose context is still in their thread. */
export async function freezeDiscoveryDataset(input: DiscoveryFreezeInput): Promise<{ folder: string; dataset: DiscoveryDataset }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.name)) throw new SetupError(`A dataset name is lower-case letters, digits and dashes, got '${input.name}'.`);
  type Draft = { key: string; contextHash: string; sourceIdentity: string; records: EvalRecord[]; contextFolder: string; sourceFolder: string };
  const drafts = new Map<string, Draft>();
  const chosen = input.records.filter((record) => record.origin === "workflow" && record.jobKind === input.jobKind && record.result.status === "succeeded" && record.labels.discovery !== null);
  const contextsByThread = new Map<string, ReturnType<typeof threadContexts>>();
  for (const record of chosen) {
    const threadFolder = input.threadFolder(record.threadId);
    if (!contextsByThread.has(record.threadId)) contextsByThread.set(record.threadId, threadContexts(threadFolder));
    const found = contextsByThread.get(record.threadId)!.get(record.contextHash);
    const contextFolder = found === undefined || found.kind !== record.jobKind ? null : found.folder;
    if (contextFolder === null || !existsSync(join(threadFolder, "source"))) {
      input.log(`Freeze: record ${record.recordId} is left out: its context (in the current format) or its thread's snapshot no longer exists.`);
      continue;
    }
    const context = readDocument(join(contextFolder, "context.json"), DiscoveryContextSchema);
    const itemId = sha256Text(record.contextHash).slice(0, 16);
    const draft = drafts.get(itemId) ?? {
      key: record.jobKind === "scenario" ? record.subject.id : record.contextHash, contextHash: record.contextHash, sourceIdentity: context.source.identity,
      records: [], contextFolder, sourceFolder: join(threadFolder, "source"),
    };
    draft.records.push(record);
    drafts.set(itemId, draft);
  }
  if (drafts.size === 0) throw new SetupError(`No succeeded, labelled workflow ${input.jobKind} record has its context in its thread folder; there is nothing to freeze.`);
  const nameFolder = join(input.datasetsFolder, input.name);
  const versions = existsSync(nameFolder) ? readdirSync(nameFolder).map((entry) => /^v(\d+)$/.exec(entry)).flatMap((match) => (match === null ? [] : [Number(match[1])])) : [];
  const previous = versions.length === 0 ? 0 : Math.max(...versions);
  const before = previous === 0 ? null : readDocument(join(nameFolder, `v${previous}`, "dataset.json"), z.looseObject({ seed: z.string(), testPercent: z.number(), datasetHash: z.string(), jobKind: z.string() }));
  if (before !== null && (before.seed !== input.seed || before.testPercent !== input.testPercent || before.jobKind !== input.jobKind)) {
    throw new SetupError(`Dataset ${input.name} v${previous} was frozen for ${before.jobKind} with seed '${before.seed}' and ${before.testPercent}% test; `
      + `v${previous + 1} must keep them. Freeze under a new --name.`);
  }
  const partial = join(nameFolder, `v${previous + 1}.partial`);
  rmSync(partial, { recursive: true, force: true });
  const copies = datasetFolders(partial);
  const scenariosByThread = new Map<string, EvalRecord[]>();
  for (const record of input.records.filter((item) => item.origin === "workflow" && item.jobKind === "scenario" && item.labels.discovery !== null)) {
    scenariosByThread.set(record.threadId, [...(scenariosByThread.get(record.threadId) ?? []), record]);
  }
  const items: DiscoveryDatasetItem[] = [];
  for (const [itemId, draft] of [...drafts].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (!existsSync(copies.context(draft.contextHash))) cpSync(draft.contextFolder, copies.context(draft.contextHash), { recursive: true });
    if (!existsSync(copies.source(draft.sourceIdentity))) cpSync(draft.sourceFolder, copies.source(draft.sourceIdentity), { recursive: true });
    const sorted = [...draft.records].sort((left, right) => (left.recordId < right.recordId ? -1 : 1));
    const gold = mergeGold(sorted.map((record) => goldOf(record, scenariosByThread)));
    items.push({ itemId, key: draft.key, contextHash: draft.contextHash, sourceIdentity: draft.sourceIdentity, records: sorted.map((record) => record.recordId), gold, partition: partitionOf(input.seed, draft.key, input.testPercent) });
  }
  for (const item of items) await verifyCopies(partial, input.jobKind, item);
  const content: Omit<DiscoveryDataset, "datasetHash"> = {
    schemaVersion: 1, name: input.name, version: previous + 1, previousHash: before?.datasetHash ?? null, reason: input.reason, jobKind: input.jobKind,
    seed: input.seed, testPercent: input.testPercent, frozenUtc: input.now().toISOString(), items,
  };
  const dataset = DiscoveryDatasetSchema.parse({ ...content, datasetHash: discoveryDatasetHash(content) });
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, "dataset.json"), `${JSON.stringify(dataset, null, 2)}\n`);
  const folder = join(nameFolder, `v${previous + 1}`);
  renameWithRetry(partial, folder);
  return { folder, dataset };
}
