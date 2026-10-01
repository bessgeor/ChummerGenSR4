import { z } from "zod";
import { efforts, jobKinds, providers, type AgentChoice, type JobKind } from "./agent-job.js";

const ChoiceSchema = z.strictObject({
  provider: z.enum(providers),
  model: z.string().min(1).nullable().optional(),
  effort: z.enum(efforts).optional(),
  // Node clamps a timer above 2^31-1 ms (35 791 minutes) to 1 ms, which would stop every job at once.
  timeoutMinutes: z.number().positive().max(35_000).optional(),
});

/** The `agents` part of the local workflow profile; every field is optional. */
export const AgentsProfileSchema = z.strictObject({
  jobs: z.strictObject({ hypothesis: ChoiceSchema.optional(), challenge: ChoiceSchema.optional(), grade: ChoiceSchema.optional() }).optional(),
  modelPool: z.number().int().min(1).optional(),
  runBudgetMinutes: z.number().positive().optional(),
  executables: z.strictObject({ claude: z.string().min(1).optional(), codex: z.string().min(1).optional() }).optional(),
});
export type AgentsProfile = z.infer<typeof AgentsProfileSchema>;

/** The agent settings a thread runs with; stored in its options so a resumed thread keeps them. */
export type AgentSettings = {
  readonly jobs: Readonly<Record<JobKind, AgentChoice>>;
  readonly modelPool: number;
  readonly runBudgetMinutes: number;
  readonly executables: {
    /** The Claude Code CLI: a path, or a name looked up on PATH. */
    readonly claude: string;
    /** The Codex CLI, or null for the one the SDK ships. */
    readonly codex: string | null;
  };
};

/** Hypotheses on Claude, challenges on Codex, so the challenger is another provider unless the profile says otherwise; grades on Claude. */
const defaultChoices: Readonly<Record<JobKind, AgentChoice>> = {
  hypothesis: { provider: "claude", model: null, effort: "medium", timeoutMinutes: 30 },
  challenge: { provider: "codex", model: null, effort: "medium", timeoutMinutes: 30 },
  grade: { provider: "claude", model: null, effort: "medium", timeoutMinutes: 30 },
};

function choice(kind: JobKind, configured: z.infer<typeof ChoiceSchema> | undefined): AgentChoice {
  const fallback = defaultChoices[kind];
  if (configured === undefined) return fallback;
  return {
    provider: configured.provider,
    model: configured.model ?? null,
    effort: configured.effort ?? fallback.effort,
    timeoutMinutes: configured.timeoutMinutes ?? fallback.timeoutMinutes,
  };
}

export function resolveAgentSettings(profile: AgentsProfile | undefined): AgentSettings {
  const jobs = Object.fromEntries(jobKinds.map((kind) => [kind, choice(kind, profile?.jobs?.[kind])])) as Record<JobKind, AgentChoice>;
  return {
    jobs,
    modelPool: profile?.modelPool ?? 2,
    runBudgetMinutes: profile?.runBudgetMinutes ?? 120,
    executables: { claude: profile?.executables?.claude ?? "claude", codex: profile?.executables?.codex ?? null },
  };
}
