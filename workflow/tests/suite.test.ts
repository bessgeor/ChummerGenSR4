import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ParityCases } from "../../contracts/generated/typescript/parity-cases.js";
import { planCases } from "../src/cases/case-plan.js";
import { composeSuite, fixtureCaseFile, startOptions, suiteFileName } from "../src/cases/suite.js";
import type { RegistryEntry } from "../src/discovery/registry-document.js";
import { emptyRegistry, registryPaths, writeRegistry } from "../src/discovery/registry.js";
import { actionsSha256 } from "../src/discovery/scenario-cases.js";
import { SetupError } from "../src/host/setup-error.js";
import { parseArguments, type Arguments } from "../src/options/arguments.js";

const fixtureCases: ParityCases = {
  startupDelaySeconds: 3, settleMilliseconds: 300,
  sequences: { tabs: [{ type: "selectTab", name: "Skills" }, { type: "capture", name: "skills" }] },
  buildActions: [{ type: "capture", name: "common" }, { type: "include", name: "tabs" }],
  careerActions: [{ type: "capture", name: "common" }],
  characters: [{ path: "../fixtures/characters/Alpha.chum", mode: "build" }, { path: "../fixtures/characters/Beta.chum", mode: "career" }],
};

/** A repository with the fixture case file and its two fixtures. */
function repository(cases: ParityCases = fixtureCases): string {
  const root = mkdtempSync(join(tmpdir(), "workflow-suite-"));
  mkdirSync(join(root, "parity", "fixtures", "characters"), { recursive: true });
  for (const name of ["Alpha.chum", "Beta.chum"]) writeFileSync(join(root, "parity", "fixtures", "characters", name), name);
  mkdirSync(join(root, "parity", "cases"), { recursive: true });
  writeFileSync(fixtureCaseFile(root), JSON.stringify(cases, null, 2));
  return root;
}

const actions = [{ type: "selectTab" as const, name: "Armor" }, { type: "capture" as const, name: "armor" }];

function entry(scenario: string): RegistryEntry {
  return {
    case: `build-Alpha@${scenario}`, fixtureCase: "build-Alpha", mode: "build", scenario, fixture: "../fixtures/characters/Alpha.chum", actions,
    actionsSha256: actionsSha256("build-Alpha", actions), target: "frmCreate/tabStreetGear/tabArmor", sourceSha256: "a".repeat(64),
    proofs: { controls: ["frmCreate.lblArmorCost"], interactions: [] }, visual: { outcome: "clear", differing: [] },
    provenance: { thread: "disc-1", runId: "20261003T120000Z-0000aaaa", records: ["disc-1/scenario/1"] }, admittedUtc: "2026-10-03T12:00:00.000Z",
  };
}

function admitScenarios(root: string, scenarios: readonly string[], timings = { startupDelaySeconds: 3, settleMilliseconds: 300 }): void {
  writeRegistry(registryPaths(root), { ...emptyRegistry(timings), entries: scenarios.map(entry) });
}

const suitePath = (root: string) => join(root, "out", "workflow", "threads", "wf-1", suiteFileName);
const compose = (root: string) => composeSuite(fixtureCaseFile(root), registryPaths(root), suitePath(root));

function writeComposed(root: string): string {
  const path = suitePath(root);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(compose(root)));
  return path;
}

function start(args: string[]): Arguments {
  const command = parseArguments(args);
  if (command.kind !== "start") throw new Error(`expected start, got ${command.kind}`);
  return command.arguments;
}

test("without a registry the suite is the fixture case file with its paths relative to the suite, and plans the same cases", () => {
  const root = repository();
  const suite = compose(root);
  deepStrictEqual(suite, {
    ...fixtureCases,
    characters: [{ path: "../../../../parity/fixtures/characters/Alpha.chum", mode: "build" }, { path: "../../../../parity/fixtures/characters/Beta.chum", mode: "career" }],
  });
  deepStrictEqual(planCases(writeComposed(root), [], []), planCases(fixtureCaseFile(root), [], []));
});

test("with a registry the suite holds the fixture cases followed by the discovered scenarios", () => {
  const root = repository();
  admitScenarios(root, ["armor", "lifestyle"]);
  const plan = planCases(writeComposed(root), [], []).cases;
  deepStrictEqual(plan.map((item) => item.name), ["build-Alpha", "career-Beta", "build-Alpha@armor", "build-Alpha@lifestyle"]);
  deepStrictEqual(plan.slice(0, 2), planCases(fixtureCaseFile(root), [], []).cases);
  for (const item of plan.slice(2)) {
    deepStrictEqual([item.fixturePath, item.actions, item.startupDelaySeconds, item.settleMilliseconds],
      [join(root, "parity", "fixtures", "characters", "Alpha.chum"), actions, 3, 300]);
  }
});

test("a discovered case file with other timings than the fixture case file is a setup error", () => {
  const root = repository();
  admitScenarios(root, ["armor"], { startupDelaySeconds: 3, settleMilliseconds: 200 });
  throws(() => compose(root), (error: Error) => error instanceof SetupError && error.message.includes(registryPaths(root).caseFile) && /timings/.test(error.message));
});

test("a case name in both the fixture case file and the discovered case file is a setup error", () => {
  const root = repository({
    ...fixtureCases,
    characters: [...fixtureCases.characters, { path: "../fixtures/characters/Alpha.chum", mode: "build", scenario: "armor", actions }],
  });
  admitScenarios(root, ["armor"]);
  throws(() => compose(root), (error: Error) => error instanceof SetupError && /both have the case build-Alpha@armor/.test(error.message));
});

test("a discovered case file that is not its registry's rendering, or one without the other, is a setup error naming it", () => {
  const root = repository();
  admitScenarios(root, ["armor"]);
  const paths = registryPaths(root);
  const edited = JSON.parse(readFileSync(paths.caseFile, "utf8")) as ParityCases;
  edited.characters[0]!.scenario = "edited";
  writeFileSync(paths.caseFile, JSON.stringify(edited, null, 2));
  throws(() => compose(root), (error: Error) => error instanceof SetupError && error.message.startsWith(`${paths.caseFile} differs from the rendering`));

  rmSync(paths.registry);
  throws(() => compose(root), (error: Error) => error instanceof SetupError && error.message.startsWith(`${paths.registry} is missing`));
  admitScenarios(root, ["armor"]);
  rmSync(paths.caseFile);
  throws(() => compose(root), (error: Error) => error instanceof SetupError && error.message.startsWith(`${paths.caseFile} is missing`));
});

test("a new thread without --case-file writes its suite and uses it; with --case-file it uses that file and writes none", () => {
  const root = repository();
  admitScenarios(root, ["armor"]);
  const threadFolder = join(root, "out", "workflow", "threads", "wf-1");
  const options = startOptions(start([]), {}, { LOCALAPPDATA: root }, root, threadFolder);
  equal(options.caseFile, join(threadFolder, suiteFileName));
  deepStrictEqual(JSON.parse(readFileSync(options.caseFile, "utf8")), compose(root));

  const other = join(root, "out", "workflow", "threads", "wf-2");
  const given = startOptions(start(["--case-file", "parity/cases/characters.json"]), {}, { LOCALAPPDATA: root }, root, other);
  equal(given.caseFile, fixtureCaseFile(root));
  ok(!existsSync(other));

  writeFileSync(registryPaths(root).caseFile, "{}");
  const broken = join(root, "out", "workflow", "threads", "wf-3");
  throws(() => startOptions(start([]), {}, { LOCALAPPDATA: root }, root, broken), SetupError);
  ok(!existsSync(join(broken, suiteFileName)));
});
