import { dirname, join, resolve } from "node:path";
import type { ParityCases } from "../../../contracts/generated/typescript/parity-cases.js";
import { readRegistry, registryPaths, type RegistryPaths } from "../discovery/registry.js";
import { fixtureReference } from "../discovery/scenario-cases.js";
import { SetupError } from "../host/setup-error.js";
import type { Arguments } from "../options/arguments.js";
import type { Environment, Profile } from "../options/profile.js";
import { resolveRunOptions, type RunOptions } from "../options/run-options.js";
import { writeDocument } from "../steps/write-document.js";
import { caseName, readCaseFile } from "./case-plan.js";

/** The suite's file name in a thread's folder. */
export const suiteFileName = "suite-cases.json";

/** The fixture case file, which the suite starts with. */
export function fixtureCaseFile(repositoryRoot: string): string {
  return join(repositoryRoot, "parity", "cases", "characters.json");
}

type Characters = ParityCases["characters"];

/** The characters of a case file with their paths relative to `folder`. */
function moved(characters: Characters, caseFile: string, folder: string): Characters {
  return characters.map((entry) => ({ ...entry, path: fixtureReference(folder, resolve(dirname(caseFile), entry.path)) }));
}

function caseNames(characters: Characters, caseFile: string): string[] {
  return characters.map((entry) => caseName(entry.mode, resolve(dirname(caseFile), entry.path), entry.scenario));
}

/**
 * The suite at `suitePath`: the fixture case file's document with its characters' paths relative to the suite, followed by the
 * registry's case file's characters when the registry exists. A registry out of step with its case file, a case file whose timings
 * differ from the fixture file's, and a case name in both files are setup errors.
 */
export function composeSuite(fixtureFile: string, registry: RegistryPaths, suitePath: string): ParityCases {
  const fixture = readCaseFile(fixtureFile);
  const folder = dirname(suitePath);
  const suite: ParityCases = { ...fixture, characters: moved(fixture.characters, fixtureFile, folder) };
  if (readRegistry(registry) === null) return suite;

  const discovered = readCaseFile(registry.caseFile);
  if (discovered.startupDelaySeconds !== fixture.startupDelaySeconds || discovered.settleMilliseconds !== fixture.settleMilliseconds) {
    throw new SetupError(`${registry.caseFile} has a startup delay of ${discovered.startupDelaySeconds} s and a settle time of ${discovered.settleMilliseconds} ms, `
      + `but ${fixtureFile} has ${fixture.startupDelaySeconds} s and ${fixture.settleMilliseconds} ms: its scenarios would be replayed under timings they were not proven with.`);
  }
  const fixtureNames = new Set(caseNames(fixture.characters, fixtureFile).map((name) => name.toLowerCase()));
  const shared = caseNames(discovered.characters, registry.caseFile).filter((name) => fixtureNames.has(name.toLowerCase()));
  if (shared.length > 0) throw new SetupError(`${fixtureFile} and ${registry.caseFile} both have the case ${shared.join(", ")}.`);
  return { ...suite, characters: [...suite.characters, ...moved(discovered.characters, registry.caseFile, folder)] };
}

/** Composes the suite and writes it at `suitePath`. */
export function writeSuite(fixtureFile: string, registry: RegistryPaths, suitePath: string): void {
  writeDocument(suitePath, composeSuite(fixtureFile, registry, suitePath));
}

/** A new thread's options: without --case-file its case file is the suite, written into the thread's folder. */
export function startOptions(args: Arguments, profile: Profile, env: Environment, repositoryRoot: string, threadFolder: string): RunOptions {
  const suite = join(threadFolder, suiteFileName);
  const options = resolveRunOptions(args, profile, env, repositoryRoot, suite);
  if (options.caseFile === suite) writeSuite(fixtureCaseFile(repositoryRoot), registryPaths(repositoryRoot), suite);
  return options;
}
