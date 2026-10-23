import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../diagnosis/context.js";
import { SetupError } from "../host/setup-error.js";
import { RegistrySchema, type Registry, type RegistryEntry } from "./registry-document.js";
import { scenarioCaseFile } from "./scenario-cases.js";

export type RegistryPaths = { readonly registry: string; readonly caseFile: string };

export function registryPaths(repositoryRoot: string): RegistryPaths {
  return { registry: join(repositoryRoot, "parity", "discovery", "registry.json"), caseFile: join(repositoryRoot, "parity", "cases", "discovered.json") };
}

/** A registry with the case timings it renders with and no entry. */
export function emptyRegistry(timings: Pick<Registry, "startupDelaySeconds" | "settleMilliseconds">): Registry {
  return { schemaVersion: 1, startupDelaySeconds: timings.startupDelaySeconds, settleMilliseconds: timings.settleMilliseconds, entries: [] };
}

/** The case file a registry renders to: one entry per registry entry, in case order. */
export function renderCaseFile(registry: Registry) {
  return scenarioCaseFile(registry, registry.entries.map((entry) => ({ path: entry.fixture, mode: entry.mode, scenario: entry.scenario, actions: entry.actions })));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SetupError(`${path} cannot be read: ${(error as Error).message}`);
  }
}

/**
 * The registry, or null when neither it nor its case file exists. One without the other, a registry that breaks its
 * schema or is not in case order with unique cases, and a case file that differs from the registry's rendering are setup errors.
 */
export function readRegistry(paths: RegistryPaths): Registry | null {
  const [hasRegistry, hasCaseFile] = [existsSync(paths.registry), existsSync(paths.caseFile)];
  if (!hasRegistry && !hasCaseFile) return null;
  if (!hasRegistry || !hasCaseFile) throw new SetupError(`${hasRegistry ? paths.caseFile : paths.registry} is missing; the registry and its case file exist together.`);
  const parsed = RegistrySchema.safeParse(readJson(paths.registry));
  if (!parsed.success) throw new SetupError(`The registry ${paths.registry} is invalid: ${z.prettifyError(parsed.error)}`);
  const registry = parsed.data;
  const cases = registry.entries.map((entry) => entry.case);
  if (cases.some((name, index) => index > 0 && cases[index - 1]! >= name)) throw new SetupError(`The registry ${paths.registry} does not list its cases once each in order.`);
  if (canonicalJson(readJson(paths.caseFile)) !== canonicalJson(renderCaseFile(registry))) {
    throw new SetupError(`${paths.caseFile} differs from the rendering of ${paths.registry}; edit both together or restore the case file.`);
  }
  return registry;
}

/** Writes the registry and its rendered case file together; a registry without entries has no case file to render. */
export function writeRegistry(paths: RegistryPaths, registry: Registry): void {
  const checked = RegistrySchema.parse(registry);
  if (checked.entries.length === 0) throw new Error("A registry without entries is never written: its case file would hold no character.");
  mkdirSync(dirname(paths.registry), { recursive: true });
  mkdirSync(dirname(paths.caseFile), { recursive: true });
  // Both files are complete before either name changes, so an interruption cannot leave a half-written file behind.
  const staged = [[paths.registry, checked], [paths.caseFile, renderCaseFile(checked)]] as const;
  for (const [path, document] of staged) writeFileSync(`${path}.tmp`, `${JSON.stringify(document, null, 2)}\n`);
  for (const [path] of staged) renameSync(`${path}.tmp`, path);
}

/** Removes the registry and its case file together. */
export function removeRegistry(paths: RegistryPaths): void {
  rmSync(paths.registry, { force: true });
  rmSync(paths.caseFile, { force: true });
}

/** The control and binding IDs the registry's entries proved for a source; entries of another source count for nothing. */
export function provedFor(registry: Registry | null, sourceSha256: string): { controls: Set<string>; interactions: Set<string> } {
  const entries = (registry?.entries ?? []).filter((entry) => entry.sourceSha256 === sourceSha256);
  return { controls: new Set(entries.flatMap((entry) => entry.proofs.controls)), interactions: new Set(entries.flatMap((entry) => entry.proofs.interactions)) };
}

/**
 * Adds the entries whose fixture case and actions no entry has yet. One that an entry of another source has replaces that entry,
 * whose proofs no longer count; one that an entry of the same source has is a duplicate and changes nothing.
 */
export function admit(registry: Registry, candidates: readonly RegistryEntry[]): { registry: Registry; admitted: string[]; duplicates: string[] } {
  const entries = [...registry.entries];
  const admitted: string[] = [];
  const duplicates: string[] = [];
  for (const candidate of candidates) {
    const same = entries.findIndex((entry) => entry.actionsSha256 === candidate.actionsSha256 || entry.case === candidate.case);
    if (same >= 0 && entries[same]!.sourceSha256 === candidate.sourceSha256) {
      duplicates.push(candidate.case);
      continue;
    }
    if (same >= 0) entries.splice(same, 1);
    entries.push(candidate);
    admitted.push(candidate.case);
  }
  entries.sort((left, right) => (left.case < right.case ? -1 : left.case > right.case ? 1 : 0));
  return { registry: { ...registry, entries }, admitted, duplicates };
}
