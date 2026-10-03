import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { z } from "zod";
import { ParityCasesSchema, type CaseAction, type ParityCases } from "../../../contracts/generated/typescript/parity-cases.js";
import { SetupError } from "../host/setup-error.js";

/** One case the workflow captures, with everything about it that decides its captures. */
export type PlannedCase = {
  readonly name: string;
  readonly characterFile: string;
  readonly fixturePath: string;
  readonly mode: "build" | "career";
  /** The expanded actions in order, without `include` entries. */
  readonly actions: readonly CaseAction[];
  readonly startupDelaySeconds: number;
  readonly settleMilliseconds: number;
  /** The capture names passed to the capture runner, or null for all of them. */
  readonly captureFilter: readonly string[] | null;
};

export type CasePlan = {
  readonly cases: readonly PlannedCase[];
  /** Cases left out because none of the requested capture names belongs to them. */
  readonly excluded: readonly string[];
};

/** A character entry's scenario name, which its case name carries after `@`. */
export const scenarioPattern = /^[a-z0-9][a-z0-9-]*$/;

export function readCaseFile(caseFile: string): ParityCases {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(caseFile, "utf8"));
  } catch (error) {
    throw new SetupError(`The case file ${caseFile} cannot be read: ${(error as Error).message}`);
  }
  const parsed = ParityCasesSchema.safeParse(document);
  if (!parsed.success) {
    throw new SetupError(`The case file ${caseFile} is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function expand(actions: readonly CaseAction[], document: ParityCases, stack: readonly string[]): CaseAction[] {
  const expanded: CaseAction[] = [];
  for (const action of actions) {
    if (action.type !== "include") {
      expanded.push(action);
      continue;
    }
    const name = action.name ?? "";
    const sequence = document.sequences[name];
    if (sequence === undefined || stack.includes(name)) {
      throw new SetupError(`The case file includes the ${sequence === undefined ? "unknown" : "recursive"} sequence '${name}'.`);
    }
    expanded.push(...expand(sequence, document, [...stack, name]));
  }
  return expanded;
}

function matches(item: { name: string; characterFile: string }, filter: string): boolean {
  const lower = filter.toLowerCase();
  return item.name.toLowerCase() === lower
    || item.characterFile.toLowerCase() === lower
    || basename(item.characterFile, extname(item.characterFile)).toLowerCase() === lower;
}

/** The capture names of a case, in action order. */
export function captureNames(item: Pick<PlannedCase, "actions">): string[] {
  return item.actions.filter((action) => action.type === "capture").map((action) => action.name ?? "");
}

/**
 * Loads the case file and selects cases the way the capture runner does: by case name, file name or file name
 * without extension, case-insensitively. With capture names, each case gets the subset it has; a case with
 * none is excluded and a name that no selected case has is a setup error.
 */
export function planCases(caseFile: string, caseFilter: readonly string[], captureFilter: readonly string[]): CasePlan {
  const document = readCaseFile(caseFile);
  const all = document.characters.map((entry, index): PlannedCase => {
    const fixturePath = resolve(dirname(caseFile), entry.path);
    const characterFile = basename(fixturePath);
    if ((entry.scenario === undefined) !== (entry.actions === undefined)) {
      throw new SetupError(`The case file ${caseFile}: characters[${index}] gives 'scenario' and 'actions' together or not at all.`);
    }
    if (entry.scenario !== undefined && !scenarioPattern.test(entry.scenario)) {
      throw new SetupError(`The case file ${caseFile}: characters[${index}] has the scenario '${entry.scenario}', which is not lower-case letters, digits and dashes.`);
    }
    const stem = `${entry.mode}-${basename(fixturePath, extname(fixturePath))}`;
    return {
      name: entry.scenario === undefined ? stem : `${stem}@${entry.scenario}`,
      characterFile,
      fixturePath,
      mode: entry.mode,
      actions: expand(entry.actions ?? (entry.mode === "career" ? document.careerActions : document.buildActions), document, []),
      startupDelaySeconds: document.startupDelaySeconds,
      settleMilliseconds: document.settleMilliseconds,
      captureFilter: null,
    };
  });

  const duplicate = all.find((item, index) => all.findIndex((other) => other.name.toLowerCase() === item.name.toLowerCase()) !== index);
  if (duplicate !== undefined) throw new SetupError(`The case file ${caseFile} has two characters with the case name '${duplicate.name}'.`);
  const unmatched = caseFilter.filter((filter) => !all.some((item) => matches(item, filter)));
  if (unmatched.length > 0) {
    throw new SetupError(`--case matches no case: ${unmatched.join(", ")}.`);
  }
  const selected = caseFilter.length === 0 ? all : all.filter((item) => caseFilter.some((filter) => matches(item, filter)));
  if (captureFilter.length === 0) {
    return { cases: selected, excluded: [] };
  }

  const unknown = captureFilter.filter((name) => !selected.some((item) => captureNames(item).includes(name)));
  if (unknown.length > 0) {
    throw new SetupError(`--capture matches no capture of the selected cases: ${unknown.join(", ")}.`);
  }
  const cases: PlannedCase[] = [];
  const excluded: string[] = [];
  for (const item of selected) {
    const subset = captureNames(item).filter((name) => captureFilter.includes(name));
    if (subset.length === 0) {
      excluded.push(item.name);
    } else {
      cases.push({ ...item, captureFilter: subset });
    }
  }
  return { cases, excluded };
}
