import type { z } from "zod";

export const jobKinds = ["hypothesis", "challenge"] as const;
export type JobKind = (typeof jobKinds)[number];

export const providers = ["claude", "codex"] as const;
export type Provider = (typeof providers)[number];

export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];

/** Which provider, model and effort run a job kind, and how long one job may take. */
export type AgentChoice = {
  readonly provider: Provider;
  /** The model name, or null for the CLI's default model. */
  readonly model: string | null;
  readonly effort: Effort;
  readonly timeoutMinutes: number;
};

/** One model job: a prompt, images and an output schema, run read-only in its own folder. */
export type AgentJob<T> = {
  readonly kind: JobKind;
  /** Prefix of the job's progress lines, for example `hypothesis d-1234`. */
  readonly label: string;
  readonly prompt: string;
  /** Absolute paths of images the model is shown; they lie in the job folder. */
  readonly images: readonly string[];
  readonly schema: z.ZodType<T>;
  /** Checks a schema-valid output against what the job was given; each returned line is an error. */
  readonly validate: (output: T) => readonly string[];
  /** The job's working folder, which holds its context, and other folders it may read. */
  readonly workspace: { readonly folder: string; readonly readOnly: readonly string[] };
  readonly choice: AgentChoice;
  /** Where the adapter writes the provider's raw event stream. */
  readonly logFile: string;
  /** Aborts when the run stops: the job is stopped and the adapter throws a setup error. */
  readonly signal?: AbortSignal;
};

export type AgentUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  /** The cost the provider reports, or null when it reports none. */
  readonly costUsd: number | null;
};

export const failureKinds = ["invalid_output", "refused", "quota_exhausted", "infra"] as const;
export type AgentFailureKind = (typeof failureKinds)[number];

export type AgentFailure = { readonly kind: AgentFailureKind; readonly message: string };

type Common = {
  readonly usage: AgentUsage | null;
  readonly durationMs: number;
  /** The provider's session or thread ID, when it reported one. */
  readonly sessionId: string | null;
};

export type AgentResult<T> =
  | (Common & { readonly ok: true; readonly output: T })
  | (Common & { readonly ok: false; readonly failure: AgentFailure });

/** Runs model jobs. A job that ran returns a result, also when it failed; a stopped run throws a setup error. */
export interface AgentRunner {
  run<T>(job: AgentJob<T>): Promise<AgentResult<T>>;
}
