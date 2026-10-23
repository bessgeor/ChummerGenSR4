import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AgentsProfileSchema } from "../agents/agent-settings.js";
import { SetupError } from "../host/setup-error.js";
import { LanesSchema } from "../lanes/lane-settings.js";

/** The optional local workflow profile: machine-specific defaults, never committed. */
export const ProfileSchema = z.strictObject({
  canonicalCache: z.string().min(1).optional(),
  settingsOverlay: z.string().min(1).optional(),
  cpuPool: z.number().int().min(1).optional(),
  /** The desktop lanes captures run on; one lane on this machine's desktop when absent. */
  lanes: LanesSchema.optional(),
  agents: AgentsProfileSchema.optional(),
  /** The folder of the certificates that unattended runs need. */
  certificates: z.string().min(1).optional(),
  /** The folder of the active tuning configurations and the holdout ledger. */
  tuning: z.string().min(1).optional(),
  repair: z.strictObject({
    /** How long a repair attempt's model job and build may take together, in minutes; capped like a job's time limit. */
    deadlineMinutes: z.number().positive().max(35_000).optional(),
    /** How many attempts a cluster may get in a thread, the first included. */
    maxAttempts: z.number().int().min(1).max(10).optional(),
  }).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export type Environment = Readonly<Record<string, string | undefined>>;

/** The machine-wide folder for the workflow's shared state, in the user's local application data. */
export function localDataFolder(env: Environment): string {
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData === undefined || localAppData.length === 0) {
    throw new SetupError("LOCALAPPDATA is not set, so the machine-wide workflow folder cannot be found.");
  }
  return join(localAppData, "ChummerGenSR4");
}

export function profilePath(env: Environment): string {
  return env["PARITY_WORKFLOW_PROFILE"] ?? join(localDataFolder(env), "workflow-profile.json");
}

/** Reads the profile; a missing file is an empty profile, an unreadable or invalid one a setup error. */
export function loadProfile(env: Environment): Profile {
  const path = profilePath(env);
  if (!existsSync(path)) {
    return {};
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SetupError(`The workflow profile ${path} cannot be read: ${(error as Error).message}`);
  }
  const parsed = ProfileSchema.safeParse(document);
  if (!parsed.success) {
    throw new SetupError(`The workflow profile ${path} is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
