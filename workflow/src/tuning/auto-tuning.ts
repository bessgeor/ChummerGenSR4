import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readRecord, recordNamespace } from "../evals/eval-record.js";
import { datasetNamePattern } from "../evals/dataset.js";
import { isGradable } from "../evals/hindsight.js";
import { acquireExclusiveLock } from "../host/exclusive-lock.js";
import { SetupError } from "../host/setup-error.js";
import type { Profile } from "../options/profile.js";
import { readDocument } from "../steps/read-document.js";
import { writeDocument } from "../steps/write-document.js";

/** The profile's `autoTuning` with its defaults. */
const AutoTuningSettingsSchema = z.strictObject({
  every: z.number().int().positive(),
  dataset: z.string().regex(datasetNamePattern),
  minPass: z.number().min(0).max(1),
  candidates: z.number().int().min(1).max(3),
});
export type AutoTuningSettings = z.infer<typeof AutoTuningSettingsSchema>;

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
  /**
   * The settings it started with: a tuning continued later keeps them, whatever the profile says by then. A tuning recorded
   * before settings were kept has none, and takes the profile's when it is continued.
   */
  settings: AutoTuningSettingsSchema.optional(),
  /** The folder of the dataset version it freezes, recorded before the freeze. */
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
  | { readonly kind: "due"; readonly records: readonly string[]; readonly every: number; readonly forced: boolean; readonly settings: AutoTuningSettings }
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
  return { kind: "due", records, every: settings.every, forced: force, settings };
}

/** Runs `action` holding the exclusive lock on the lock database of `auto.json`. */
function withAutoTuningLock<T>(evalsFolder: string, action: () => T): T {
  const path = autoTuningPath(evalsFolder);
  const release = acquireExclusiveLock(`${path}.lock`, `Another tune auto is changing ${path}`);
  try {
    return action();
  } finally {
    release();
  }
}

/**
 * Runs `action`, which starts or continues an automatic tuning, holding a lock database apart from the state's, so two
 * `tune auto` never run a tuning at the same time.
 */
export async function withAutoTuningRun<T>(evalsFolder: string, action: () => Promise<T>): Promise<T> {
  const release = acquireExclusiveLock(`${autoTuningPath(evalsFolder)}.run.lock`, "Another tune auto runs an automatic tuning");
  try {
    return await action();
  } finally {
    release();
  }
}

/**
 * Records a tuning in progress that counts `records`, so records added while it runs count toward the next one. The state
 * is read and written under a lock, so of two overlapping starts one records its tuning and the other is refused. A
 * tuning already in progress is a conflict, not replaced, and so are records that another tuning counted since the trigger.
 */
export function startAutoTuning(dependencies: AutoTuningDependencies, due: Extract<AutoTuningTrigger, { kind: "due" }>): AutoTuningEntry {
  return withAutoTuningLock(dependencies.evalsFolder, () => recordStart(dependencies, due));
}

function recordStart(dependencies: AutoTuningDependencies, due: Extract<AutoTuningTrigger, { kind: "due" }>): AutoTuningEntry {
  const state = readAutoTuning(dependencies.evalsFolder);
  const now = dependencies.now();
  const tuningId = dependencies.newTuningId(now);
  // A start repeated under the same tuning ID (its node interrupted after it wrote the state) finds its own tuning.
  if (state.current?.tuningId === tuningId) return state.current;
  if (state.current !== null) throw new SetupError(`The automatic tuning ${state.current.tuningId} is in progress in ${autoTuningPath(dependencies.evalsFolder)}.`);
  const counted = new Set(state.counted);
  if (due.records.some((id) => counted.has(id))) {
    throw new SetupError(`Another automatic tuning counted some of these hypothesis records in ${autoTuningPath(dependencies.evalsFolder)}; run tune auto again.`);
  }
  const tuning: AutoTuningEntry = {
    tuningId, startedUtc: now.toISOString(), forced: due.forced, records: [...due.records], settings: due.settings,
    dataset: null, cycle: null, branch: null, commit: null, merge: null, outcome: null, finishedUtc: null,
  };
  writeDocument(autoTuningPath(dependencies.evalsFolder), AutoTuningStateSchema.parse({ ...state, counted: [...state.counted, ...due.records], current: tuning }));
  return tuning;
}

/** The tuning in progress, which must be `tuningId`. */
export function currentTuning(evalsFolder: string, state: AutoTuningState, tuningId: string): AutoTuningEntry {
  if (state.current?.tuningId !== tuningId) {
    throw new SetupError(`The automatic tuning ${tuningId} is not the one in progress in ${autoTuningPath(evalsFolder)} (${state.current?.tuningId ?? "none"}).`);
  }
  return state.current;
}

/** Records the dataset or the cycle of the tuning in progress, under the state's lock. */
export function recordAutoTuning(evalsFolder: string, tuningId: string, fields: Partial<Pick<AutoTuningEntry, "dataset" | "cycle" | "settings">>): AutoTuningEntry {
  return withAutoTuningLock(evalsFolder, () => {
    const state = readAutoTuning(evalsFolder);
    const tuning = { ...currentTuning(evalsFolder, state, tuningId), ...fields };
    writeDocument(autoTuningPath(evalsFolder), AutoTuningStateSchema.parse({ ...state, current: tuning }));
    return tuning;
  });
}

/**
 * Ends the tuning in progress with its cycle's outcome: it moves to `tunings`, and nothing is in progress. A tuning that
 * already ended (its node interrupted after it wrote the state) is returned as it is.
 */
export function finishAutoTuning(evalsFolder: string, tuningId: string, outcome: NonNullable<AutoTuningEntry["outcome"]>, now: Date): AutoTuningEntry {
  return withAutoTuningLock(evalsFolder, () => {
    const state = readAutoTuning(evalsFolder);
    const ended = state.tunings.find((tuning) => tuning.tuningId === tuningId);
    if (ended !== undefined) return ended;
    const tuning: AutoTuningEntry = { ...currentTuning(evalsFolder, state, tuningId), outcome, finishedUtc: now.toISOString() };
    writeDocument(autoTuningPath(evalsFolder), AutoTuningStateSchema.parse({ ...state, tunings: [...state.tunings, tuning], current: null }));
    return tuning;
  });
}