import { CommandOptions } from "../evals/command-options.js";
import { SetupError } from "../host/setup-error.js";
import type { Arguments } from "../options/arguments.js";
import type { Environment, Profile } from "../options/profile.js";
import { resolveRunOptions, tuningFolder } from "../options/run-options.js";
import { readDispatchedTuning } from "../tuning/active-configuration.js";
import type { DiscoveryOptions } from "./discovery-state.js";

const discoverHelp = "npm run discover -- --help";

export const discoverUsage = `Usage: npm run discover -- --from <thread> [options]

  --from <thread>            the finished workflow thread whose inventory is the baseline (npm start writes it)
  --targets <n>              how many targets get a scenario job, 1 to 10 (default 3)
  --case-file <path>         the fixture cases (default: parity/cases/characters.json)
  --settings-overlay <dir>   folder copied over both staged apps (default: the profile's settingsOverlay)
  --threshold <ratio>        largest passing share of differing pixels
  --canonical-cache <dir>    default: PARITY_CANONICAL_CACHE, the profile's canonicalCache, or the local app data folder
  --live-canonical           use no cache: every canonical side runs live
  --unattended               start only when rank and scenario jobs have certificates for their configuration
  --resume <thread>          continue a discovery thread that stopped, with the options it was started with
  --help

Exit status: 0 done, 1 an admitted scenario differs, 2 execution failures or a failed job, 3 setup error.`;

export type DiscoverArguments = {
  readonly from: string;
  readonly targets: number;
  readonly caseFile: string | null;
  readonly settingsOverlay: string | null;
  readonly threshold: number | null;
  readonly canonicalCache: string | null;
  readonly liveCanonical: boolean;
  readonly unattended: boolean;
};

export type DiscoverCommand =
  | { readonly kind: "help" }
  | { readonly kind: "start"; readonly arguments: DiscoverArguments }
  | { readonly kind: "resume"; readonly threadId: string };

/** Parses the command line; an unknown or repeated option, a missing or invalid value and contradicting options are setup errors. */
export function parseDiscoverArguments(args: readonly string[]): DiscoverCommand {
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  if (args.includes("--resume")) {
    if (args.length > 2 || (args.length === 2 && args[0] !== "--resume")) throw new SetupError("--resume takes no other options: a thread keeps the options it was started with.");
    return { kind: "resume", threadId: CommandOptions.parse("discover", args, ["resume"], [], discoverHelp).required("resume") };
  }
  const options = CommandOptions.parse(
    "discover", args, ["from", "targets", "case-file", "settings-overlay", "threshold", "canonical-cache"], ["live-canonical", "unattended"], discoverHelp,
  );
  const from = options.text("from");
  if (from === null) throw new SetupError("npm run discover needs --from <thread>: the workflow thread whose inventory is the baseline.");
  const parsed: DiscoverArguments = {
    from, targets: options.number("targets", 3, 1, 10, true), caseFile: options.text("case-file"), settingsOverlay: options.text("settings-overlay"),
    threshold: options.text("threshold") === null ? null : options.number("threshold", 0, 0, 1), canonicalCache: options.text("canonical-cache"),
    liveCanonical: options.flag("live-canonical"), unattended: options.flag("unattended"),
  };
  if (parsed.liveCanonical && parsed.canonicalCache !== null) throw new SetupError("--live-canonical and --canonical-cache contradict each other; give one of them.");
  return { kind: "start", arguments: parsed };
}
/** Fills in defaults from the profile and the environment the way `npm start` does, and makes every path absolute. */
export function resolveDiscoveryOptions(args: DiscoverArguments, profile: Profile, env: Environment, repositoryRoot: string): DiscoveryOptions {
  const workflow: Arguments = {
    cases: [], captures: [], settingsOverlay: args.settingsOverlay, threshold: args.threshold, caseFile: args.caseFile, canonicalCache: args.canonicalCache,
    liveCanonical: args.liveCanonical, noOcr: true, tessdata: null, only: null, recapture: false, noDiagnosis: true, noRepair: true, noWidening: true,
    noDiscovery: true, unattended: args.unattended, fixChanges: false,
  };
  const resolved = resolveRunOptions(workflow, profile, env, repositoryRoot);
  return {
    from: args.from, caseFile: resolved.caseFile, settingsOverlay: resolved.settingsOverlay, threshold: resolved.threshold, canonicalCache: resolved.canonicalCache,
    canonicalCacheSource: resolved.canonicalCacheSource, targets: args.targets, unattended: args.unattended, agents: resolved.agents, certificates: resolved.certificates,
    tuning: readDispatchedTuning(tuningFolder(profile, repositoryRoot), ["rank", "scenario"]),
  };
}
