import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { captureNames, planCases } from "../src/cases/case-plan.js";
import { compiledSourceIdentity, processGit } from "../src/diagnosis/source-snapshot.js";
import { SetupError } from "../src/host/setup-error.js";
import { CoverageManifestSchema } from "../src/inventory/coverage-manifest-document.js";
import { parseInventoryArguments, runInventoryCommand, type InventoryCommandDependencies } from "../src/inventory/inventory-command.js";
import { SourceInventorySchema } from "../src/inventory/source-inventory-document.js";
import { nodes, scratch, writeRun } from "./inventory-fixtures.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = processGit(repositoryRoot);
const source = compiledSourceIdentity(repositoryRoot, git);
const diego = "build-Diego_v_alpha2_by_bessgeor";
const diegoCaptures = captureNames(planCases(join(repositoryRoot, "parity", "cases", "characters.json"), [diego], []).cases[0]!);

async function run(args: string[], overrides: Partial<InventoryCommandDependencies> = {}): Promise<{ status: number; lines: string[] }> {
  const lines: string[] = [];
  const recorded = await source;
  const status = await runInventoryCommand(args, {
    repositoryRoot, git, now: () => new Date("2026-10-03T12:00:00Z"), log: (line) => lines.push(line),
    candidateSource: () => recorded, candidateSha256: async () => "c".repeat(64), ...overrides,
  });
  return { status, lines };
}

test("options are parsed strictly", () => {
  deepStrictEqual(parseInventoryArguments(["--run", "a", "--run", "b", "--out", "o", "--scope", "s", "--case-file", "c"]), { runs: ["a", "b"], caseFile: "c", scope: "s", out: "o" });
  equal(parseInventoryArguments(["--help"]), "help");
  throws(() => parseInventoryArguments(["--runs", "a"]), /Unknown option '--runs'/);
  throws(() => parseInventoryArguments(["--run"]), /needs a value/);
  throws(() => parseInventoryArguments(["--out", "--run"]), /needs a value/);
});

test("without runs the app's inventory is written and nothing is observed", async () => {
  const out = scratch();
  const { status, lines } = await run(["--out", out]);
  equal(status, 0);
  const inventory = SourceInventorySchema.parse(JSON.parse(readFileSync(join(out, "source-inventory.json"), "utf8")));
  const manifest = CoverageManifestSchema.parse(JSON.parse(readFileSync(join(out, "coverage-manifest.json"), "utf8")));
  equal(manifest.sourceSha256, inventory.sourceSha256);
  equal(manifest.scope.path, "parity/inventory/scope.json");
  ok(manifest.tuples.length > 100 && manifest.tuples.every((tuple) => tuple.status === "not-captured"));
  equal(manifest.totals.controls.observed, 0);
  ok(lines[0]!.startsWith(`Inventory: ${inventory.totals.classes} classes (10 active), controls observed 0/`), lines[0]);
});

test("a run's observations count once its candidate is the one built from the recorded source", async () => {
  const root = scratch();
  const folder = writeRun(root, "run-1", [{
    case: diego,
    // A run made with --capture common: every other planned capture of the case is filtered.
    actions: diegoCaptures.map((capture) => ({ action: `capture:${capture}`, outcome: capture === "common" ? "performed" : "filtered" })),
    captures: diegoCaptures.map((capture) => capture === "common"
      ? { capture, outcome: "performed", tree: nodes([["frmMain", null], ["", 0], ["frmCreate", 1], ["tabCharacterTabs", 2], ["tabCommon", 3]]) }
      : { capture, outcome: "filtered" }),
  }]);
  const out = join(root, "inventory");
  equal((await run(["--run", folder, "--out", out])).status, 0);
  const manifest = CoverageManifestSchema.parse(JSON.parse(readFileSync(join(out, "coverage-manifest.json"), "utf8")));
  deepStrictEqual(manifest.tuples.filter((tuple) => tuple.status === "observed").map((tuple) => [tuple.case, tuple.capture]), [[diego, "common"]]);
  equal(manifest.totals.tuples.filtered, diegoCaptures.length - 1);
  deepStrictEqual(manifest.controls.filter((control) => control.status === "observed").map((control) => control.id), ["frmCreate.tabCharacterTabs", "frmCreate.tabCommon"]);

  await rejects(run(["--run", folder, "--out", out], { candidateSha256: async () => "d".repeat(64) }),
    (error: unknown) => error instanceof SetupError && /captured the candidate cccccccccccc, not the one built from the recorded source \(dddddddddddd\)/.test(error.message));
});

test("with runs an unrecorded or changed source is a setup error; without runs no build is needed", async () => {
  const root = scratch();
  const folder = writeRun(root, "run-1", [{
    case: diego, actions: diegoCaptures.map((capture) => ({ action: `capture:${capture}`, outcome: "filtered" })),
    captures: diegoCaptures.map((capture) => ({ capture, outcome: "filtered" })),
  }]);
  await rejects(run(["--run", folder, "--out", scratch()], { candidateSource: () => "unrecorded" }), /no recorded source: only the workflow's build step records it/);
  await rejects(run(["--run", folder, "--out", scratch()], { candidateSource: () => "0".repeat(64) }), /differs from the source the candidate was built from \(recorded 000000000000/);
  equal((await run(["--out", scratch()], { candidateSource: () => "unrecorded", candidateSha256: () => Promise.reject(new Error("not read")) })).status, 0);
});
