import { deepStrictEqual, match, notStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoveryContextHash, sealRankContext, sealScenarioContext, verifyContextFiles } from "../src/discovery/discovery-context.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import type { Plan, PlanAction } from "../src/discovery/job-schemas.js";
import { scenarioActions, validatePlan, type PlanVocabulary } from "../src/discovery/plan-validator.js";
import { rankPrompt, scenarioPrompt } from "../src/discovery/prompts.js";
import { computeTargets } from "../src/discovery/targets.js";
import { validateRank, validateScenario } from "../src/discovery/validation.js";
import { SetupError } from "../src/host/setup-error.js";
import { inventory, manifestWith } from "./discovery-fixtures.js";
import { archivedFix, fixRecord } from "./fix-fixtures.js";

const vocabulary: PlanVocabulary = {
  fixtures: [{ case: "build-Alpha", form: "frmCreate" }, { case: "career-Beta", form: "frmCareer" }],
  tabTexts: { frmCreate: ["Armor", "Street Gear"], frmCareer: ["Calendar"] },
  labels: new Set(["Selected Armor"]),
};

function act(type: PlanAction["type"], fields: Partial<PlanAction> = {}): PlanAction {
  return { type, name: null, label: null, milliseconds: null, optional: null, ...fields };
}

const valid: Plan = {
  case: "build-Alpha", expect: ["lblArmorCost"],
  actions: [act("selectTab", { name: "Street Gear" }), act("selectTab", { name: "Armor" }), act("waitFor", { label: "Selected Armor" }), act("wait", { milliseconds: 500 }), act("capture", { name: "armor" })],
};

test("a plan in the vocabulary is valid and becomes case-file actions", () => {
  deepStrictEqual(validatePlan(valid, vocabulary), []);
  deepStrictEqual(scenarioActions(valid), [
    { type: "selectTab", name: "Street Gear" }, { type: "selectTab", name: "Armor" }, { type: "waitFor", label: "Selected Armor" },
    { type: "wait", milliseconds: 500 }, { type: "capture", name: "armor" },
  ]);
});

test("every vocabulary rule gives its own reason", () => {
  const reasons = (plan: Partial<Plan>) => validatePlan({ ...valid, ...plan }, vocabulary);
  deepStrictEqual(reasons({ case: "build-Gamma" }), ["the case 'build-Gamma' is not a fixture case of the case file"]);
  deepStrictEqual(reasons({ actions: [act("include", { name: "x" }), act("capture", { name: "a" })] }), ["action 1 (include): include is not a plan action; write the actions out"]);
  deepStrictEqual(reasons({ actions: [act("selectTab", { name: "Lifestyles" }), act("capture", { name: "a" })] }), ["action 1 (selectTab): 'Lifestyles' is not a known tab text of frmCreate"]);
  deepStrictEqual(reasons({ case: "career-Beta", actions: [act("selectTab", { name: "Armor" }), act("capture", { name: "a" })] }), ["action 1 (selectTab): 'Armor' is not a known tab text of frmCareer"]);
  deepStrictEqual(reasons({ actions: [act("selectTab", { name: "Armor", optional: true, label: "x" }), act("capture", { name: "a" })] }), [
    "action 1 (selectTab): it takes no label", "action 1 (selectTab): optional is not allowed in a plan",
  ]);
  deepStrictEqual(reasons({ actions: [act("waitFor", { label: "Nowhere" }), act("capture", { name: "a" })] }), ["action 1 (waitFor): 'Nowhere' is not a known label"]);
  deepStrictEqual(reasons({ actions: [act("wait", { milliseconds: 10_001 }), act("wait"), act("capture", { name: "a" })] }), [
    "action 1 (wait): 10001 ms is not a whole number from 0 to 10000", "action 2 (wait): it needs milliseconds",
  ]);
  deepStrictEqual(reasons({ actions: [act("capture", { name: "Bad Name" })] }), ["action 1 (capture): the capture name 'Bad Name' is not lower-case letters, digits and dashes"]);
  deepStrictEqual(reasons({ actions: [act("capture", { name: "a" }), act("capture", { name: "a" })] }), ["capture names used twice: a"]);
  deepStrictEqual(reasons({ actions: [act("selectTab", { name: "Armor" })] }), ["0 captures, expected 1 to 4", "the plan does not end with a capture"]);
  deepStrictEqual(reasons({ actions: ["a", "b", "c", "d", "e"].map((name) => act("capture", { name })) }), ["5 captures, expected 1 to 4"]);
  deepStrictEqual(reasons({ actions: [...Array.from({ length: 24 }, () => act("wait", { milliseconds: 1 })), act("capture", { name: "a" })] }), ["25 actions, at most 24 allowed"]);
});

const targets = computeTargets({ baselineThread: "wf-1", inventory, manifest: manifestWith([]), provedControls: new Set(), provedInteractions: new Set() }).targets;
const armor = targets.find((target) => target.id === "frmCreate/tabStreetGear/tabArmor")!;
const selection = targets.find((target) => target.id === "frmCreate.tabStreetGearTabs#selection")!;
const fixtures = [{ case: "build-Alpha", mode: "build" as const, form: "frmCreate", file: "Alpha.chum", selectedTabs: ["Skills"], captures: ["common", "skills"], copy: { path: "fixtures/Alpha.chum", sha256: "0".repeat(64) } }];
const fixtureRoot = mkdtempSync(join(tmpdir(), "discovery-fixture-"));
writeFileSync(join(fixtureRoot, "Alpha.chum"), "<character><buildmethod>Karma</buildmethod></character>");
const planned: PlannedCase[] = [{
  name: "build-Alpha", characterFile: "Alpha.chum", fixturePath: join(fixtureRoot, "Alpha.chum"), mode: "build", startupDelaySeconds: 3, settleMilliseconds: 300, captureFilter: null,
  actions: [{ type: "capture", name: "common" }, { type: "selectTab", name: "Skills" }, { type: "capture", name: "skills" }],
}];

test("a rank answer must rank every target once with a score, a known case or none, and a reason", () => {
  const rankings = targets.map((target) => ({ targetId: target.id, score: 0.5, feasibility: "uncertain" as const, case: null, reason: "r" }));
  deepStrictEqual(validateRank({ rankings }, { targets, fixtures }), []);
  const broken = [{ ...rankings[0]!, score: 1.5 }, { ...rankings[1]!, case: "build-Gamma", reason: " " }, rankings[1]!, { ...rankings[2]!, targetId: "frmNone/-" }];
  deepStrictEqual(validateRank({ rankings: broken }, { targets, fixtures }), [
    `ranking of ${targets[0]!.id}: score 1.5 is not between 0 and 1`,
    `ranking of ${targets[1]!.id}: 'build-Gamma' is not a fixture case`, `ranking of ${targets[1]!.id}: the reason is empty`,
    `ranking of ${targets[1]!.id}: the target is ranked twice`,
    "ranking of frmNone/-: no such target",
    `targets not ranked: ${targets.slice(2).map((target) => target.id).join(", ")}`,
  ]);
});

test("a scenario answer names a fixture case and expects only the target's controls; an abstention has no plan", () => {
  deepStrictEqual(validateScenario({ outcome: "plan", reason: "r", plan: valid }, { target: armor, fixtures }), []);
  deepStrictEqual(validateScenario({ outcome: "plan", reason: "r", plan: { ...valid, case: "x", expect: ["lblKarma"] } }, { target: armor, fixtures }), [
    "the case 'x' is not a fixture case", "expected controls outside the target frmCreate/tabStreetGear/tabArmor: lblKarma",
  ]);
  deepStrictEqual(validateScenario({ outcome: "plan", reason: "r", plan: { ...valid, expect: ["tabStreetGearTabs", "tabArmor"] } }, { target: selection, fixtures }), []);
  deepStrictEqual(validateScenario({ outcome: "plan", reason: "r", plan: null }, { target: armor, fixtures }), ["outcome plan needs a plan"]);
  deepStrictEqual(validateScenario({ outcome: "abstain", reason: "", plan: valid }, { target: armor, fixtures }), ["the reason is empty", "an abstention has no plan"]);
});

const source = { folder: "../source", identity: "i".repeat(64), commit: "c".repeat(40), candidate: "k".repeat(64) };
const paths = { contextFolder: "C:/scratch/rank", snapshotFolder: "C:/scratch/source", compiledFolders: ["Chummer", "Core"] };

test("the rank context is sealed with its priors, and its hash covers what it holds", async () => {
  const folder = join(mkdtempSync(join(tmpdir(), "discovery-context-")), "rank");
  const archive = mkdtempSync(join(tmpdir(), "discovery-archive-"));
  const record = fixRecord({ files: ["Chummer/frmCreate.cs"] });
  const fixFolder = archivedFix(archive, record);
  const base = { baselineThread: "wf-1", sourceSha256: inventory.sourceSha256, tabTexts: { frmCreate: ["Armor"] }, source, targets, fixtures: planned };
  const prior = { name: "2026-10-01-fix-a", folder: fixFolder, record, score: 3, target: armor.id, reasons: ["changes Chummer/frmCreate.cs"] };
  const { context, hash } = await sealRankContext({ ...base, priors: [prior] }, folder);
  strictEqual(context.priors?.[0]?.artifacts.length, 4);
  deepStrictEqual([context.fixtures[0]!.copy.path, context.fixtures[0]!.actions], ["fixtures/build-Alpha.chum", undefined]);
  strictEqual(existsSync(join(folder, "priors", "2026-10-01-fix-a", "fix.json")), true);
  deepStrictEqual(JSON.parse(readFileSync(join(folder, "context.json"), "utf8")), context);
  strictEqual(hash, discoveryContextHash(context));
  const without = await sealRankContext({ ...base, priors: [] }, folder);
  strictEqual(without.context.priors, undefined);
  strictEqual(existsSync(join(folder, "priors")), false);
  notStrictEqual(without.hash, hash);
  match(rankPrompt(context, paths), /^PROMPT_VERSION=rank-v2\n/);
  match(rankPrompt(context, paths), new RegExp(`in the order of targets\\[\\]: ${targets.length} entries`));
  match(rankPrompt(context, paths), /PRIOR FIXES/);
  strictEqual(rankPrompt(without.context, paths).includes("PRIOR FIXES"), false);
  await rejects(sealRankContext({ ...base, priors: [{ ...prior, folder: join(archive, "missing") }] }, folder), SetupError);
});

test("a scenario context holds its labels file with its hash, and the prompt states the plan rules", async () => {
  const folder = join(mkdtempSync(join(tmpdir(), "discovery-context-")), "scenario-1");
  const rank = { score: 0.8, feasibility: "feasible" as const, case: "build-Alpha", reason: "r" };
  const { context, hash } = await sealScenarioContext({
    baselineThread: "wf-1", sourceSha256: inventory.sourceSha256, tabTexts: { frmCreate: ["Armor"] }, source, target: armor, rank, fixtures: planned, labels: ["Selected Armor", "Cost:"],
  }, folder);
  deepStrictEqual(JSON.parse(readFileSync(join(folder, "labels.json"), "utf8")), ["Selected Armor", "Cost:"]);
  deepStrictEqual([context.labels.path, context.labels.count], ["labels.json", 2]);
  deepStrictEqual([context.fixtures[0]!.copy.path, context.fixtures[0]!.selectedTabs, context.fixtures[0]!.actions?.length], ["fixtures/build-Alpha.chum", ["Skills"], 3]);
  match(readFileSync(join(folder, "fixtures", "build-Alpha.chum"), "utf8"), /Karma/);
  verifyContextFiles(folder, context);
  writeFileSync(join(folder, "fixtures", "build-Alpha.chum"), "<character/>");
  throws(() => verifyContextFiles(folder, context), (error: Error) => error instanceof SetupError && /changed after it was sealed/.test(error.message));
  strictEqual(hash, discoveryContextHash(context));
  const prompt = scenarioPrompt(context, { ...paths, contextFolder: "C:/scratch/scenario-1" });
  match(prompt, /^PROMPT_VERSION=scenario-v1\n/);
  match(prompt, /at most 24 actions/);
});
