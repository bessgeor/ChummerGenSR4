import { deepStrictEqual, throws } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { knownLabels, knownTabTexts, readLanguageStrings } from "../src/discovery/known-texts.js";
import { classFiles, rankPriors, scoreFixForTarget } from "../src/discovery/priors.js";
import { computeTargets, type Target } from "../src/discovery/targets.js";
import { SetupError } from "../src/host/setup-error.js";
import { inventory, languageRoot, manifestWith } from "./discovery-fixtures.js";
import { fixRecord } from "./fix-fixtures.js";

const none = new Set<string>();

function targetsOf(observed: readonly string[], proved: { controls?: readonly string[]; interactions?: readonly string[] } = {}) {
  return computeTargets({
    baselineThread: "wf-1", inventory, manifest: manifestWith(observed),
    provedControls: new Set(proved.controls ?? []), provedInteractions: new Set(proved.interactions ?? []),
  });
}

test("unobserved controls are grouped by class and page chain, and a tab page belongs to its own chain", () => {
  const document = targetsOf(["frmCreate.tabCharacterTabs", "frmCreate.tabSkills", "frmCreate.cmdAdd", "frmCreate.panSkills", "frmCreate.tabStreetGear", "frmCreate.tabStreetGearTabs", "frmCreate.tabLifestyle"]);
  const ids = document.targets.map((target) => target.id);
  deepStrictEqual(ids, [
    "SkillControl/-", "frmCreate.tabCharacterTabs#selection", "frmCreate.tabStreetGearTabs#selection", "frmCreate/-", "frmCreate/tabStreetGear/tabArmor", "frmMain/-",
  ]);
  const armor = document.targets.find((target) => target.id === "frmCreate/tabStreetGear/tabArmor")!;
  deepStrictEqual(armor.controls.map((control) => control.name), ["tabArmor", "lblArmorCost", "lblArmorAvail"]);
  deepStrictEqual(armor.pages, [
    { tabControl: "tabCharacterTabs", page: "tabStreetGear", text: "Street Gear" }, { tabControl: "tabStreetGearTabs", page: "tabArmor", text: "Armor" },
  ]);
  deepStrictEqual([armor.kind, armor.mode, armor.tabControl], ["controls", "build", null]);
  deepStrictEqual(document.targets.find((target) => target.id === "frmCreate/-")!.controls.map((control) => control.name), ["lblKarma"]);
  deepStrictEqual(document.targets.find((target) => target.id === "SkillControl/-")!.mode, null);
});

test("a tab control with an unexercised selection binding is a selection target with its pages", () => {
  const selection = targetsOf([]).targets.find((target) => target.id === "frmCreate.tabStreetGearTabs#selection")!;
  deepStrictEqual(selection.kind, "selection");
  deepStrictEqual(selection.interactions, ["frmCreate.tabStreetGearTabs.SelectedIndexChanged"]);
  deepStrictEqual(selection.tabControl, { name: "tabStreetGearTabs", pages: [{ name: "tabLifestyle", text: "Lifestyle" }, { name: "tabArmor", text: "Armor" }] });
  deepStrictEqual(selection.pages, [{ tabControl: "tabCharacterTabs", page: "tabStreetGear", text: "Street Gear" }]);
});

test("other unexercised bindings are out of reach, deferred classes and events are no targets, and exercised bindings are none", () => {
  const manifest = manifestWith([], [["frmCreate.tabCharacterTabs.SelectedIndexChanged", { case: "build-Alpha", from: "common", to: "skills", fromPage: "Common", toPage: "Skills" }]]);
  const document = computeTargets({ baselineThread: "wf-1", inventory, manifest, provedControls: none, provedInteractions: none });
  deepStrictEqual(document.outOfReach, [{ event: "Click", count: 2 }]);
  deepStrictEqual(document.targets.some((target) => target.class === "frmSelectGear" || target.id === "frmCreate.tabCharacterTabs#selection"), false);
  deepStrictEqual(document.sourceSha256, inventory.sourceSha256);
});

test("what the registry proved for this source is covered, and a target left with nothing is dropped", () => {
  const document = targetsOf(["frmCreate.tabCharacterTabs"], {
    controls: ["frmCreate.lblKarma", "frmCreate.lblArmorCost"], interactions: ["frmCreate.tabStreetGearTabs.SelectedIndexChanged"],
  });
  deepStrictEqual(document.targets.some((target) => target.id === "frmCreate/-" || target.id === "frmCreate.tabStreetGearTabs#selection"), false);
  deepStrictEqual(document.targets.find((target) => target.id === "frmCreate/tabStreetGear/tabArmor")!.controls.map((control) => control.name), ["tabArmor", "lblArmorAvail"]);
  deepStrictEqual(document.coveredByRegistry, { controls: 2, interactions: 1 });
});

test("known tab texts are designer texts, Tab_ strings and the baseline's proven pages of the class; labels add every string", () => {
  const root = languageRoot([["Tab_Initiation", "Initiation"], ["Label_Karma", "Karma &amp; Nuyen"], ["String_BP", "BP"]]);
  const strings = readLanguageStrings(root);
  const manifest = manifestWith([], [["frmCreate.tabCharacterTabs.SelectedIndexChanged", { case: "build-Alpha", from: "common", to: "skills", fromPage: "Common", toPage: "Skills" }]]);
  deepStrictEqual(knownTabTexts("frmCreate", inventory, manifest, strings), ["Armor", "Common", "Initiation", "Lifestyle", "Skills", "Street Gear"]);
  const labels = knownLabels(inventory, manifest, strings);
  deepStrictEqual(["Karma & Nuyen", "BP", "Cost:", "File"].every((label) => labels.includes(label)), true);
  deepStrictEqual(labels.includes("Skills"), true);
  throws(() => knownTabTexts("frmNone", inventory, manifest, strings), SetupError);
});

test("a missing language file or one without strings is a setup error", () => {
  throws(() => readLanguageStrings(mkdtempSync(join(tmpdir(), "discovery-nolang-"))), (error: Error) => error instanceof SetupError && /does not exist/.test(error.message));
  throws(() => readLanguageStrings(languageRoot([])), (error: Error) => error instanceof SetupError && /holds no string/.test(error.message));
});

function traits(target: Target) {
  const item = inventory.classes.find((entry) => entry.name === target.class)!;
  return { target, classFiles: classFiles(item), fixtureCases: ["build-Diego", "build-rigger"] };
}

test("a fix scores 3 for the target class's files, 1 per fixture case of the mode and up to 4 for shared words", () => {
  const armor = targetsOf([]).targets.find((target) => target.id === "frmCreate/tabStreetGear/tabArmor")!;
  const fix = fixRecord({ files: ["Chummer\\frmCreate.Designer.cs"], members: [{ case: "build-Diego", capture: "street-gear-armor", ocr: "Armor Cost: 500" }] });
  const scored = scoreFixForTarget(traits(armor), fix);
  deepStrictEqual(scored.reasons[0], "changes Chummer\\frmCreate.Designer.cs");
  deepStrictEqual(scored.reasons[1], "case build-Diego");
  deepStrictEqual(/^words armor, cost \(Jaccard 0\.\d\d\)$/.test(scored.reasons[2]!), true);
  deepStrictEqual(scored.score > 4 && scored.score < 8, true);
  deepStrictEqual(scoreFixForTarget(traits(armor), fixRecord({ files: ["Chummer/frmMain.cs"], members: [{ case: "career-X", capture: "common", ocr: null }] })), { score: 0, reasons: [] });
});

test("priors are the best three fixes, each by the target it relates to most", () => {
  const targets = targetsOf([]).targets.map(traits);
  const fix = (name: string, files: string[], ocr: string | null) => ({ name, folder: join("archive", name), record: fixRecord({ files, members: [{ case: "career-X", capture: "common", ocr }] }) });
  const ranked = rankPriors(targets, [
    fix("2026-10-01-fix-a", ["Chummer/frmMain.cs"], null), fix("2026-10-01-fix-b", ["Chummer/frmCreate.cs"], null),
    fix("2026-10-01-fix-c", ["Chummer/frmCreate.cs"], "Armor"), fix("2026-10-01-fix-d", ["Chummer/SkillControl.cs"], null), fix("2026-10-01-fix-e", ["Chummer/frmCreate.cs"], null),
  ]);
  deepStrictEqual(ranked.map((item) => [item.name, item.target]), [
    ["2026-10-01-fix-c", "frmCreate.tabStreetGearTabs#selection"], ["2026-10-01-fix-a", "frmMain/-"], ["2026-10-01-fix-b", "frmCreate.tabCharacterTabs#selection"],
  ]);
});
