import { z } from "zod";
import type { AgentFailure, AgentFailureKind, AgentJob } from "./agent-job.js";

const quota = /usage limit|limit reached|hit your (?:usage )?limit|usage_limit|rate[ _-]?limit|quota|\b429\b|5-hour limit|weekly limit|out of (?:extra )?usage/i;
const signIn = /not logged in|please (?:log|sign) ?in|\/login|authenticat|unauthori[sz]ed|invalid api key|oauth token|\b401\b/i;
const refusal = /\brefus(?:al|ed|e)\b|content policy|usage polic(?:y|ies)/i;

/**
 * Classifies the text of a failed job: a usage limit of the subscription, a refusal, or anything else
 * (a missing sign-in included), which is an infrastructure failure.
 */
export function classifyFailure(text: string): Exclude<AgentFailureKind, "invalid_output"> {
  if (quota.test(text)) return "quota_exhausted";
  if (signIn.test(text)) return "infra";
  if (refusal.test(text)) return "refused";
  return "infra";
}

export function failure(kind: AgentFailureKind, message: string): AgentFailure {
  return { kind, message: message.length > 4000 ? `${message.slice(0, 4000)}…` : message };
}

/** Validates a job's answer: its schema, then the job's own checks. Anything that fails is `invalid_output`. */
export function finishOutput<T>(job: Pick<AgentJob<T>, "schema" | "validate">, answer: unknown):
  { readonly ok: true; readonly output: T } | { readonly ok: false; readonly failure: AgentFailure } {
  const parsed = job.schema.safeParse(answer);
  if (!parsed.success) return { ok: false, failure: failure("invalid_output", `The answer does not match the schema: ${z.prettifyError(parsed.error)}`) };
  const errors = job.validate(parsed.data);
  if (errors.length > 0) return { ok: false, failure: failure("invalid_output", `The answer is not valid: ${errors.join("; ")}`) };
  return { ok: true, output: parsed.data };
}

/** Parses an answer given as text; text that is not JSON is `invalid_output`. */
export function parseAnswer(text: string): { readonly ok: true; readonly answer: unknown } | { readonly ok: false; readonly failure: AgentFailure } {
  try {
    return { ok: true, answer: JSON.parse(text) };
  } catch (error) {
    return { ok: false, failure: failure("invalid_output", `The answer is not JSON (${(error as Error).message}): ${text.slice(0, 500)}`) };
  }
}

/** The JSON Schema of an output schema, as both structured-output implementations take it. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...document } = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
  return document;
}
