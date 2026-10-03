import { equal, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compiledSourcePaths, processGit } from "../src/diagnosis/source-snapshot.js";
import { SetupError } from "../src/host/setup-error.js";
import { checkScope, deferral, readScope, type ScopeFile } from "../src/inventory/scope.js";
import { buildSourceInventory, designerPaths } from "../src/inventory/source-inventory.js";
import type { InventoryClass, SourceInventory } from "../src/inventory/source-inventory-document.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function inventoryClass(name: string, events: readonly string[]): InventoryClass {
  return {
    name, namespace: "Chummer", baseType: "Form", designerFile: `Chummer/${name}.Designer.cs`, codeFile: `Chummer/${name}.cs`, instanceName: name, controls: [],
    interactions: events.map((event, index) => ({
      id: `${name}.(self).${event}`, target: null, member: null, event, handlerType: "System.EventHandler", handler: `${name}_${event}`,
      handlerFile: `Chummer/${name}.cs`, handlerLine: index + 1, designerLine: index + 1,
    })),
  };
}

const inventory: SourceInventory = {
  schemaVersion: 1, sourceSha256: "0".repeat(64),
  classes: [inventoryClass("frmCreate", ["Load", "Click"]), inventoryClass("frmSelectGear", ["Click"])],
  totals: { classes: 2, controls: 0, interactions: 3 },
};

const scope: ScopeFile = {
  classes: { frmCreate: { scope: "active", reason: "opened by the cases" }, frmSelectGear: { scope: "deferred", reason: "opened by a button" } },
  deferredEvents: { Load: "raised by the form's lifecycle" },
};

function rejects(changed: ScopeFile, pattern: RegExp): void {
  throws(() => checkScope(changed, inventory, "scope.json"), (error: unknown) => error instanceof SetupError && pattern.test(error.message));
}

test("a scope that declares exactly the source's classes passes", () => {
  checkScope(scope, inventory, "scope.json");
});

test("a missing class, an unknown class or an unbound deferred event fails the scope", () => {
  rejects({ ...scope, classes: { frmCreate: scope.classes.frmCreate! } }, /does not declare the classes frmSelectGear/);
  rejects({ ...scope, classes: { ...scope.classes, frmGone: { scope: "deferred", reason: "removed" } } }, /classes the source does not have: frmGone/);
  rejects({ ...scope, deferredEvents: { ...scope.deferredEvents, Paint: "drawing" } }, /defers events no binding uses: Paint/);
});

test("a scope file with an empty reason or an unknown scope is a setup error", () => {
  const folder = mkdtempSync(join(tmpdir(), "inventory-scope-"));
  const write = (document: unknown) => {
    const path = join(folder, "scope.json");
    writeFileSync(path, JSON.stringify(document));
    return path;
  };
  throws(() => readScope(write({ ...scope, classes: { frmCreate: { scope: "active", reason: "  " } } })), /reason must not be empty/);
  throws(() => readScope(write({ ...scope, classes: { frmCreate: { scope: "maybe", reason: "x" } } })), /is invalid/);
  throws(() => readScope(write({ ...scope, deferredEvents: { Load: "" } })), /reason must not be empty/);
  throws(() => readScope(join(folder, "missing.json")), /cannot be read/);
  equal(readScope(write(scope)).classes.frmCreate?.scope, "active");
});

test("bindings of deferred classes and deferred events carry the reason", () => {
  equal(deferral(scope, "frmSelectGear", "Click"), "opened by a button");
  equal(deferral(scope, "frmCreate", "Load"), "raised by the form's lifecycle");
  equal(deferral(scope, "frmCreate", "Click"), null);
  equal(deferral(scope, "frmCreate", null), null);
  throws(() => deferral(scope, "frmOther", null), /does not declare the class frmOther/);
});

test("the committed scope file declares exactly the app's classes", () => {
  const path = join(repositoryRoot, "parity", "inventory", "scope.json");
  checkScope(readScope(path), buildSourceInventory(repositoryRoot, designerPaths(compiledSourcePaths(repositoryRoot, processGit(repositoryRoot)))), path);
});
