import { SetupError } from "../host/setup-error.js";
import type { CoverageManifest, ExerciseProof, ManifestControl, ManifestInteraction, TupleStatus } from "./coverage-manifest-document.js";
import type { CaptureObservation, RunObservation } from "./run-observations.js";
import { checkScope, deferral, type Scope } from "./scope.js";
import type { SourceInventory } from "./source-inventory-document.js";
import { ClassIndex, isWindowless, matchTree, type TreeMatch } from "./tree-matching.js";

/** The events a tab control raises when its selected page changes. */
export const selectionEvents: ReadonlySet<string> = new Set(["SelectedIndexChanged", "Selected", "Selecting", "Deselecting", "Deselected"]);

/** A case as planned: its captures in action order. */
export type PlannedCaptures = { readonly name: string; readonly mode: "build" | "career"; readonly captures: readonly string[] };

export type ManifestInput = {
  readonly inventory: SourceInventory;
  readonly scope: Scope;
  /** The scope file's path as the manifest names it. */
  readonly scopePath: string;
  readonly plan: readonly PlannedCaptures[];
  readonly runs: readonly RunObservation[];
};

type Seen = { readonly case: string; readonly capture: string };
/** A planned case's run with the case's captures and the action indexes of its tab selections. */
type CaseRun = { readonly run: RunObservation; readonly captures: readonly CaptureObservation[]; readonly selectTabs: readonly number[] };
type Matched = CaptureObservation & { readonly actionIndex: number; readonly match: TreeMatch };

/** Each planned case's run; a case in two runs, or a run's case that no plan holds, is a setup error. */
function runsByCase(plan: readonly PlannedCaptures[], runs: readonly RunObservation[]): Map<string, CaseRun> {
  const planned = new Set(plan.map((item) => item.name));
  const found = new Map<string, CaseRun>();
  for (const run of runs) {
    for (const item of run.cases) {
      if (!planned.has(item.case)) throw new SetupError(`The capture run ${run.runFolder} holds the case ${item.case}, which no plan holds.`);
      const other = found.get(item.case);
      if (other !== undefined) throw new SetupError(`The case ${item.case} is in two capture runs: ${other.run.runFolder} and ${run.runFolder}.`);
      found.set(item.case, { run, captures: item.captures, selectTabs: item.selectTabs });
    }
  }
  return found;
}

function appendTo<Value>(map: Map<string, Value[]>, key: string, value: Value): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** The proofs that a `selectTab` changed a tab control's visible page between two consecutive performed captures of a case. */
function exerciseProofs(caseName: string, matched: readonly Matched[], selectTabs: readonly number[], into: Map<string, ExerciseProof[]>): void {
  for (let position = 1; position < matched.length; position++) {
    const from = matched[position - 1]!;
    const to = matched[position]!;
    if (!selectTabs.some((index) => index > from.actionIndex && index < to.actionIndex)) continue;
    for (const [tabControl, toPage] of to.match.pages) {
      const fromPage = from.match.pages.get(tabControl);
      if (fromPage === undefined || fromPage === toPage) continue;
      appendTo(into, tabControl, { case: caseName, from: from.capture, to: to.capture, fromPage, toPage });
    }
  }
}

/**
 * Joins the source inventory, the scope, the plan and the capture runs. A control is observed only where a recorded tree
 * matched it, and a binding is exercised only with a proof from consecutive captures; nothing is inferred from the source.
 */
export function buildCoverageManifest(input: ManifestInput): CoverageManifest {
  const { inventory, scope } = input;
  checkScope(scope, inventory, input.scopePath);
  const index = new ClassIndex(inventory.classes);
  const cases = runsByCase(input.plan, input.runs);

  const tuples: CoverageManifest["tuples"] = [];
  const seen = new Map<string, Seen[]>();
  const proofs = new Map<string, ExerciseProof[]>();
  const unresolved: CoverageManifest["unresolved"] = [];
  for (const planned of input.plan) {
    const found = cases.get(planned.name);
    for (const capture of planned.captures) {
      const observation = found?.captures.find((item) => item.capture === capture);
      if (found !== undefined && observation === undefined) throw new SetupError(`The capture run ${found.run.runFolder} does not plan the capture ${planned.name}/${capture}.`);
      const status: TupleStatus = observation === undefined ? "not-captured" : observation.outcome === "performed" ? "observed" : observation.outcome;
      tuples.push({ case: planned.name, mode: planned.mode, capture, status, runId: found?.run.runId ?? null });
    }
    if (found === undefined) continue;
    const matched: Matched[] = found.captures.flatMap((item) => {
      if (item.nodes === null) return [];
      if (item.actionIndex === null) throw new SetupError(`The capture run ${found.run.runFolder} has a tree for ${planned.name}/${item.capture} but no capture action.`);
      return [{ ...item, actionIndex: item.actionIndex, match: matchTree(item.nodes, index) }];
    }).sort((left, right) => left.actionIndex - right.actionIndex);
    for (const item of matched) {
      for (const control of item.match.controls) appendTo(seen, control, { case: planned.name, capture: item.capture });
      if (item.match.unresolved.length > 0) unresolved.push({ case: planned.name, capture: item.capture, automationIds: [...item.match.unresolved] });
    }
    exerciseProofs(planned.name, matched, found.selectTabs, proofs);
  }

  const controls: ManifestControl[] = [];
  const interactions: ManifestInteraction[] = [];
  const classes: CoverageManifest["classes"] = [];
  for (const item of inventory.classes) {
    const declared = scope.classes[item.name]!;
    const classDeferral = deferral(scope, item.name, null);
    const classControls = item.controls.map((control): ManifestControl => {
      const base = { id: `${item.name}.${control.name}`, class: item.name, name: control.name, type: control.type };
      if (classDeferral !== null) return { ...base, status: "deferred", reason: classDeferral };
      const where = seen.get(base.id);
      if (where !== undefined) return { ...base, status: "observed", seenIn: where };
      return { ...base, status: isWindowless(control.type) ? "windowless" : "unobserved" };
    });
    const classInteractions = item.interactions.map((interaction): ManifestInteraction => {
      const base = {
        id: interaction.id, class: item.name, target: interaction.target, event: interaction.event,
        handler: interaction.handler, handlerFile: interaction.handlerFile, handlerLine: interaction.handlerLine,
      };
      const why = deferral(scope, item.name, interaction.event);
      if (why !== null) return { ...base, status: "deferred", reason: why };
      const proven = interaction.target !== null && interaction.member === null && selectionEvents.has(interaction.event)
        ? proofs.get(`${item.name}.${interaction.target}`) : undefined;
      return proven === undefined ? { ...base, status: "unexercised" } : { ...base, status: "exercised", proofs: proven };
    });
    controls.push(...classControls);
    interactions.push(...classInteractions);
    classes.push({
      name: item.name, scope: declared.scope, reason: declared.reason,
      controls: classControls.filter((control) => control.status !== "windowless").length,
      observedControls: classControls.filter((control) => control.status === "observed").length,
      windowlessControls: classControls.filter((control) => control.status === "windowless").length,
      interactions: classInteractions.length,
      exercisedInteractions: classInteractions.filter((interaction) => interaction.status === "exercised").length,
      deferredInteractions: classInteractions.filter((interaction) => interaction.status === "deferred").length,
    });
  }

  const tupleCount = (status: TupleStatus) => tuples.filter((tuple) => tuple.status === status).length;
  return {
    schemaVersion: 1,
    sourceSha256: inventory.sourceSha256,
    scope: { path: input.scopePath, sha256: scope.sha256 },
    runs: input.runs.map((run) => ({ runId: run.runId, runFolder: run.runFolder, candidateSha256: run.candidateSha256 })),
    tuples, classes, controls, interactions, unresolved,
    totals: {
      classes: classes.length,
      activeClasses: classes.filter((item) => item.scope === "active").length,
      controls: {
        active: controls.filter((control) => control.status === "observed" || control.status === "unobserved").length,
        observed: controls.filter((control) => control.status === "observed").length,
        windowless: controls.filter((control) => control.status === "windowless").length,
        deferred: controls.filter((control) => control.status === "deferred").length,
      },
      interactions: {
        active: interactions.filter((interaction) => interaction.status !== "deferred").length,
        exercised: interactions.filter((interaction) => interaction.status === "exercised").length,
        deferred: interactions.filter((interaction) => interaction.status === "deferred").length,
      },
      tuples: {
        planned: tuples.length, observed: tupleCount("observed"), failed: tupleCount("failed"), filtered: tupleCount("filtered"), missing: tupleCount("missing"),
        "not-run": tupleCount("not-run"), "optional-absent": tupleCount("optional-absent"), "skipped-optional": tupleCount("skipped-optional"),
        "not-captured": tupleCount("not-captured"),
      },
      unresolved: unresolved.reduce((sum, item) => sum + item.automationIds.length, 0),
    },
  };
}
