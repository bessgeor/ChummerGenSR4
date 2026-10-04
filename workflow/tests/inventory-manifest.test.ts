import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { buildCoverageManifest, type PlannedCaptures } from "../src/inventory/coverage-manifest.js";
import { CoverageManifestSchema, type CoverageManifest } from "../src/inventory/coverage-manifest-document.js";
import { readRunObservation } from "../src/inventory/run-observations.js";
import { ClassIndex, matchTree } from "../src/inventory/tree-matching.js";
import { formTree, inventory, nodes, scope, scratch, tabItem, writeRun, type CaseSpec } from "./inventory-fixtures.js";

const index = new ClassIndex(inventory.classes);

function plan(...cases: [string, string[]][]): PlannedCaptures[] {
  return cases.map(([name, captures]) => ({ name, mode: "build", captures }));
}

function manifest(planned: PlannedCaptures[], ...runs: string[]): CoverageManifest {
  return CoverageManifestSchema.parse(buildCoverageManifest({ inventory, scope, scopePath: scope.path, plan: planned, runs: runs.map(readRunObservation) }));
}

function failsWith(action: () => unknown, pattern: RegExp): void {
  throws(action, (error: unknown) => error instanceof SetupError && pattern.test(error.message));
}

/** Street gear: lifestyle, then armor after selecting its tab, then armor again after selecting it once more. */
const streetGear: CaseSpec = {
  case: "build-a",
  actions: [
    { action: "selectTab:Street Gear", outcome: "performed" },
    { action: "capture:lifestyle", outcome: "performed" },
    { action: "selectTab:Armor", outcome: "performed" },
    { action: "capture:armor", outcome: "performed" },
    { action: "selectTab:Armor", outcome: "performed" },
    { action: "capture:armor-again", outcome: "performed" },
    { action: "selectTab:Skills", outcome: "failed" },
    { action: "capture:skills", outcome: "not-run" },
  ],
  captures: [
    { capture: "lifestyle", outcome: "performed", tree: formTree("Street Gear", "Lifestyle") },
    { capture: "armor", outcome: "performed", tree: formTree("Street Gear", "Armor") },
    { capture: "armor-again", outcome: "performed", tree: formTree("Street Gear", "Armor") },
    { capture: "skills", outcome: "not-run" },
  ],
};

test("nodes match declared controls in the context of their class, including class instances", () => {
  const match = matchTree(formTree("Skills", null, [["cmdAdd", 4], ["SkillControl", 4], ["cmdImprove", 7], ["lblDynamic", 7], ["cmdOK", 4]]), index);
  deepStrictEqual([...match.controls].sort(), ["SkillControl.cmdImprove", "frmCreate.cmdAdd", "frmCreate.tabCharacterTabs", "frmCreate.tabSkills"]);
  deepStrictEqual(match.unresolved, ["cmdOK", "lblDynamic"]);
  deepStrictEqual([...match.pages], [["frmCreate.tabCharacterTabs", "Skills"]]);
});

test("a control is not matched outside its class's subtree, and a tab control showing two pages has no page", () => {
  const match = matchTree(nodes([
    ["frmMain", null], ["cmdAdd", 0], ["frmCreate", 0], ["tabCharacterTabs", 2], tabItem("Skills", 3), tabItem("Street Gear", 3), ["131074", 4], ["131075", 5],
  ]), index);
  deepStrictEqual([...match.controls].sort(), ["frmCreate.tabCharacterTabs", "frmCreate.tabSkills", "frmCreate.tabStreetGear"]);
  deepStrictEqual(match.unresolved, ["cmdAdd"]);
  equal(match.pages.size, 0);
});

test("only WinForms windows with a name carry control names; other elements are not unresolved and pass their context on", () => {
  const part = (id: string, parent: number, className = ""): readonly [string, number, { className: string }] => [id, parent, { className }];
  const match = matchTree(nodes([
    ["frmMain", null], part("TitleBar", 0), part("Close", 1), ["921320", 0], ["frmCreate", 3], ["527868", 4],
    ["tabCharacterTabs", 5], part("Vertical ScrollBar", 4), part("SmallIncrement", 7), part("1001", 4, "Edit"), part("cmdAdd", 5),
  ]), index);
  deepStrictEqual([...match.controls].sort(), ["frmCreate.tabCharacterTabs"]);
  deepStrictEqual(match.unresolved, []);
});

test("a node outside the bounds of a window above it is not shown, with its subtree; a tab item clips nothing", () => {
  const at = (y: number, height = 10) => ({ bounds: { x: 0, y, width: 10, height } });
  const match = matchTree(nodes([
    ["frmMain", null, at(0, 100)], ["frmCreate", 0, at(0, 100)], ["tabCharacterTabs", 1, at(0, 50)],
    ["", 2, { name: "Skills", controlType: "ControlType.TabItem", className: "", bounds: { x: 0, y: 0, width: 10, height: 2 } }],
    ["panSkills", 3, at(5, 40)], ["cmdAdd", 4, at(50)], ["lblHidden", 4, at(60)], ["lblChild", 6, at(10)], ["lblShown", 4, at(40)],
  ]), index);
  deepStrictEqual([...match.controls].sort(), ["frmCreate.panSkills", "frmCreate.tabCharacterTabs", "frmCreate.tabSkills"]);
  deepStrictEqual(match.unresolved, ["lblShown"]);
  deepStrictEqual([...match.pages], [["frmCreate.tabCharacterTabs", "Skills"]]);
});

test("an element that is not a window and has no rectangle is shown with its parent; a window without area is not", () => {
  const none = { bounds: { x: 0, y: 0, width: 0, height: 0 } };
  const match = matchTree(nodes([
    ["frmMain", null], ["frmCreate", 0], ["tabCharacterTabs", 1], ["", 2, { name: "Skills", controlType: "ControlType.TabItem", className: "", ...none }],
    ["cmdAdd", 3], ["panSkills", 3, none], ["lblInside", 5],
  ]), index);
  deepStrictEqual([...match.controls].sort(), ["frmCreate.cmdAdd", "frmCreate.tabCharacterTabs", "frmCreate.tabSkills"]);
  deepStrictEqual(match.unresolved, []);
  deepStrictEqual([...match.pages], [["frmCreate.tabCharacterTabs", "Skills"]]);
});

test("a shown tab item whose text no single tab page has gives the page without matching a tab page", () => {
  const match = matchTree(nodes([["frmMain", null], ["frmCreate", 0], ["tabCharacterTabs", 1], tabItem("Initiation", 2), ["131074", 3], tabItem("Skills", 2)]), index);
  deepStrictEqual([...match.controls].sort(), ["frmCreate.tabCharacterTabs"]);
  deepStrictEqual([...match.pages], [["frmCreate.tabCharacterTabs", "Initiation"]]);
});

test("a shown tab item without text gives no page, so it can never prove a page change", () => {
  const match = matchTree(nodes([["frmMain", null], ["frmCreate", 0], ["tabCharacterTabs", 1], tabItem("", 2), ["131074", 3]]), index);
  deepStrictEqual([...match.controls].sort(), ["frmCreate.tabCharacterTabs"]);
  equal(match.pages.size, 0);
});

test("the manifest records tuples, observations, proven tab changes and deferrals", () => {
  const root = scratch();
  const run = writeRun(root, "run-1", [streetGear]);
  const result = manifest(plan(["build-a", ["lifestyle", "armor", "armor-again", "skills"]], ["build-b", ["common"]]), run);

  deepStrictEqual(result.tuples.map((tuple) => [tuple.case, tuple.capture, tuple.status, tuple.runId]), [
    ["build-a", "lifestyle", "observed", "run-1"], ["build-a", "armor", "observed", "run-1"], ["build-a", "armor-again", "observed", "run-1"],
    ["build-a", "skills", "not-run", "run-1"], ["build-b", "common", "not-captured", null],
  ]);
  const interaction = (id: string) => result.interactions.find((item) => item.id === id)!;
  deepStrictEqual(interaction("frmCreate.tabStreetGearTabs.SelectedIndexChanged"), {
    id: "frmCreate.tabStreetGearTabs.SelectedIndexChanged", class: "frmCreate", target: "tabStreetGearTabs", event: "SelectedIndexChanged",
    handler: "tabStreetGearTabs_SelectedIndexChanged", handlerFile: "Chummer/frmCreate.cs", handlerLine: 11, status: "exercised",
    proofs: [{ case: "build-a", from: "lifestyle", to: "armor", fromPage: "Lifestyle", toPage: "Armor" }],
  });
  equal(interaction("frmCreate.tabCharacterTabs.SelectedIndexChanged").status, "unexercised");
  equal(interaction("frmCreate.cmdAdd.Click").status, "unexercised");
  deepStrictEqual(interaction("frmCreate.(self).Load"), { ...interaction("frmCreate.(self).Load"), status: "deferred", reason: "lifecycle" });
  deepStrictEqual(interaction("frmSelectGear.cmdOK.Click"), { ...interaction("frmSelectGear.cmdOK.Click"), status: "deferred", reason: "opened by a button" });

  const control = (id: string) => result.controls.find((item) => item.id === id)!;
  deepStrictEqual(control("frmCreate.tabArmor"), {
    id: "frmCreate.tabArmor", class: "frmCreate", name: "tabArmor", type: "System.Windows.Forms.TabPage", status: "observed",
    seenIn: [{ case: "build-a", capture: "armor" }, { case: "build-a", capture: "armor-again" }],
  });
  equal(control("frmCreate.cmdAdd").status, "unobserved");
  equal(control("frmMain.mnuFile").status, "windowless");
  equal(control("frmSelectGear.cmdOK").status, "deferred");
  deepStrictEqual(result.totals, {
    classes: 4, activeClasses: 3,
    controls: { active: 10, observed: 5, windowless: 1, deferred: 1 },
    interactions: { active: 4, exercised: 1, deferred: 3 },
    tuples: { planned: 5, observed: 3, failed: 0, filtered: 0, missing: 0, "not-run": 1, "optional-absent": 0, "skipped-optional": 0, "not-captured": 1 },
    unresolved: 0,
  });
  deepStrictEqual(result.classes.find((item) => item.name === "frmCreate"), {
    name: "frmCreate", scope: "active", reason: "build form", controls: 8, observedControls: 5, windowlessControls: 0, interactions: 4, exercisedInteractions: 1, deferredInteractions: 1,
  });
});

test("a page change without a selectTab between the captures, or a tab control missing from one tree, proves nothing", () => {
  const root = scratch();
  const run = writeRun(root, "run-1", [{
    case: "build-a",
    actions: [
      { action: "capture:lifestyle", outcome: "performed" },
      { action: "wait:5", outcome: "performed" },
      { action: "capture:armor", outcome: "performed" },
      { action: "selectTab:Skills", outcome: "performed" },
      { action: "capture:skills", outcome: "performed" },
      { action: "selectTab:Street Gear", outcome: "performed" },
      { action: "capture:gear", outcome: "performed" },
    ],
    captures: [
      { capture: "lifestyle", outcome: "performed", tree: formTree("Street Gear", "Lifestyle") },
      { capture: "armor", outcome: "performed", tree: formTree("Street Gear", "Armor") },
      { capture: "skills", outcome: "performed", tree: formTree("Skills", null) },
      { capture: "gear", outcome: "performed", tree: formTree("Street Gear", "Lifestyle") },
    ],
  }]);
  const result = manifest(plan(["build-a", ["lifestyle", "armor", "skills", "gear"]]), run);
  const exercised = result.interactions.filter((item) => item.status === "exercised");
  deepStrictEqual(exercised.map((item) => item.status === "exercised" ? [item.id, item.proofs.map((proof) => ("from" in proof ? `${proof.from}>${proof.to}` : proof.action))] : []), [
    ["frmCreate.tabCharacterTabs.SelectedIndexChanged", ["armor>skills", "skills>gear"]],
  ]);
});

/** The inventory with a name box and a gear list on the character form, and the dialog active. */
const richInventory = {
  ...inventory,
  classes: inventory.classes.map((item) => item.name !== "frmCreate" ? item : {
    ...item,
    controls: [...item.controls, { name: "txtName", type: "System.Windows.Forms.TextBox", parent: "tabSkills", line: 1, text: null, tag: null, contextMenu: null }],
    interactions: [...item.interactions, ...["TextChanged", "Leave"].map((event, offset) => ({
      id: `frmCreate.txtName.${event}`, target: "txtName", member: null, event, handlerType: "System.EventHandler",
      handler: `txtName_${event}`, handlerFile: "Chummer/frmCreate.cs", handlerLine: 20 + offset, designerLine: 20 + offset,
    }))],
  }),
};

function richManifest(planned: PlannedCaptures[], run: string): CoverageManifest {
  return CoverageManifestSchema.parse(buildCoverageManifest({ inventory: richInventory, scope, scopePath: scope.path, plan: planned, runs: [readRunObservation(run)] }));
}

test("a performed action on a control the capture before it showed proves the action's events of that control", () => {
  const root = scratch();
  const shown = formTree("Skills", null, [["cmdAdd", 4], ["txtName", 4]]);
  const run = writeRun(root, "run-1", [{
    case: "build-a",
    actions: [
      { action: "capture:skills", outcome: "performed" },
      { action: "waitFor:Name", outcome: "performed" },
      { action: "setValue:txtName=A=B", outcome: "performed" },
      { action: "click:cmdAdd", outcome: "performed" },
      { action: "capture:after", outcome: "performed" },
      { action: "wait:5", outcome: "performed" },
      { action: "click:cmdAdd", outcome: "performed" },
      { action: "selectItem:txtName=x", outcome: "failed" },
    ],
    captures: [{ capture: "skills", outcome: "performed", tree: shown }, { capture: "after", outcome: "performed", tree: shown }],
  }]);
  const result = richManifest(plan(["build-a", ["skills", "after"]]), run);
  const interaction = (id: string) => result.interactions.find((item) => item.id === id)!;

  deepStrictEqual(interaction("frmCreate.txtName.TextChanged"), {
    id: "frmCreate.txtName.TextChanged", class: "frmCreate", target: "txtName", event: "TextChanged", handler: "txtName_TextChanged",
    handlerFile: "Chummer/frmCreate.cs", handlerLine: 20, status: "exercised",
    proofs: [{ case: "build-a", capture: "skills", action: "setValue:txtName=A=B", actionIndex: 2 }],
  });
  equal(interaction("frmCreate.txtName.Leave").status, "unexercised");
  // The first click follows another action, not the capture; the second follows the capture through a wait.
  deepStrictEqual(interaction("frmCreate.cmdAdd.Click"), {
    ...interaction("frmCreate.cmdAdd.Click"), status: "exercised", proofs: [{ case: "build-a", capture: "after", action: "click:cmdAdd", actionIndex: 6 }],
  });
  equal(result.totals.interactions.exercised, 2);
});

test("an action proves nothing for a control the capture before it did not show, or without a capture before it", () => {
  const root = scratch();
  const run = writeRun(root, "run-1", [{
    case: "build-a",
    actions: [
      { action: "setValue:txtName=A", outcome: "performed" },
      { action: "capture:skills", outcome: "performed" },
      { action: "click:cmdAdd", outcome: "performed" },
      { action: "contextMenu:txtName=Copy", outcome: "performed" },
      { action: "capture:again", outcome: "performed" },
      { action: "saveReload", outcome: "performed" },
      { action: "setValue:txtName=B", outcome: "performed" },
    ],
    captures: [
      { capture: "skills", outcome: "performed", tree: formTree("Skills", null, [["txtName", 4]]) },
      { capture: "again", outcome: "performed", tree: formTree("Skills", null, [["txtName", 4]]) },
    ],
  }]);
  const result = richManifest(plan(["build-a", ["skills", "again"]]), run);

  deepStrictEqual(result.interactions.filter((item) => item.status === "exercised").map((item) => item.id), []);
});

test("a control two classes of the capture declare proves nothing, and an acting action between captures leaves no tab proof", () => {
  const root = scratch();
  const twice = {
    ...richInventory,
    classes: richInventory.classes.map((item) => item.name !== "SkillControl" ? item : {
      ...item,
      controls: [...item.controls, { name: "cmdAdd", type: "System.Windows.Forms.Button", parent: "(self)", line: 1, text: null, tag: null, contextMenu: null }],
    }),
  };
  const run = writeRun(root, "run-1", [{
    case: "build-a",
    actions: [
      { action: "capture:skills", outcome: "performed" },
      { action: "click:cmdAdd", outcome: "performed" },
      { action: "selectTab:Street Gear", outcome: "performed" },
      { action: "saveReload", outcome: "performed" },
      { action: "selectTab:Lifestyle", outcome: "performed" },
      { action: "capture:gear", outcome: "performed" },
    ],
    captures: [
      { capture: "skills", outcome: "performed", tree: formTree("Skills", null, [["cmdAdd", 4], ["SkillControl", 4], ["cmdAdd", 7]]) },
      { capture: "gear", outcome: "performed", tree: formTree("Street Gear", "Lifestyle") },
    ],
  }]);
  const result = CoverageManifestSchema.parse(buildCoverageManifest({
    inventory: twice, scope, scopePath: scope.path, plan: plan(["build-a", ["skills", "gear"]]), runs: [readRunObservation(run)],
  }));

  deepStrictEqual(result.interactions.filter((item) => item.status === "exercised").map((item) => item.id), []);
});

test("unresolved automation IDs are listed per capture", () => {
  const root = scratch();
  const run = writeRun(root, "run-1", [{
    case: "build-a", actions: [{ action: "capture:common", outcome: "performed" }],
    captures: [{ capture: "common", outcome: "performed", tree: formTree("Skills", null, [["lblNew", 4], ["lblNew", 4], ["", 4]]) }],
  }]);
  const result = manifest(plan(["build-a", ["common"]]), run);
  deepStrictEqual(result.unresolved, [{ case: "build-a", capture: "common", automationIds: ["lblNew"] }]);
  equal(result.totals.unresolved, 1);
});

test("runs that cannot prove their observations are setup errors", () => {
  const root = scratch();
  const performed = (tree: boolean): CaseSpec => ({
    case: "build-a", actions: [{ action: "capture:common", outcome: "performed" }],
    captures: [{ capture: "common", outcome: "performed", ...(tree ? { tree: formTree("Skills", null) } : {}) }],
  });
  failsWith(() => readRunObservation(writeRun(root, "no-trees", [performed(true)], { uiTrees: false })), /recorded no UI trees: it was made without --ui-tree/);
  failsWith(() => readRunObservation(writeRun(root, "missing", [performed(false)])), /no UI tree for the performed capture build-a\/common/);
  failsWith(() => readRunObservation(writeRun(root, "not-performed", [{
    case: "build-a", actions: [{ action: "capture:common", outcome: "failed" }], captures: [{ capture: "common", outcome: "failed", tree: formTree("Skills", null) }],
  }])), /has a UI tree for build-a\/common, whose capture was failed/);
  const foreign = writeRun(root, "foreign", [performed(true)]);
  writeFileSync(join(foreign, "ui-trees", "build-a", "common.json"), JSON.stringify({ runId: "other", case: "build-a", capture: "common", side: "candidate", nodes: formTree("Skills", null) }));
  failsWith(() => readRunObservation(foreign), /belongs to run other, not foreign/);
  const broken = writeRun(root, "broken", [performed(true)]);
  writeFileSync(join(broken, "ui-trees", "build-a", "common.json"), JSON.stringify({ runId: "broken", case: "build-a", capture: "common", side: "candidate", nodes: nodes([["frmMain", null], ["x", 2], ["y", 0]]) }));
  failsWith(() => readRunObservation(broken), /node 1 has the parent 2/);
  const unreadable = writeRun(root, "unreadable", [performed(true)]);
  rmSync(join(unreadable, "coverage.json"));
  failsWith(() => readRunObservation(unreadable), /coverage\.json cannot be read/);

  const first = writeRun(root, "first", [performed(true)]);
  const second = writeRun(root, "second", [performed(true)]);
  failsWith(() => manifest(plan(["build-a", ["common"]]), first, second), /build-a is in two capture runs/);
  failsWith(() => manifest(plan(["build-b", ["common"]]), first), /holds the case build-a, which no plan holds/);
  failsWith(() => manifest(plan(["build-a", ["common", "skills"]]), first), /does not plan the capture build-a\/skills/);
});
