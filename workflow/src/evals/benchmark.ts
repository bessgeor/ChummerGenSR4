import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { mechanisms } from "../diagnosis/job-schemas.js";
import { snapshotFolders, type Git } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";
import type { RootCause } from "./root-cause.js";

const HunkSchema = z.strictObject({
  oldStart: z.number().int().nonnegative(), oldLines: z.number().int().nonnegative(),
  /** The text git prints after the hunk's ranges: usually the enclosing type or member. */
  header: z.string(),
  removed: z.array(z.string()), added: z.array(z.string()),
});
const PatchFileSchema = z.strictObject({ path: z.string().min(1), hunks: z.array(HunkSchema) });
export type PatchFile = z.infer<typeof PatchFileSchema>;

/** An accepted fix of a discrepancy cluster, replayable from git: the source before it, the fix and what it showed. */
export const BenchmarkItemSchema = z.strictObject({
  schemaVersion: z.literal(1),
  itemId: z.string().min(1),
  /** `revert` when the fix mostly undoes the change that caused the discrepancy. */
  kind: z.enum(["fix", "revert"]),
  discrepancy: z.strictObject({
    clusterId: z.string().min(1), imageHash: z.string(), cases: z.array(z.string()), captures: z.array(z.string()),
    members: z.array(z.strictObject({ case: z.string(), capture: z.string() })).min(1),
  }),
  base: z.strictObject({ commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  fix: z.strictObject({
    commit: z.string().regex(/^[0-9a-f]{40}$/), committedUtc: z.string(), mechanism: z.enum(mechanisms),
    patch: z.string().min(1), files: z.array(PatchFileSchema).min(1),
  }),
  regression: z.strictObject({ commit: z.string().regex(/^[0-9a-f]{40}$/) }).nullable(),
  provenance: z.strictObject({ threadId: z.string().min(1) }),
});
export type BenchmarkItem = z.infer<typeof BenchmarkItemSchema>;

/** At least this share of a fix's changed lines undoing the regression's makes it a revert. */
export const revertShare = 0.9;

/** Parses a unified diff of `git diff` into files and hunks; a file whose diff has no hunks (binary) has none. */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: { path: string; hunks: z.infer<typeof HunkSchema>[] } | null = null;
  let hunk: z.infer<typeof HunkSchema> | null = null;
  let oldPath = "";
  for (const raw of patch.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      file = { path: /^diff --git a\/.+ b\/(.+)$/.exec(line)?.[1] ?? "", hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (file === null) continue;
    if (hunk === null && line.startsWith("--- ")) {
      oldPath = line.slice(4);
      continue;
    }
    if (hunk === null && line.startsWith("+++ ")) {
      const newPath = line.slice(4);
      file.path = newPath === "/dev/null" ? oldPath.replace(/^a\//, "") : newPath.replace(/^b\//, "");
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (header !== null) {
      hunk = { oldStart: Number(header[1]), oldLines: header[2] === undefined ? 1 : Number(header[2]), header: header[3]!.trim(), removed: [], added: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (hunk === null) continue;
    if (line.startsWith("-")) hunk.removed.push(line.slice(1));
    else if (line.startsWith("+")) hunk.added.push(line.slice(1));
  }
  return files.map((item) => PatchFileSchema.parse(item));
}

/** The root cause an item's fix shows: the old-side ranges of its hunks, their headers as symbols and the changed lines. */
export function rootCauseOfItem(item: BenchmarkItem): RootCause {
  return {
    source: `benchmark:${item.itemId}`,
    mechanism: item.fix.mechanism,
    files: item.fix.files.map((file) => ({
      path: file.path,
      ranges: file.hunks.map((hunk) => ({ start: hunk.oldStart, end: hunk.oldStart + Math.max(hunk.oldLines, 1) - 1 })),
      symbols: file.hunks.map((hunk) => hunk.header).filter((header) => header.length > 0),
      changedLines: file.hunks.flatMap((hunk) => [...hunk.removed, ...hunk.added]).map((line) => line.trim()).filter((line) => line.length > 0),
    })),
  };
}

function counts(lines: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines.map((item) => item.trim()).filter((item) => item.length > 0)) map.set(line, (map.get(line) ?? 0) + 1);
  return map;
}

function overlap(left: Map<string, number>, right: Map<string, number>): number {
  let total = 0;
  for (const [line, count] of left) total += Math.min(count, right.get(line) ?? 0);
  return total;
}

/** Whether at least 90% of the fix's changed lines are the regression's changed lines with the other sign, in files it touched. */
export function isRevert(fix: readonly PatchFile[], regression: readonly PatchFile[]): boolean {
  let matched = 0;
  let total = 0;
  for (const file of fix) {
    const added = file.hunks.flatMap((hunk) => hunk.added);
    const removed = file.hunks.flatMap((hunk) => hunk.removed);
    const fixAdded = counts(added);
    const fixRemoved = counts(removed);
    total += [...fixAdded.values(), ...fixRemoved.values()].reduce((sum, count) => sum + count, 0);
    const other = regression.find((item) => item.path === file.path);
    if (other === undefined) continue;
    matched += overlap(fixAdded, counts(other.hunks.flatMap((hunk) => hunk.removed)));
    matched += overlap(fixRemoved, counts(other.hunks.flatMap((hunk) => hunk.added)));
  }
  return total > 0 && matched / total >= revertShare;
}

function commitOf(git: Git, reference: string): string {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${reference}^{commit}`]).trim();
  } catch {
    throw new SetupError(`git does not know the commit '${reference}'.`);
  }
}

/** The diff of a commit against its parent, limited to the app's source, data and translations. */
export function commitPatch(git: Git, base: string, commit: string): string {
  return git(["diff", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--indent-heuristic", "-U3", base, commit, "--", ...snapshotFolders]);
}

function parentOf(git: Git, commit: string): string {
  const parents = git(["rev-list", "--parents", "-n", "1", commit]).trim().split(/\s+/).slice(1);
  if (parents.length !== 1) throw new SetupError(`Commit ${commit} has ${parents.length} parents; a fix must be a commit with exactly one parent.`);
  return parents[0]!;
}

export type AddItemInput = {
  readonly clusterId: string;
  readonly fix: string;
  readonly mechanism: string;
  readonly regression: string | null;
  /** The thread whose triage names the cluster; null for the newest thread that has it. */
  readonly threadId: string | null;
  readonly threadsFolder: string;
  readonly benchmarkFolder: string;
};

function triageWithCluster(threadsFolder: string, clusterId: string, threadId: string | null) {
  const threads = threadId !== null ? [threadId]
    : existsSync(threadsFolder) ? readdirSync(threadsFolder).sort().reverse() : [];
  for (const thread of threads) {
    const path = join(threadsFolder, thread, "triage.json");
    if (!existsSync(path)) continue;
    const triage = readDocument(path, TriageDocumentSchema);
    const cluster = triage.clusters.find((item) => item.id === clusterId);
    if (cluster !== undefined) return { thread, cluster };
  }
  throw new SetupError(threadId === null ? `No thread's triage.json has the cluster ${clusterId}.` : `The triage of thread ${threadId} has no cluster ${clusterId}.`);
}

/** Builds a benchmark item from git and a thread's triage, writes it and returns it; nothing is written on a setup error. */
export function addBenchmarkItem(git: Git, input: AddItemInput): BenchmarkItem {
  const mechanism = mechanisms.find((item) => item === input.mechanism);
  if (mechanism === undefined) throw new SetupError(`--mechanism must be one of ${mechanisms.join(", ")}, got '${input.mechanism}'.`);
  const { thread, cluster } = triageWithCluster(input.threadsFolder, input.clusterId, input.threadId);
  const fix = commitOf(git, input.fix);
  const base = parentOf(git, fix);
  const patch = commitPatch(git, base, fix);
  const files = parsePatch(patch);
  if (files.length === 0) throw new SetupError(`Commit ${fix} changes nothing under ${snapshotFolders.join(", ")}.`);
  let regression: string | null = null;
  let kind: BenchmarkItem["kind"] = "fix";
  if (input.regression !== null) {
    regression = commitOf(git, input.regression);
    if (isRevert(files, parsePatch(commitPatch(git, parentOf(git, regression), regression)))) kind = "revert";
  }
  const item = BenchmarkItemSchema.parse({
    schemaVersion: 1, itemId: `${cluster.id}-${fix.slice(0, 12)}`, kind,
    discrepancy: {
      clusterId: cluster.id, imageHash: cluster.imageHash, cases: cluster.cases, captures: cluster.captures,
      members: cluster.members.map((member) => ({ case: member.case, capture: member.capture })),
    },
    base: { commit: base },
    fix: { commit: fix, committedUtc: new Date(git(["show", "-s", "--format=%cI", fix]).trim()).toISOString(), mechanism, patch, files },
    regression: regression === null ? null : { commit: regression },
    provenance: { threadId: thread },
  });
  const path = join(input.benchmarkFolder, `${item.itemId}.json`);
  if (existsSync(path)) throw new SetupError(`The benchmark item ${path} exists already.`);
  mkdirSync(input.benchmarkFolder, { recursive: true });
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`);
  return item;
}

/** Every benchmark item in the folder, ordered by item ID. */
export function readBenchmark(folder: string): BenchmarkItem[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith(".json")).sort()
    .map((name) => readDocument(join(folder, name), BenchmarkItemSchema));
}

/** The problems that keep an item from replaying: a missing commit, or a stored patch git no longer gives. */
export function checkBenchmarkItem(git: Git, item: BenchmarkItem): string[] {
  const problems: string[] = [];
  for (const [name, commit] of [["base", item.base.commit], ["fix", item.fix.commit], ["regression", item.regression?.commit ?? null]] as const) {
    if (commit === null) continue;
    try {
      commitOf(git, commit);
    } catch {
      problems.push(`${item.itemId}: the ${name} commit ${commit} is missing.`);
    }
  }
  if (problems.length === 0 && commitPatch(git, item.base.commit, item.fix.commit) !== item.fix.patch) {
    problems.push(`${item.itemId}: git diff ${item.base.commit.slice(0, 12)} ${item.fix.commit.slice(0, 12)} differs from the stored patch.`);
  }
  return problems;
}
