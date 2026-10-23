import { deepStrictEqual, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureNames, planCases } from "../src/cases/case-plan.js";
import { SetupError } from "../src/host/setup-error.js";

function caseFile(): string {
  const root = mkdtempSync(join(tmpdir(), "workflow-cases-"));
  mkdirSync(join(root, "fixtures"));
  writeFileSync(join(root, "fixtures", "Alpha.chum"), "");
  writeFileSync(join(root, "fixtures", "Beta career.chum"), "");
  const path = join(root, "cases.json");
  writeFileSync(path, JSON.stringify({
    startupDelaySeconds: 3,
    settleMilliseconds: 300,
    sequences: {
      tabs: [{ type: "selectTab", name: "Skills" }, { type: "capture", name: "skills" }],
      both: [{ type: "include", name: "tabs" }, { type: "capture", name: "gear" }],
    },
    buildActions: [{ type: "capture", name: "common" }, { type: "include", name: "both" }],
    careerActions: [{ type: "capture", name: "common" }, { type: "include", name: "tabs" }],
    characters: [{ path: "fixtures/Alpha.chum", mode: "build" }, { path: "fixtures/Beta career.chum", mode: "career" }],
  }));
  return path;
}

test("cases are named like the capture runner names them and their includes are expanded", () => {
  const plan = planCases(caseFile(), [], []);
  deepStrictEqual(plan.cases.map((item) => item.name), ["build-Alpha", "career-Beta career"]);
  deepStrictEqual(captureNames(plan.cases[0]!), ["common", "skills", "gear"]);
  deepStrictEqual(captureNames(plan.cases[1]!), ["common", "skills"]);
  deepStrictEqual(plan.cases[0]!.actions.some((action) => action.type === "include"), false);
  deepStrictEqual(plan.cases.map((item) => item.captureFilter), [null, null]);
});

test("cases match by name, file name or file name without extension, case-insensitively, in case file order", () => {
  const path = caseFile();
  deepStrictEqual(planCases(path, ["Beta Career.chum", "BUILD-alpha"], []).cases.map((item) => item.name), ["build-Alpha", "career-Beta career"]);
  deepStrictEqual(planCases(path, ["alpha"], []).cases.map((item) => item.name), ["build-Alpha"]);
  throws(() => planCases(path, ["gamma"], []), (error: Error) => error instanceof SetupError && /gamma/.test(error.message));
});

test("each case gets the subset of requested captures it has, and a case with none is excluded", () => {
  const plan = planCases(caseFile(), [], ["gear"]);
  deepStrictEqual(plan.cases.map((item) => [item.name, item.captureFilter]), [["build-Alpha", ["gear"]]]);
  deepStrictEqual(plan.excluded, ["career-Beta career"]);
  throws(() => planCases(caseFile(), ["career-Beta career"], ["gear"]), /gear/);
});

test("an unreadable or invalid case file is a setup error", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-cases-"));
  throws(() => planCases(join(root, "missing.json"), [], []), SetupError);
  const path = join(root, "bad.json");
  writeFileSync(path, JSON.stringify({ characters: [] }));
  throws(() => planCases(path, [], []), SetupError);
});
