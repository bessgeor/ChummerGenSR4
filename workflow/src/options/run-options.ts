import { join, resolve } from "node:path";
import { resolveAgentSettings, type AgentSettings } from "../agents/agent-settings.js";
import type { Arguments, NodeName } from "./arguments.js";
import { readDispatchedTuning } from "../tuning/active-configuration.js";
import { dispatchedJobKinds, type DispatchedTuning } from "../tuning/tuning.js";
import { localDataFolder, type Environment, type Profile } from "./profile.js";

/** Everything a thread runs with; stored in the thread's state so a resumed thread uses the same options. */
export type RunOptions = {
  readonly caseFile: string;
  readonly cases: readonly string[];
  readonly captures: readonly string[];
  readonly settingsOverlay: string | null;
  readonly threshold: number | null;
  /** The canonical cache folder, or null when every canonical side runs live. */
  readonly canonicalCache: string | null;
  readonly canonicalCacheSource: "option" | "environment" | "profile" | "default" | "off";
  readonly noOcr: boolean;
  readonly tessdata: string | null;
  readonly only: NodeName | null;
  /** Capture every planned case again even when a completed step with the same inputs exists. */
  readonly recapture: boolean;
  /** Whether triage's clusters are diagnosed (--no-diagnosis turns it off). */
  readonly diagnosis: boolean;
  readonly agents: AgentSettings;
  /** Diagnosis dispatches only job kinds with a certificate for their configuration (--unattended). */
  readonly unattended: boolean;
  /** The folder of the certificates: the profile's `certificates`, else `workflow/evals/certificates`. */
  readonly certificates: string;
  /** The active tuning configurations when the thread started; absent in a thread stored before tuning existed, which uses none. */
  readonly tuning?: DispatchedTuning;
  /**
   * Whether confirmed clusters are repaired (null with --no-repair), each attempt's deadline and the attempts a cluster may get.
   */
  readonly repair: RepairSettings | null;
  /** Whether passed repair attempts are widened and promoted (false with --no-widening or --no-repair). */
  readonly widening: boolean;
  /** Whether the thread works in fix changes (--fix-changes); absent in a thread stored before it existed, which works without. */
  readonly fixChanges?: boolean;
};

/** Whether a thread works in fix changes: priors in diagnosis, planned repair and a fix change with every promotion. */
export function usesFixChanges(options: RunOptions): boolean {
  return options.fixChanges === true;
}

export type RepairSettings = {
  readonly deadlineMinutes: number;
  /** How many attempts a cluster may get in a thread, the first included; absent in a thread stored before it existed, which has 1. */
  readonly maxAttempts?: number;
};

/** The tuning folder: the profile's `tuning`, else `workflow/evals/tuning`. */
export function tuningFolder(profile: Profile, repositoryRoot: string): string {
  return resolve(repositoryRoot, profile.tuning ?? join("workflow", "evals", "tuning"));
}

export const defaultRepairDeadlineMinutes = 60;
export const defaultRepairMaxAttempts = 2;

function cacheFolder(args: Arguments, profile: Profile, env: Environment): Pick<RunOptions, "canonicalCache" | "canonicalCacheSource"> {
  if (args.liveCanonical) return { canonicalCache: null, canonicalCacheSource: "off" };
  if (args.canonicalCache !== null) return { canonicalCache: args.canonicalCache, canonicalCacheSource: "option" };
  const fromEnvironment = env["PARITY_CANONICAL_CACHE"];
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return { canonicalCache: fromEnvironment, canonicalCacheSource: "environment" };
  }
  if (profile.canonicalCache !== undefined) return { canonicalCache: profile.canonicalCache, canonicalCacheSource: "profile" };
  return { canonicalCache: join(localDataFolder(env), "canonical-cache"), canonicalCacheSource: "default" };
}

/** Fills in defaults from the profile and the environment and makes every path absolute. */
export function resolveRunOptions(args: Arguments, profile: Profile, env: Environment, repositoryRoot: string): RunOptions {
  const absolute = (path: string | null): string | null => (path === null ? null : resolve(repositoryRoot, path));
  const cache = cacheFolder(args, profile, env);
  return {
    caseFile: resolve(repositoryRoot, args.caseFile ?? join("parity", "cases", "characters.json")),
    cases: args.cases,
    captures: args.captures,
    settingsOverlay: absolute(args.settingsOverlay ?? profile.settingsOverlay ?? null),
    threshold: args.threshold,
    canonicalCache: absolute(cache.canonicalCache),
    canonicalCacheSource: cache.canonicalCacheSource,
    noOcr: args.noOcr,
    tessdata: absolute(args.tessdata),
    only: args.only,
    recapture: args.recapture,
    diagnosis: !args.noDiagnosis,
    agents: resolveAgentSettings(profile.agents),
    unattended: args.unattended,
    certificates: resolve(repositoryRoot, profile.certificates ?? join("workflow", "evals", "certificates")),
    // Only the job kinds the thread dispatches: a stale configuration of another kind does not stop it.
    tuning: readDispatchedTuning(tuningFolder(profile, repositoryRoot), dispatchedJobKinds({ diagnosis: !args.noDiagnosis, only: args.only })),
    repair: args.noRepair ? null : {
      deadlineMinutes: profile.repair?.deadlineMinutes ?? defaultRepairDeadlineMinutes,
      maxAttempts: profile.repair?.maxAttempts ?? defaultRepairMaxAttempts,
    },
    widening: !args.noRepair && !args.noWidening,
    fixChanges: args.fixChanges,
  };
}
