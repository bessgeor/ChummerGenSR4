import type { PlannedCase } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";

/** The levels of the ladder, narrowest first. */
export const levelNames = ["narrow", "character", "mode", "suite"] as const;
export type LevelName = (typeof levelNames)[number];

/** What one level captures: the named cases, and only the named captures unless the filter is null. */
export type LevelSelection = { readonly cases: readonly string[]; readonly captures: readonly string[] | null };

/** The cases and captures of a cluster, as triage lists them. */
export type ClusterScope = { readonly cases: readonly string[]; readonly captures: readonly string[] };

/**
 * What a level captures, over every case of the case file in its order: `narrow` the cluster's cases and captures,
 * `character` every capture of the cluster's cases, `mode` every other case of the cluster's modes, and `suite`
 * every case the earlier levels left out. A level with no case has nothing new to capture.
 */
export function levelSelection(level: LevelName, all: readonly PlannedCase[], cluster: ClusterScope): LevelSelection {
  const own = cluster.cases.map((name) => {
    const found = all.find((item) => item.name === name);
    if (found === undefined) throw new SetupError(`The cluster names case ${name}, which the case file does not have.`);
    return found;
  });
  const modes = new Set(own.map((item) => item.mode));
  const inMode = all.filter((item) => modes.has(item.mode) && !cluster.cases.includes(item.name)).map((item) => item.name);
  switch (level) {
    case "narrow": return { cases: own.map((item) => item.name), captures: [...cluster.captures] };
    case "character": return { cases: own.map((item) => item.name), captures: null };
    case "mode": return { cases: inMode, captures: null };
    case "suite": return { cases: all.map((item) => item.name).filter((name) => !cluster.cases.includes(name) && !inMode.includes(name)), captures: null };
  }
}

/** The level after `level`, or null after the last one. */
export function nextLevel(level: LevelName | null): LevelName | null {
  if (level === null) return levelNames[0];
  return levelNames[levelNames.indexOf(level) + 1] ?? null;
}
