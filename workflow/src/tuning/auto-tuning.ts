import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readRecord, recordNamespace } from "../evals/eval-record.js";
import { isGradable } from "../evals/hindsight.js";
import { SetupError } from "../host/setup-error.js";
import type { Profile } from "../options/profile.js";
import { readDocument } from "../steps/read-document.js";
import { writeDocument } from "../steps/write-document.js";

/** The profile's `autoTuning` with its defaults. */
export type AutoTuningSettings = { readonly every: number; readonly dataset: string; readonly minPass: number; readonly candidates: number };

export const autoTuningDefaults: AutoTuningSettings = { every: 12, dataset: "auto-hypothesis", minPass: 0.5, candidates: 1 };

export function resolveAutoTuning(profile: Profile["autoTuning"]): AutoTuningSettings {
  return {
    every: profile?.every ?? autoTuningDefaults.every, dataset: profile?.dataset ?? autoTuningDefaults.dataset,
    minPass: profile?.minPass ?? autoTuningDefaults.minPass, candidates: profile?.candidates ?? autoTuningDefaults.candidates,
  };
}

const AutoTuningEntrySchema = z.strictObject({
  tuningId: z.string().regex(/^tune-/),
  startedUtc: z.string(),
  /** Started by `--force`, whatever the count. */
  forced: z.boolean(),
  /** The records it counted when it started. */
  records: z.array(z.string().min(1)),
  /** The folder of the dataset version it froze. */
  dataset: z.string().min(1).nullable(),
  cycle: z.string().min(1).nullable(),
  /** The branch its cycle worked on, the commit of its files there, and the merge commit on the branch it started from. */
  branch: z.string().min(1).nullable(),
  commit: z.string().min(1).nullable(),
  merge: z.string().min(1).nullable(),
  outcome: z.enum(["activated", "no_improvement", "rejected", "failed"]).nullable(),
  finishedUtc: z.string().nullable(),
});
export type AutoTuningEntry = z.infer<typeof AutoTuningEntrySchema>;

/** `out/evals/tuning/auto.json`: the records automatic tunings counted, the finished tunings and the one in progress. */
export const AutoTuningStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  counted: z.array(z.string().min(1)),
  tunings: z.array(AutoTuningEntrySchema),
  current: AutoTuningEntrySchema.nullable(),
});
export type AutoTuningState = z.infer<typeof AutoTuningStateSchema>;

export function autoTuningPath(evalsFolder: string): string {
  return join(evalsFolder, "tuning", "auto.json");
}

/** The state; before the first automatic tuning, nothing counted and nothing in progress. */
export function readAutoTuning(evalsFolder: string): AutoTuningState {
  const path = autoTuningPath(evalsFolder);
  if (!existsSync(path)) return { schemaVersion: 1, counted: [], tunings: [], current: null };
  return readDocument(path, AutoTuningStateSchema);
}

export function newTuningId(now: Date): string {
  return `tune-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}-${randomBytes(4).toString("hex")}`;
}

/**
 * The IDs of the succeeded workflow hypothesis records that no automatic tuning counted, in order. The records come from
 * one search: reading them in pages by offset would repeat or miss a record that a running workflow stores between two pages.
 */
export async function newHypothesisRecords(store: BaseStore, counted: ReadonlySet<string>): Promise<string[]> {
  const items = await store.search(recordNamespace("hypothesis"), { limit: Number.MAX_SAFE_INTEGER });
  const found = new Set<string>();
  for (const item of items) {
    const record = readRecord(item.value);
    if (isGradable(record) && !counted.has(record.recordId)) found.add(record.recordId);
  }
  return [...found].sort();
}
export type AutoTuningDependencies = {
  readonly store: BaseStore;
  readonly evalsFolder: string;
  readonly now: () => Date;
  readonly newTuningId: (now: Date) => string;
};

/** What the trigger finds, without changing anything. */
export type AutoTuningTrigger =
  | { readonly kind: "not_due"; readonly count: number; readonly every: number }
  | { readonly kind: "due"; readonly records: readonly string[]; readonly every: number; readonly forced: boolean }
  | { readonly kind: "in_progress"; readonly tuning: AutoTuningEntry };

/**
 * Counts the new hypothesis records: a tuning in progress comes first, nothing is counted while one is; else the tuning is
 * `due` when the records are at least `every` or `force` is set.
 */
export async function checkAutoTuning(dependencies: AutoTuningDependencies, settings: AutoTuningSettings, force: boolean): Promise<AutoTuningTrigger> {
  const state = readAutoTuning(dependencies.evalsFolder);
  if (state.current !== null) return { kind: "in_progress", tuning: state.current };
  const records = await newHypothesisRecords(dependencies.store, new Set(state.counted));
  if (records.length < settings.every && !force) return { kind: "not_due", count: records.length, every: settings.every };
  return { kind: "due", records, every: settings.every, forced: force };
}

/** Runs `action` holding the exclusive lock file of `auto.json`; another holder is a setup error, never waited for. */
function withAutoTuningLock<T>(evalsFolder: string, action: () => T): T {
  const path = autoTuningPath(evalsFolder);
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(lock, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SetupError(`Another tune auto is changing ${path}: its lock file ${lock} exists. Remove the file if no tune auto runs.`);
    }
    throw error;
  }
  try {
    writeSync(descriptor, `${process.pid}\n`);
    return action();
  } finally {
    closeSync(descriptor);
    rmSync(lock, { force: true });
  }
}

/**
 * Records a tuning in progress that counts `records`, so records added while it runs count toward the next one. The state
 * is read and written under a lock file, so of two overlapping starts one records its tuning and the other is refused. A
 * tuning already in progress is a conflict, not replaced, and so are records that another tuning counted since the trigger.
 */
export function startAutoTuning(dependencies: AutoTuningDependencies, due: Extract<AutoTuningTrigger, { kind: "due" }>): AutoTuningEntry {
  return withAutoTuningLock(dependencies.evalsFolder, () => recordStart(dependencies, due));
}

function recordStart(dependencies: AutoTuningDependencies, due: Extract<AutoTuningTrigger, { kind: "due" }>): AutoTuningEntry {
  const state = readAutoTuning(dependencies.evalsFolder);
  if (state.current !== null) throw new SetupError(`The automatic tuning ${state.current.tuningId} is in progress in ${autoTuningPath(dependencies.evalsFolder)}.`);
  const counted = new Set(state.counted);
  if (due.records.some((id) => counted.has(id))) {
    throw new SetupError(`Another automatic tuning counted some of these hypothesis records in ${autoTuningPath(dependencies.evalsFolder)}; run tune auto again.`);
  }
  const now = dependencies.now();
  const tuning: AutoTuningEntry = {
    tuningId: dependencies.newTuningId(now), startedUtc: now.toISOString(), forced: due.forced, records: [...due.records],
    dataset: null, cycle: null, branch: null, commit: null, merge: null, outcome: null, finishedUtc: null,
  };
  writeDocument(autoTuningPath(dependencies.evalsFolder), AutoTuningStateSchema.parse({ ...state, counted: [...state.counted, ...due.records], current: tuning }));
  return tuning;
}