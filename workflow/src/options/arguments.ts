import { SetupError } from "../host/setup-error.js";

export const nodeNames = ["capture", "compare", "triage", "diagnose"] as const;
export type NodeName = (typeof nodeNames)[number];

/** The command line as given, before the profile and the environment fill in defaults. */
export type Arguments = {
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly settingsOverlay: string | null;
  readonly threshold: number | null;
  readonly caseFile: string | null;
  readonly canonicalCache: string | null;
  readonly liveCanonical: boolean;
  readonly noOcr: boolean;
  readonly tessdata: string | null;
  readonly only: NodeName | null;
  readonly recapture: boolean;
  readonly noDiagnosis: boolean;
  /** End the run after diagnosis: no repair attempt. */
  readonly noRepair: boolean;
  /** Dispatch model jobs only under certificates for their configuration. */
  readonly unattended: boolean;
};

export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "start"; readonly arguments: Arguments }
  | { readonly kind: "resume"; readonly threadId: string };

export const usage = `Usage: npm start -- [options]

  Capture options (passed to the capture runner):
    --case <names>             case names or character file names, comma-separated (default: all)
    --capture <names>          capture names, comma-separated (default: all)
    --settings-overlay <dir>   folder copied over both staged apps (default: the profile's settingsOverlay)
    --threshold <ratio>        largest passing share of differing pixels
    --case-file <path>         default: parity/cases/characters.json
  Canonical cache:
    --canonical-cache <dir>    default: PARITY_CANONICAL_CACHE, the profile's canonicalCache, or the local app data folder
    --live-canonical           use no cache: every canonical side runs live
  Compare options (passed to the comparer):
    --no-ocr
    --tessdata <dir>
  Workflow:
    --only <node>              capture, compare, triage or diagnose; earlier nodes must find their completed steps
    --recapture                capture every planned case again, ignoring recorded capture steps (only with --only capture, or without --only)
    --no-diagnosis             end the run after triage: no model job and no check capture
    --no-repair                end the run after diagnosis: no repair attempt for the confirmed clusters
    --unattended               start only when every job kind diagnosis dispatches has a certificate for its configuration
                               (repair has none, so it needs --no-repair)
    --resume <thread>          continue a thread that stopped, with the options it was started with
    --help

Exit status: 0 all passed, 1 differences, 2 execution or analysis failures, 3 setup error.`;

/** Options the workflow sets itself when it runs the capture runner. */
const workflowOwned = new Set(["--canonical-exe", "--candidate-exe", "--runs-dir", "--run-folder-file", "--repo-root"]);

function value(args: readonly string[], index: number): string {
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) {
    throw new SetupError(`Option '${args[index]}' needs a value.`);
  }
  return next;
}

function list(text: string): string[] {
  return text.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function threshold(text: string): number {
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1 || text.trim() === "") {
    throw new SetupError(`--threshold must be a number from 0 to 1, got '${text}'.`);
  }
  return parsed;
}

function nodeName(text: string): NodeName {
  const match = nodeNames.find((name) => name === text);
  if (match === undefined) {
    throw new SetupError(`--only must be one of ${nodeNames.join(", ")}, got '${text}'.`);
  }
  return match;
}

/**
 * Parses the command line; an unknown or workflow-owned option, a missing or invalid value and contradicting
 * options are setup errors. `--case` and `--capture` accumulate; a repeated single-value option keeps its last value.
 */
export function parseArguments(args: readonly string[]): Command {
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }

  if (args.includes("--resume")) {
    const index = args.indexOf("--resume");
    const threadId = value(args, index);
    if (args.length !== 2) {
      throw new SetupError("--resume takes no other options: a thread keeps the options it was started with.");
    }
    return { kind: "resume", threadId };
  }

  const cases: string[] = [];
  const captures: string[] = [];
  let parsed: Omit<Arguments, "cases" | "captures"> = {
    settingsOverlay: null, threshold: null, caseFile: null, canonicalCache: null,
    liveCanonical: false, noOcr: false, tessdata: null, only: null, recapture: false, noDiagnosis: false, noRepair: false, unattended: false,
  };
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    switch (option) {
      case "--case": cases.push(...list(value(args, index++))); break;
      case "--capture": captures.push(...list(value(args, index++))); break;
      case "--settings-overlay": parsed = { ...parsed, settingsOverlay: value(args, index++) }; break;
      case "--threshold": parsed = { ...parsed, threshold: threshold(value(args, index++)) }; break;
      case "--case-file": parsed = { ...parsed, caseFile: value(args, index++) }; break;
      case "--canonical-cache": parsed = { ...parsed, canonicalCache: value(args, index++) }; break;
      case "--live-canonical": parsed = { ...parsed, liveCanonical: true }; break;
      case "--no-ocr": parsed = { ...parsed, noOcr: true }; break;
      case "--tessdata": parsed = { ...parsed, tessdata: value(args, index++) }; break;
      case "--only": parsed = { ...parsed, only: nodeName(value(args, index++)) }; break;
      case "--recapture": parsed = { ...parsed, recapture: true }; break;
      case "--no-diagnosis": parsed = { ...parsed, noDiagnosis: true }; break;
      case "--no-repair": parsed = { ...parsed, noRepair: true }; break;
      case "--unattended": parsed = { ...parsed, unattended: true }; break;
      default:
        throw new SetupError(workflowOwned.has(option)
          ? `Option '${option}' is set by the workflow; run npm run parity to use it.`
          : `Unknown option '${option}'. See npm start -- --help.`);
    }
  }

  if (parsed.liveCanonical && parsed.canonicalCache !== null) {
    throw new SetupError("--live-canonical and --canonical-cache contradict each other; give one of them.");
  }
  if (parsed.recapture && parsed.only !== null && parsed.only !== "capture") {
    throw new SetupError(`--recapture needs the capture node, which --only ${parsed.only} does not run.`);
  }
  if (parsed.noDiagnosis && parsed.only === "diagnose") {
    throw new SetupError("--only diagnose and --no-diagnosis contradict each other; give one of them.");
  }
  return { kind: "start", arguments: { ...parsed, cases, captures } };
}
