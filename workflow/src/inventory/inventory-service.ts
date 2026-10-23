import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ZodType } from "zod";
import { captureNames, type PlannedCase } from "../cases/case-plan.js";
import { requireRecordedSource, requireSameSource } from "../diagnosis/candidate-source.js";
import { compiledIdentityOfPaths, compiledSourcePaths, type Git } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { buildCoverageManifest, type PlannedCaptures } from "./coverage-manifest.js";
import { CoverageManifestSchema, type CoverageManifest } from "./coverage-manifest-document.js";
import { readRunObservation } from "./run-observations.js";
import { readScope } from "./scope.js";
import { SourceInventorySchema } from "./source-inventory-document.js";
import { buildSourceInventory, designerPaths } from "./source-inventory.js";

/** What the run's report says about the inventory; the documents hold the rest. */
export type InventorySummary = {
  readonly folder: string;
  readonly classes: number;
  readonly activeClasses: number;
  readonly controls: { readonly active: number; readonly observed: number };
  readonly interactions: { readonly active: number; readonly exercised: number };
  readonly tuples: { readonly planned: number; readonly observed: number };
  readonly unresolved: number;
};

export type InventoryRequest = {
  readonly repositoryRoot: string;
  readonly git: Git;
  readonly scopeFile: string;
  /** The compiled-source identity the candidate's build recorded, or `unrecorded`. */
  readonly candidateSource: string;
  readonly plan: readonly PlannedCaptures[];
  readonly runFolders: readonly string[];
  readonly outputFolder: string;
  /** When set, every run's candidate must have this SHA-256: the runs must show the candidate built from the recorded source. */
  readonly candidateSha256?: string;
};

export const defaultScopeFile = join("parity", "inventory", "scope.json");

/** A planned case's captures as the workflow planned them: all of them, or those its capture filter selects. */
export function plannedCaptures(item: PlannedCase): PlannedCaptures {
  const filter = item.captureFilter;
  return { name: item.name, mode: item.mode, captures: captureNames(item).filter((name) => filter === null || filter.includes(name)) };
}

/** The report's inventory line: the totals, or why a thread that triaged has none; nothing for a thread that did not triage. */
export function inventoryLines(summary: InventorySummary | null | undefined, triaged: boolean): string[] {
  if (summary != null) return [describeInventory(summary)];
  return triaged && summary === undefined ? ["Inventory: not run; the thread started before its capture runs recorded UI trees."] : [];
}

export function describeInventory(summary: InventorySummary): string {
  return `Inventory: ${summary.classes} classes (${summary.activeClasses} active), controls observed ${summary.controls.observed}/${summary.controls.active}, `
    + `interactions exercised ${summary.interactions.exercised}/${summary.interactions.active}, tuples observed ${summary.tuples.observed}/${summary.tuples.planned}, `
    + `unresolved ${summary.unresolved}; ${summary.folder}`;
}

function summarize(folder: string, manifest: CoverageManifest): InventorySummary {
  const { totals } = manifest;
  return {
    folder, classes: totals.classes, activeClasses: totals.activeClasses,
    controls: { active: totals.controls.active, observed: totals.controls.observed },
    interactions: { active: totals.interactions.active, exercised: totals.interactions.exercised },
    tuples: { planned: totals.tuples.planned, observed: totals.tuples.observed },
    unresolved: totals.unresolved,
  };
}

/** A document that breaks its own schema is never written: its readers would reject it. */
export function requireValid(file: string, schema: ZodType, document: unknown): void {
  const result = schema.safeParse(document);
  if (result.success) return;
  const issue = result.error.issues[0];
  throw new SetupError(`${file} would not match its schema: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "invalid"}.`);
}

/**
 * Writes `source-inventory.json` and `coverage-manifest.json` into the output folder. When it reads capture runs, the
 * working tree's compiled source must be the one the candidate was built from, as its build recorded it; otherwise the
 * trees show another source. Without runs nothing is observed, so no build is needed.
 */
export async function writeInventory(request: InventoryRequest): Promise<InventorySummary> {
  const { repositoryRoot } = request;
  const sourcePaths = compiledSourcePaths(repositoryRoot, request.git);
  if (request.runFolders.length > 0) {
    requireRecordedSource(request.candidateSource, "only the workflow's build step records it. Build it with npm start.");
    requireSameSource(request.candidateSource, await compiledIdentityOfPaths(repositoryRoot, sourcePaths), "the UI trees do not show this source. Restore the source the candidate was built from, or start a new run of npm start, which builds it again.");
  }
  const inventory = buildSourceInventory(repositoryRoot, designerPaths(sourcePaths));
  const scopeFile = resolve(repositoryRoot, request.scopeFile);
  const scope = readScope(scopeFile);
  const inside = relative(repositoryRoot, scopeFile);
  const scopePath = inside.startsWith("..") || isAbsolute(inside) ? scopeFile : inside.replaceAll("\\", "/");
  const runs = request.runFolders.map((folder) => readRunObservation(folder));
  const expected = request.candidateSha256;
  for (const run of runs) {
    if (expected !== undefined && run.candidateSha256 !== expected) {
      throw new SetupError(`The capture run ${run.runFolder} captured the candidate ${run.candidateSha256.slice(0, 12)}, not the one built from the recorded source (${expected.slice(0, 12)}).`);
    }
  }
  const manifest = buildCoverageManifest({ inventory, scope, scopePath, plan: request.plan, runs });
  requireValid("source-inventory.json", SourceInventorySchema, inventory);
  requireValid("coverage-manifest.json", CoverageManifestSchema, manifest);
  mkdirSync(request.outputFolder, { recursive: true });
  writeFileSync(join(request.outputFolder, "source-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(join(request.outputFolder, "coverage-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return summarize(request.outputFolder, manifest);
}
