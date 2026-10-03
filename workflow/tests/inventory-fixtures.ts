import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaptureSummary } from "../../contracts/generated/typescript/parity-capture-summary.js";
import type { ExecutionCoverage, Outcome } from "../../contracts/generated/typescript/parity-execution-coverage.js";
import type { UiNode, UiTree } from "../../contracts/generated/typescript/parity-ui-tree.js";
import type { Scope } from "../src/inventory/scope.js";
import type { InventoryClass, InventoryControl, SourceInventory } from "../src/inventory/source-inventory-document.js";

const examples = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "contracts", "examples");

function control(name: string, type: string, parent: string | null, text: string | null = null): InventoryControl {
  return { name, type, parent, line: 1, text, tag: null, contextMenu: null };
}

function inventoryClass(name: string, controls: InventoryControl[], bindings: [string | null, string][]): InventoryClass {
  return {
    name, namespace: "Chummer", baseType: name.endsWith("Control") ? "UserControl" : "Form", designerFile: `Chummer/${name}.Designer.cs`,
    codeFile: `Chummer/${name}.cs`, instanceName: name, controls,
    interactions: bindings.map(([target, event], index) => ({
      id: `${name}.${target ?? "(self)"}.${event}`, target, member: null, event, handlerType: "System.EventHandler",
      handler: `${target ?? name}_${event}`, handlerFile: `Chummer/${name}.cs`, handlerLine: index + 10, designerLine: index + 1,
    })),
  };
}

/** A main window, a character form with nested tab controls and a skill row, a skill row control and a deferred dialog. */
export const inventory: SourceInventory = {
  schemaVersion: 1,
  sourceSha256: "a".repeat(64),
  classes: [
    inventoryClass("SkillControl", [control("cmdImprove", "System.Windows.Forms.Button", "(self)")], [["cmdImprove", "Click"]]),
    inventoryClass("frmCreate", [
      control("tabCharacterTabs", "System.Windows.Forms.TabControl", "(self)"),
      control("tabSkills", "System.Windows.Forms.TabPage", "tabCharacterTabs", "Skills"),
      control("tabStreetGear", "System.Windows.Forms.TabPage", "tabCharacterTabs", "Street Gear"),
      control("tabStreetGearTabs", "System.Windows.Forms.TabControl", "tabStreetGear"),
      control("tabLifestyle", "System.Windows.Forms.TabPage", "tabStreetGearTabs", "Lifestyle"),
      control("tabArmor", "System.Windows.Forms.TabPage", "tabStreetGearTabs", "Armor"),
      control("cmdAdd", "System.Windows.Forms.Button", "tabSkills"),
      control("panSkills", "System.Windows.Forms.Panel", "tabSkills"),
    ], [["tabCharacterTabs", "SelectedIndexChanged"], ["tabStreetGearTabs", "SelectedIndexChanged"], ["cmdAdd", "Click"], [null, "Load"]]),
    inventoryClass("frmMain", [
      control("menuStrip", "System.Windows.Forms.MenuStrip", "(self)"),
      control("mnuFile", "System.Windows.Forms.ToolStripMenuItem", "menuStrip", "File"),
    ], [[null, "MdiChildActivate"]]),
    inventoryClass("frmSelectGear", [control("cmdOK", "System.Windows.Forms.Button", "(self)")], [["cmdOK", "Click"]]),
  ],
  totals: { classes: 4, controls: 12, interactions: 7 },
};

export const scope: Scope = {
  path: "parity/inventory/scope.json",
  sha256: "b".repeat(64),
  classes: {
    SkillControl: { scope: "active", reason: "skill rows" },
    frmCreate: { scope: "active", reason: "build form" },
    frmMain: { scope: "active", reason: "main window" },
    frmSelectGear: { scope: "deferred", reason: "opened by a button" },
  },
  deferredEvents: { Load: "lifecycle", MdiChildActivate: "lifecycle" },
};

/** A tree node: `[automationId, parent]`, a WinForms window unless the overrides say otherwise. */
export type NodeSpec = readonly [string, number | null, Partial<UiNode>?];

export function nodes(specs: readonly NodeSpec[]): UiNode[] {
  return specs.map(([automationId, parent, overrides]) => ({
    parent, automationId, name: automationId, controlType: "ControlType.Pane", className: "WindowsForms10.Window.8.app.0.1", enabled: true,
    bounds: { x: 0, y: 0, width: 10, height: 10 }, ...overrides,
  }));
}

/** A tab control's tab item: no automation ID, named by its tab text, not a window. */
export function tabItem(text: string, parent: number): NodeSpec {
  return ["", parent, { name: text, controlType: "ControlType.TabItem", className: "" }];
}

/**
 * The character form inside the main window's MDI client (a window without a name, so a numeric automation ID). Node 4
 * is the shown tab item of the character tabs, holding the street gear tabs with their shown item and content (nodes 5
 * to 7) or a content pane (node 5); `extra` follows, then an item of a page that is not shown.
 */
export function formTree(characterPage: string, streetGearPage: string | null, extra: readonly NodeSpec[] = []): UiNode[] {
  const specs: NodeSpec[] = [["frmMain", null], ["65538", 0], ["frmCreate", 1], ["tabCharacterTabs", 2], tabItem(characterPage, 3)];
  if (streetGearPage !== null) specs.push(["tabStreetGearTabs", 4], tabItem(streetGearPage, 5), ["131074", 6]);
  else specs.push(["131074", 4]);
  return nodes([...specs, ...extra, tabItem("Improvements", 3)]);
}

export type CaptureSpec = { readonly capture: string; readonly outcome: Outcome; readonly tree?: UiNode[] };
export type ActionSpec = { readonly action: string; readonly outcome: Outcome };
export type CaseSpec = { readonly case: string; readonly actions: readonly ActionSpec[]; readonly captures: readonly CaptureSpec[] };

const example = <T>(name: string): T => JSON.parse(readFileSync(join(examples, name), "utf8")) as T;

/** Writes a capture run folder with a summary, coverage and the given cases' trees; `uiTrees: false` writes a run made without trees. */
export function writeRun(root: string, runId: string, cases: readonly CaseSpec[], options: { uiTrees?: boolean } = {}): string {
  const folder = join(root, runId);
  mkdirSync(folder, { recursive: true });
  const summary = example<CaptureSummary>("parity-capture-summary.example.json");
  const baseCase = summary.cases[0]!;
  summary.runId = runId;
  summary.candidate.sha256 = "c".repeat(64);
  summary.cases = cases.map((item) => ({
    ...baseCase, case: item.case,
    sides: baseCase.sides.map((side) => ({
      ...side, actions: item.actions.map((action, index) => ({ index, action: action.action, optional: false, outcome: action.outcome === "missing" ? "not-run" : action.outcome })),
    })),
  }));
  if (options.uiTrees === false) delete summary.uiTrees;
  else summary.uiTrees = "ui-trees";
  writeFileSync(join(folder, "summary.json"), JSON.stringify(summary));
  const coverage = example<ExecutionCoverage>("parity-execution-coverage.example.json");
  const baseCoverage = coverage.cases[0]!;
  coverage.runId = runId;
  coverage.cases = cases.map((item) => ({
    ...baseCoverage, case: item.case, plannedCaptures: item.captures.map((capture) => capture.capture),
    sides: baseCoverage.sides.map((side) => ({
      ...side, captures: item.captures.map((capture) => ({ capture: capture.capture, outcome: capture.outcome, file: capture.outcome === "performed" })),
    })),
  }));
  writeFileSync(join(folder, "coverage.json"), JSON.stringify(coverage));
  for (const item of cases) {
    for (const capture of item.captures) {
      if (capture.tree === undefined) continue;
      const tree: UiTree = { runId, case: item.case, capture: capture.capture, side: "candidate", nodes: capture.tree };
      mkdirSync(join(folder, "ui-trees", item.case), { recursive: true });
      writeFileSync(join(folder, "ui-trees", item.case, `${capture.capture}.json`), JSON.stringify(tree));
    }
  }
  return folder;
}

export function scratch(): string {
  return mkdtempSync(join(tmpdir(), "inventory-runs-"));
}
