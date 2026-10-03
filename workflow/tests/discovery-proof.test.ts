import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CaptureResults } from "../../contracts/generated/typescript/parity-capture-results.js";
import type { ExecutionCoverage } from "../../contracts/generated/typescript/parity-execution-coverage.js";
import { isProven, proveScenarios } from "../src/discovery/proof.js";
import type { RegistryEntry } from "../src/discovery/registry-document.js";
import { admit, emptyRegistry, provedFor, readRegistry, registryPaths, renderCaseFile, writeRegistry } from "../src/discovery/registry.js";
import { actionsSha256, scenarioName, writeScenarioCaseFile } from "../src/discovery/scenario-cases.js";
import { planCases } from "../src/cases/case-plan.js";
import { SetupError } from "../src/host/setup-error.js";
import { formTree, scratch, writeRun, type CaseSpec } from "./inventory-fixtures.js";
import { inventory, manifestWith, scope } from "./discovery-fixtures.js";

const armorCase = "build-Alpha@armor";
const tabsCase = "build-Alpha@tabs";

/** A scenario run: the trees and coverage of `writeRun`, every side clean unless `failed` names the case, and result rows. */
function scenarioRun(cases: readonly CaseSpec[], options: { failed?: string; differing?: readonly string[]; invalidReasons?: readonly string[] } = {}): string {
  const folder = writeRun(scratch(), "20261003T120000Z-0000aaaa", cases);
  const coverage = JSON.parse(readFileSync(join(folder, "coverage.json"), "utf8")) as ExecutionCoverage;
  for (const item of coverage.cases) {
    item.sides = item.sides.map((side) => ({
      ...side, contiguous: true, notRun: 0,
      failures: item.case === options.failed && side.side === "candidate" ? [{ index: 1, action: "waitFor:Selected Armor", reason: "TimeoutException: timed out" }] : [],
    }));
  }
  coverage.invalidReasons = [...(options.invalidReasons ?? [])];
  coverage.valid = coverage.invalidReasons.length === 0;
  writeFileSync(join(folder, "coverage.json"), JSON.stringify(coverage));
  const results: CaptureResults = {
    runId: "20261003T120000Z-0000aaaa", threshold: 0.00004,
    results: cases.flatMap((item) => item.captures.map((capture) => {
      const differs = options.differing?.includes(`${item.case}/${capture.capture}`) ?? false;
      return {
        case: item.case, characterFile: "Alpha.chum", mode: "build" as const, capture: capture.capture, passed: !differs,
        reason: differs ? "visual-difference" as const : "within-threshold" as const, difference: differs ? 0.01 : 0,
      };
    })),
  };
  writeFileSync(join(folder, "results.json"), JSON.stringify(results));
  return folder;
}

const armorSpec: CaseSpec = {
  case: armorCase, actions: [{ action: "selectTab:Street Gear", outcome: "performed" }, { action: "selectTab:Armor", outcome: "performed" }, { action: "capture:armor", outcome: "performed" }],
  captures: [{ capture: "armor", outcome: "performed", tree: formTree("Street Gear", "Armor", [["lblArmorCost", 7], ["lblKarma", 2]]) }],
};
const tabsSpec: CaseSpec = {
  case: tabsCase,
  actions: [{ action: "capture:lifestyle", outcome: "performed" }, { action: "selectTab:Armor", outcome: "performed" }, { action: "capture:armor", outcome: "performed" }],
  captures: [
    { capture: "lifestyle", outcome: "performed", tree: formTree("Street Gear", "Lifestyle") },
    { capture: "armor", outcome: "performed", tree: formTree("Street Gear", "Armor") },
  ],
};
const plan = [{ name: armorCase, mode: "build" as const, captures: ["armor"] }, { name: tabsCase, mode: "build" as const, captures: ["lifestyle", "armor"] }];
const observedBefore = ["frmMain.menuStrip", "frmCreate.tabCharacterTabs", "frmCreate.tabStreetGear", "frmCreate.tabStreetGearTabs", "frmCreate.lblKarma"];

function prove(runFolder: string, proved: { controls?: string[]; interactions?: string[] } = {}) {
  return proveScenarios({
    runFolder, inventory, scope, baseline: manifestWith(observedBefore), scenarios: plan,
    provedControls: new Set(proved.controls ?? []), provedInteractions: new Set(proved.interactions ?? []),
  }).proofs;
}

test("a scenario proves the controls its trees show that the baseline left unobserved, and a selection by the exercise rule", () => {
  const [armor, tabs] = prove(scenarioRun([armorSpec, tabsSpec]));
  deepStrictEqual(armor, {
    case: armorCase, execution: "executed", failures: [], visual: { outcome: "clear", differing: [] },
    proofs: { controls: ["frmCreate.tabArmor", "frmCreate.lblArmorCost"], interactions: [] },
  });
  deepStrictEqual(tabs!.proofs, { controls: ["frmCreate.tabLifestyle", "frmCreate.tabArmor"], interactions: ["frmCreate.tabStreetGearTabs.SelectedIndexChanged"] });
  strictEqual(isProven(armor!), true);
});

test("what the registry proved is no proof again, and a clean scenario without proof is not proven", () => {
  const [armor] = prove(scenarioRun([armorSpec, tabsSpec]), { controls: ["frmCreate.tabArmor", "frmCreate.lblArmorCost"] });
  deepStrictEqual(armor!.proofs, { controls: [], interactions: [] });
  strictEqual(isProven(armor!), false);
});

test("a failed action makes the scenario execution-failed without proof or visual outcome; a differing row is a finding", () => {
  const [armor, tabs] = prove(scenarioRun([armorSpec, tabsSpec], { failed: armorCase, differing: [`${tabsCase}/armor`] }));
  deepStrictEqual(armor, {
    case: armorCase, execution: "execution-failed", failures: ["candidate: 1 waitFor:Selected Armor: TimeoutException: timed out"], visual: null, proofs: { controls: [], interactions: [] },
  });
  strictEqual(isProven(armor!), false);
  deepStrictEqual(tabs!.visual, { outcome: "finding", differing: ["armor"] });
});

test("a capture the auditor found without its file makes the scenario execution-failed", () => {
  const [armor, tabs] = prove(scenarioRun([armorSpec, tabsSpec], { invalidReasons: [`capture-without-file:${armorCase}/canonical`] }));
  deepStrictEqual([armor!.execution, armor!.failures, armor!.visual], ["execution-failed", [`coverage: capture-without-file:${armorCase}/canonical`], null]);
  strictEqual(tabs!.execution, "executed");
});

test("a scenario the run's coverage lacks is a setup error", () => {
  throws(() => proveScenarios({
    runFolder: scenarioRun([armorSpec]), inventory, scope, baseline: manifestWith(observedBefore), scenarios: [plan[0]!, { name: "build-Alpha@x", mode: "build", captures: ["x"] }],
    provedControls: new Set(), provedInteractions: new Set(),
  }), SetupError);
});

const actions = [{ type: "selectTab" as const, name: "Armor" }, { type: "capture" as const, name: "armor" }];

function entry(name: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    case: `build-Alpha@${name}`, fixtureCase: "build-Alpha", mode: "build", scenario: name, fixture: "../fixtures/Alpha.chum", actions,
    actionsSha256: actionsSha256("build-Alpha", actions), target: "frmCreate/tabStreetGear/tabArmor", sourceSha256: inventory.sourceSha256,
    proofs: { controls: ["frmCreate.lblArmorCost"], interactions: [] }, visual: { outcome: "clear", differing: [] },
    provenance: { thread: "disc-1", runId: "20261003T120000Z-0000aaaa", records: ["disc-1/scenario/1"] }, admittedUtc: "2026-10-03T12:00:00.000Z", ...overrides,
  };
}

test("scenario names are the target slug and the actions' hash, and a scenario case file loads with its case names", () => {
  const name = scenarioName("frmCreate/tabStreetGear/tabArmor", "build-Alpha", actions);
  strictEqual(name, `frmcreate-tabstreetgear-tabarmor-${actionsSha256("build-Alpha", actions).slice(0, 8)}`);
  strictEqual(scenarioName("frmCreate.tabStreetGearTabs#selection", "build-Alpha", actions).startsWith("frmcreate-tabstreetgeartabs-selection-"), true);
  strictEqual(scenarioName("x".repeat(80), "build-Alpha", actions).length, 48 + 9);
  const root = mkdtempSync(join(tmpdir(), "discovery-cases-"));
  writeFileSync(join(root, "Alpha.chum"), "");
  const caseFile = join(root, "thread", "cases.json");
  writeScenarioCaseFile(caseFile, { startupDelaySeconds: 3, settleMilliseconds: 300 }, [{ fixturePath: join(root, "Alpha.chum"), mode: "build", scenario: "armor", actions }]);
  const planned = planCases(caseFile, [], []).cases;
  deepStrictEqual(planned.map((item) => [item.name, item.actions]), [["build-Alpha@armor", actions]]);
  strictEqual(JSON.parse(readFileSync(caseFile, "utf8")).characters[0].path, "../Alpha.chum");
});

test("the registry admits new scenarios in case order, keeps duplicates out and renders its case file", () => {
  const first = admit(emptyRegistry({ startupDelaySeconds: 3, settleMilliseconds: 300 }), [entry("b"), entry("a", { actionsSha256: "f".repeat(64) })]);
  deepStrictEqual(first.registry.entries.map((item) => item.case), ["build-Alpha@a", "build-Alpha@b"]);
  const again = admit(first.registry, [entry("c"), entry("a", { actionsSha256: "e".repeat(64) })]);
  deepStrictEqual([again.admitted, again.duplicates], [[], ["build-Alpha@c", "build-Alpha@a"]]);
  const rendered = renderCaseFile(first.registry);
  deepStrictEqual(rendered.characters.map((item) => [item.scenario, item.path, item.mode]), [["a", "../fixtures/Alpha.chum", "build"], ["b", "../fixtures/Alpha.chum", "build"]]);
  deepStrictEqual([rendered.buildActions, rendered.careerActions, rendered.sequences, rendered.startupDelaySeconds], [[], [], {}, 3]);
});

test("reading the registry checks its schema, order and case file; what it proved counts only for its source", () => {
  const root = mkdtempSync(join(tmpdir(), "discovery-registry-"));
  const paths = registryPaths(root);
  strictEqual(readRegistry(paths), null);
  const registry = admit(emptyRegistry({ startupDelaySeconds: 3, settleMilliseconds: 300 }), [entry("a")]).registry;
  writeRegistry(paths, registry);
  deepStrictEqual(readRegistry(paths), registry);
  deepStrictEqual(provedFor(registry, inventory.sourceSha256).controls, new Set(["frmCreate.lblArmorCost"]));
  deepStrictEqual(provedFor(registry, "0".repeat(64)).controls.size, 0);
  const caseText = readFileSync(paths.caseFile, "utf8");
  writeFileSync(paths.caseFile, caseText.replace("\"Armor\"", "\"Weapons\""));
  throws(() => readRegistry(paths), (error: Error) => error instanceof SetupError && /differs from the rendering/.test(error.message));
  writeFileSync(paths.caseFile, caseText);
  writeFileSync(paths.registry, JSON.stringify({ ...registry, entries: [{ ...registry.entries[0], target: "" }] }));
  throws(() => readRegistry(paths), (error: Error) => error instanceof SetupError && /is invalid/.test(error.message));
  writeFileSync(paths.registry, JSON.stringify({ ...registry, entries: [registry.entries[0], registry.entries[0]] }));
  throws(() => readRegistry(paths), (error: Error) => error instanceof SetupError && /once each in order/.test(error.message));
  const lone = registryPaths(mkdtempSync(join(tmpdir(), "discovery-registry-")));
  writeRegistry(lone, registry);
  writeFileSync(lone.caseFile, "");
  throws(() => readRegistry({ ...lone, caseFile: join(root, "missing.json") }), (error: Error) => error instanceof SetupError && /missing/.test(error.message));
});
