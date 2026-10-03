import { join, resolve } from "node:path";
import { planCases } from "../cases/case-plan.js";
import type { Git } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { defaultScopeFile, describeInventory, plannedCaptures, writeInventory } from "./inventory-service.js";

export const inventoryUsage = `Usage: npm run inventory -- [options]

  Writes source-inventory.json and coverage-manifest.json: the app's forms, controls and event bindings, their
  scope, and what the given capture runs (made with --ui-tree) showed of them. With runs, their candidate must be the
  one npm start built, which records the source it was built from, and that source must still be the working tree's.

    --run <folder>        a capture run folder; repeat for several (default: none, so nothing is observed)
    --case-file <path>    default: parity/cases/characters.json
    --scope <path>        default: parity/inventory/scope.json
    --out <dir>           default: out/inventory/<UTC time>
    --help

Exit status: 0 written, 3 setup error.`;

export type InventoryOptions = {
  readonly runs: readonly string[];
  readonly caseFile: string;
  readonly scope: string;
  readonly out: string | null;
};

export type InventoryCommandDependencies = {
  readonly repositoryRoot: string;
  readonly git: Git;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** The compiled-source identity the candidate's build recorded, or `unrecorded`. */
  readonly candidateSource: () => string;
  /** The SHA-256 the build recorded for the candidate it left; none recorded is a setup error. */
  readonly candidateSha256: () => Promise<string>;
};

export function parseInventoryArguments(args: readonly string[]): InventoryOptions | "help" {
  const runs: string[] = [];
  let caseFile = join("parity", "cases", "characters.json");
  let scope = defaultScopeFile;
  let out: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    if (option === "--help" || option === "-h") return "help";
    const value = args[index + 1];
    if (!["--run", "--case-file", "--scope", "--out"].includes(option)) throw new SetupError(`Unknown option '${option}'.\n${inventoryUsage}`);
    if (value === undefined || value.startsWith("--")) throw new SetupError(`Option '${option}' needs a value.`);
    index++;
    if (option === "--run") runs.push(value);
    else if (option === "--case-file") caseFile = value;
    else if (option === "--scope") scope = value;
    else out = value;
  }
  return { runs, caseFile, scope, out };
}

/** Runs `npm run inventory` and returns its exit status; a setup error is thrown for the composition root to report. */
export async function runInventoryCommand(args: readonly string[], dependencies: InventoryCommandDependencies): Promise<number> {
  const parsed = parseInventoryArguments(args);
  if (parsed === "help") {
    dependencies.log(inventoryUsage);
    return 0;
  }
  const root = dependencies.repositoryRoot;
  const stamp = dependencies.now().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const outputFolder = resolve(root, parsed.out ?? join("out", "inventory", stamp));
  const plan = planCases(resolve(root, parsed.caseFile), [], []).cases.map(plannedCaptures);
  const summary = await writeInventory({
    repositoryRoot: root, git: dependencies.git, scopeFile: parsed.scope, candidateSource: dependencies.candidateSource(), plan,
    runFolders: parsed.runs.map((folder) => resolve(root, folder)), outputFolder,
    ...(parsed.runs.length === 0 ? {} : { candidateSha256: await dependencies.candidateSha256() }),
  });
  dependencies.log(describeInventory(summary));
  return 0;
}
