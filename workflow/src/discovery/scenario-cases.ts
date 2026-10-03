import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { ParityCases } from "../../../contracts/generated/typescript/parity-cases.js";
import { canonicalJson } from "../diagnosis/context.js";
import { sha256Text } from "../steps/fingerprint.js";
import type { ScenarioAction } from "./registry-document.js";

/** A scenario as a case file entry states it. */
export type ScenarioEntry = {
  readonly fixturePath: string;
  readonly mode: "build" | "career";
  readonly scenario: string;
  readonly actions: readonly ScenarioAction[];
};

export type CaseTimings = { readonly startupDelaySeconds: number; readonly settleMilliseconds: number };

/** SHA-256 of the canonical JSON of a scenario's fixture case and actions: two scenarios with the same are duplicates. */
export function actionsSha256(fixtureCase: string, actions: readonly ScenarioAction[]): string {
  return sha256Text(canonicalJson({ case: fixtureCase, actions }));
}

/** The target ID in lower case with every other run of characters a dash, cut to 48, and the first 8 hex digits of the actions' hash. */
export function scenarioName(targetId: string, fixtureCase: string, actions: readonly ScenarioAction[]): string {
  const slug = targetId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return `${slug.length === 0 ? "scenario" : slug}-${actionsSha256(fixtureCase, actions).slice(0, 8)}`;
}

/** The fixture path as a case file in `folder` names it: relative, with forward slashes. */
export function fixtureReference(folder: string, fixturePath: string): string {
  return relative(folder, fixturePath).replaceAll("\\", "/");
}

/** A case file holding the entries with their own actions, no mode actions and no sequences. */
export function scenarioCaseFile(timings: CaseTimings, entries: readonly { path: string; mode: "build" | "career"; scenario: string; actions: readonly ScenarioAction[] }[]): ParityCases {
  return {
    startupDelaySeconds: timings.startupDelaySeconds, settleMilliseconds: timings.settleMilliseconds, sequences: {}, buildActions: [], careerActions: [],
    characters: entries.map((entry) => ({ path: entry.path, mode: entry.mode, scenario: entry.scenario, actions: entry.actions.map((action) => ({ ...action })) })),
  };
}

/** Writes a case file of scenarios at `path`, each fixture named relative to it. */
export function writeScenarioCaseFile(path: string, timings: CaseTimings, entries: readonly ScenarioEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const document = scenarioCaseFile(timings, entries.map((entry) => ({ ...entry, path: fixtureReference(dirname(path), entry.fixturePath) })));
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
