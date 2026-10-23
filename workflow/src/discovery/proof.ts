import { join } from "node:path";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { ExecutionCoverageSchema } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import { SetupError } from "../host/setup-error.js";
import { buildCoverageManifest, type PlannedCaptures } from "../inventory/coverage-manifest.js";
import type { CoverageManifest } from "../inventory/coverage-manifest-document.js";
import { readRunObservation } from "../inventory/run-observations.js";
import type { Scope } from "../inventory/scope.js";
import type { SourceInventory } from "../inventory/source-inventory-document.js";
import { readDocument } from "../steps/read-document.js";

/** What one scenario's run showed: whether every action ran, how it looked, and the coverage its trees proved. */
export type ScenarioProof = {
  readonly case: string;
  readonly execution: "executed" | "execution-failed";
  /** Each side's failures and actions not run, as `side: index action: reason`; empty when it executed. */
  readonly failures: readonly string[];
  /** Null when it did not execute: then no row is judged. */
  readonly visual: { readonly outcome: "clear" | "finding"; readonly differing: readonly string[] } | null;
  readonly proofs: { readonly controls: readonly string[]; readonly interactions: readonly string[] };
};

export type ProofInput = {
  readonly runFolder: string;
  readonly inventory: SourceInventory;
  readonly scope: Scope;
  readonly baseline: CoverageManifest;
  /** Control and binding IDs the registry proved for this source, which count as covered already. */
  readonly provedControls: ReadonlySet<string>;
  readonly provedInteractions: ReadonlySet<string>;
  /** The run's scenario cases with their planned captures. */
  readonly scenarios: readonly PlannedCaptures[];
};

/**
 * Reads a scenario run made with UI trees and decides each scenario's execution and visual outcomes and its proofs: the
 * controls the baseline left unobserved that the run's manifest observed in its case, and the selection bindings the
 * baseline left unexercised that it exercised there. A scenario that did not execute proves nothing.
 */
export function proveScenarios(input: ProofInput): { manifest: CoverageManifest; proofs: ScenarioProof[] } {
  const coverage = readDocument(join(input.runFolder, "coverage.json"), ExecutionCoverageSchema);
  const results = readDocument(join(input.runFolder, "results.json"), CaptureResultsSchema);
  const manifest = buildCoverageManifest({ inventory: input.inventory, scope: input.scope, scopePath: input.scope.path, plan: input.scenarios, runs: [readRunObservation(input.runFolder)] });
  const before = {
    controls: new Map(input.baseline.controls.map((control) => [control.id, control.status])),
    interactions: new Map(input.baseline.interactions.map((interaction) => [interaction.id, interaction.status])),
  };
  const proofs = input.scenarios.map((scenario): ScenarioProof => {
    const covered = coverage.cases.find((item) => item.case === scenario.name);
    if (covered === undefined) throw new SetupError(`The scenario run ${input.runFolder} has no coverage of ${scenario.name}.`);
    const failures = covered.sides.flatMap((side) => [
      ...side.failures.map((failure) => `${side.side}: ${failure.index} ${failure.action}: ${failure.reason}`),
      ...(side.notRun > 0 ? [`${side.side}: ${side.notRun} actions not run`] : []),
      ...(side.contiguous ? [] : [`${side.side}: the recorded actions are not contiguous`]),
    ]);
    // The auditor also calls a run invalid for a capture without its file and a file without its capture, which no side field shows.
    const audited = coverage.invalidReasons.filter((reason) => reason.slice(0, reason.indexOf(":")) !== "failure" && reason.slice(reason.indexOf(":") + 1, reason.lastIndexOf("/")) === scenario.name);
    failures.push(...audited.map((reason) => `coverage: ${reason}`));
    if (failures.length > 0) return { case: scenario.name, execution: "execution-failed", failures, visual: null, proofs: { controls: [], interactions: [] } };
    const rows = results.results.filter((row) => row.case === scenario.name);
    const differing = rows.filter((row) => !row.passed).map((row) => row.capture);
    const controls = manifest.controls.filter((control) => control.status === "observed" && control.seenIn.some((seen) => seen.case === scenario.name)
      && before.controls.get(control.id) === "unobserved" && !input.provedControls.has(control.id)).map((control) => control.id);
    const interactions = manifest.interactions.filter((interaction) => interaction.status === "exercised" && interaction.proofs.some((proof) => proof.case === scenario.name)
      && before.interactions.get(interaction.id) === "unexercised" && !input.provedInteractions.has(interaction.id)).map((interaction) => interaction.id);
    return {
      case: scenario.name, execution: "executed", failures: [], visual: { outcome: differing.length === 0 ? "clear" : "finding", differing }, proofs: { controls, interactions },
    };
  });
  return { manifest, proofs };
}

/** Whether a scenario proved coverage: it executed and its trees showed something the baseline and the registry did not. */
export function isProven(proof: ScenarioProof): boolean {
  return proof.execution === "executed" && proof.proofs.controls.length + proof.proofs.interactions.length > 0;
}
