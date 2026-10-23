import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { attribute, BaselineIndex, blocks, readResults, type RunRow } from "../src/widening/attribution.js";
import { levelSelection, nextLevel } from "../src/widening/ladder.js";
import { differingShare, readPng } from "../src/widening/png-pixels.js";
import { plannedCase, scratch } from "./diagnosis-fixtures.js";
import { encodePng, solidPng, writeRun } from "./widening-fixtures.js";

function suite() {
  const root = scratch("workflow-widening-");
  return [plannedCase(root, "alpha"), plannedCase(root, "beta", "career"), plannedCase(root, "gamma"), plannedCase(root, "delta", "career")];
}

test("the levels widen a build cluster from its captures to its case, the other build cases and the rest", () => {
  const all = suite();
  const scope = { cases: ["build-alpha"], captures: ["skills"] };
  deepStrictEqual(levelSelection("narrow", all, scope), { cases: ["build-alpha"], captures: ["skills"] });
  deepStrictEqual(levelSelection("character", all, scope), { cases: ["build-alpha"], captures: null });
  deepStrictEqual(levelSelection("mode", all, scope), { cases: ["build-gamma"], captures: null });
  deepStrictEqual(levelSelection("suite", all, scope), { cases: ["career-beta", "career-delta"], captures: null });
  deepStrictEqual([nextLevel(null), nextLevel("narrow"), nextLevel("mode"), nextLevel("suite")], ["narrow", "character", "suite", null]);
});

test("a cluster over both modes leaves the suite level empty, and an unknown case is a setup error", () => {
  const all = suite();
  const scope = { cases: ["build-alpha", "career-beta"], captures: ["common", "skills"] };
  deepStrictEqual(levelSelection("narrow", all, scope), { cases: ["build-alpha", "career-beta"], captures: ["common", "skills"] });
  deepStrictEqual(levelSelection("mode", all, scope), { cases: ["build-gamma", "career-delta"], captures: null });
  deepStrictEqual(levelSelection("suite", all, scope), { cases: [], captures: null });
  throws(() => levelSelection("narrow", all, { cases: ["build-omega"], captures: ["common"] }), (error) => error instanceof SetupError && /build-omega/.test(error.message));
});

test("PNG files of every supported colour type and every row filter decode to the same RGBA pixels", () => {
  const folder = scratch("workflow-png-");
  const width = 7;
  const height = 6;
  const grey = Array.from({ length: width * height }, (_value, index) => (index * 37) % 256);
  const files: [string, Buffer][] = [
    ["grey.png", encodePng(width, height, 1, grey)],
    ["grey-alpha.png", encodePng(width, height, 2, grey.flatMap((value) => [value, 255]))],
    ["rgb.png", encodePng(width, height, 3, grey.flatMap((value) => [value, value, value]))],
    ["rgba.png", encodePng(width, height, 4, grey.flatMap((value) => [value, value, value, 255]))],
  ];
  const decoded = files.map(([name, bytes]) => {
    writeFileSync(join(folder, name), bytes);
    return readPng(join(folder, name));
  });
  for (const pixels of decoded) {
    equal(pixels.width, width);
    equal(pixels.height, height);
    deepStrictEqual([...pixels.rgba.subarray(0, 8)], [0, 0, 0, 255, 37, 37, 37, 255]);
    equal(differingShare(decoded[0]!, pixels), 0);
  }
});

test("other PNG formats and files that are no PNG are setup errors", () => {
  const folder = scratch("workflow-png-");
  writeFileSync(join(folder, "deep.png"), encodePng(2, 2, 1, [0, 1, 2, 3], { depth: 16 }));
  writeFileSync(join(folder, "interlaced.png"), encodePng(2, 2, 1, [0, 1, 2, 3], { interlace: 1 }));
  writeFileSync(join(folder, "text.png"), "not a png");
  for (const name of ["deep.png", "interlaced.png", "text.png"]) throws(() => readPng(join(folder, name)), SetupError, name);
});

test("the differing share counts changed pixels, and different sizes differ entirely", () => {
  const folder = scratch("workflow-png-");
  writeFileSync(join(folder, "a.png"), solidPng(10, 10));
  writeFileSync(join(folder, "b.png"), solidPng(10, 10, [3, 50]));
  writeFileSync(join(folder, "c.png"), solidPng(10, 5));
  const [a, b, c] = ["a", "b", "c"].map((name) => readPng(join(folder, `${name}.png`)));
  equal(differingShare(a!, b!), 0.02);
  equal(differingShare(a!, c!), 1);
});

test("each failing row is attributed against the newest baseline row of the accepted source", () => {
  const root = scratch("workflow-attribution-");
  const older = writeRun(join(root, "older"), [{ case: "build-alpha", capture: "armor", passed: true }]);
  const baseline = writeRun(join(root, "baseline"), [
    { case: "build-alpha", capture: "common", passed: true },
    { case: "build-alpha", capture: "armor", passed: false, candidate: [5] },
    { case: "build-gamma", capture: "common", passed: false, candidate: [5] },
    { case: "build-gamma", capture: "skills", passed: false, candidate: null },
    { case: "build-gamma", capture: "armor", passed: false, candidate: null },
  ]);
  const level = writeRun(join(root, "level"), [
    { case: "build-alpha", capture: "skills", passed: false },
    { case: "build-alpha", capture: "common", passed: false },
    { case: "build-alpha", capture: "armor", passed: false, candidate: [5] },
    { case: "build-gamma", capture: "common", passed: false, candidate: [5, 6, 7, 8, 9, 10, 11] },
    { case: "build-gamma", capture: "skills", passed: false, candidate: null },
    { case: "build-gamma", capture: "armor", passed: false, candidate: [] },
    { case: "build-gamma", capture: "notes", passed: false },
  ], 0.05);
  const index = new BaselineIndex([older, baseline]);
  const targets = new Set(["build-alpha/skills"]);
  const rows: RunRow[] = readResults(level).results.map((row) => ({ runFolder: level, row }));
  const findings = rows.map((found) => attribute(found, targets, index.find(found.row.case, found.row.capture), 0.05));
  deepStrictEqual(findings.map((finding) => `${finding.case}/${finding.capture} ${finding.attribution}`), [
    "build-alpha/skills target", "build-alpha/common introduced", "build-alpha/armor pre-existing", "build-gamma/common changed",
    "build-gamma/skills pre-existing", "build-gamma/armor changed", "build-gamma/notes unattributed",
  ]);
  equal(findings[2]!.baselineRun, baseline);
  equal(findings[6]!.baselineRun, null);
  deepStrictEqual(findings.map(blocks), [true, true, false, true, false, true, true]);
});

test("a change within the threshold is pre-existing, one beyond it changed", () => {
  const root = scratch("workflow-attribution-");
  const baseline = writeRun(join(root, "baseline"), [{ case: "build-alpha", capture: "common", passed: false, candidate: [1] }]);
  const level = writeRun(join(root, "level"), [{ case: "build-alpha", capture: "common", passed: false, candidate: [1, 2, 3] }]);
  const found: RunRow = { runFolder: level, row: readResults(level).results[0]! };
  const row = new BaselineIndex([baseline]).find("build-alpha", "common");
  equal(attribute(found, new Set(), row, 0.02).attribution, "pre-existing");
  equal(attribute(found, new Set(), row, 0.01).attribution, "changed");
});
