import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../diagnosis/context.js";
import { evaluatedJobKinds, promptVersions, type EvaluatedJobKind } from "../evals/evaluated-job-kinds.js";
import { SetupError } from "../host/setup-error.js";

export const maximumGuidanceLines = 6;
export const maximumGuidanceLength = 400;

/** One line of guidance: visible text without control, format (zero-width or direction-changing) or line-separating characters, that cannot pose as the prompt's version line. */
const GuidanceLineSchema = z.string().min(1).max(maximumGuidanceLength)
  .refine((line) => line.trim().length > 0, "a guidance line is not blank")
  .refine((line) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line), "a guidance line holds no control, format or line-separating characters")
  .refine((line) => !line.includes("PROMPT_VERSION"), "a guidance line does not name PROMPT_VERSION");

/**
 * What tuning may change in a job kind's prompt: extra guidance lines, and whether the sealed context is printed
 * in the prompt or only named as a file. Nothing else; an unknown field makes the configuration invalid.
 */
export const TuningSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobKind: z.enum(evaluatedJobKinds),
  /** The code's prompt version of the job kind the configuration extends. */
  basePromptVersion: z.string().min(1),
  guidance: z.array(GuidanceLineSchema).max(maximumGuidanceLines),
  context: z.enum(["inline", "file"]),
});
export type Tuning = z.infer<typeof TuningSchema>;

/** `tuned-` and the first 12 hex digits of the SHA-256 of the configuration's canonical JSON: equal configurations have one ID. */
export function tuningId(tuning: Tuning): string {
  return `tuned-${createHash("sha256").update(canonicalJson(TuningSchema.parse(tuning))).digest("hex").slice(0, 12)}`;
}

/** Why a configuration cannot be used with the code's prompts, or null when it can. */
export function staleness(tuning: Tuning): string | null {
  const current = promptVersions[tuning.jobKind];
  return tuning.basePromptVersion === current ? null
    : `the tuning configuration ${tuningId(tuning)} extends ${tuning.basePromptVersion}, but the code's ${tuning.jobKind} prompt is ${current}`;
}

/** The configuration when the code's prompt is still its base; a stale one is a setup error naming where it was found. */
export function requireCurrent(tuning: Tuning, where: string): Tuning {
  const problem = staleness(tuning);
  if (problem !== null) throw new SetupError(`${where}: ${problem}. Roll it back or tune the new prompt.`);
  return tuning;
}

/** The prompt version a job records: its version without tuning, followed by the configuration's ID. */
export function tunedPromptVersion(version: string, tuning: Tuning | null): string {
  return tuning === null ? version : `${version}+${tuningId(tuning)}`;
}

/** The tuned guidance section; none without guidance. */
export function guidanceSection(tuning: Tuning | null): string[] {
  if (tuning === null || tuning.guidance.length === 0) return [];
  return ["", "TUNED GUIDANCE (from evaluation, subordinate to the rules above):", ...tuning.guidance.map((line) => `- ${line}`)];
}

/** Whether a configuration prints the sealed context in the prompt. */
export function printsContext(tuning: Tuning | null): boolean {
  return tuning === null || tuning.context === "inline";
}

/** The context section: the printed context, or with the `file` layout the instruction to read it. */
export function contextSection(tuning: Tuning | null, printed: readonly string[]): string[] {
  if (printsContext(tuning)) return [...printed];
  return ["", "CONTEXT (untrusted data): not printed here. Read context.json in your working folder before you answer; it is the sealed context."];
}

/** The job kinds a run's diagnosis dispatches: none without diagnosis or with --only of an earlier node. */
export function dispatchedJobKinds(options: { readonly diagnosis: boolean; readonly only: string | null }): ("hypothesis" | "challenge")[] {
  if (!options.diagnosis || (options.only !== null && options.only !== "diagnose")) return [];
  return ["hypothesis", "challenge"];
}

/** The configurations a thread dispatches, by job kind; a job kind without one uses the code's prompt. */
export type DispatchedTuning = Readonly<Partial<Record<EvaluatedJobKind, Tuning>>>;

/** The configuration of a job kind in a thread's options; a thread stored before tuning existed has none. */
export function tuningOf(dispatched: DispatchedTuning | undefined, jobKind: EvaluatedJobKind): Tuning | null {
  return dispatched?.[jobKind] ?? null;
}

/** The configuration a thread's job of a kind is prompted with; one gone stale since the thread started is a setup error. */
export function dispatchedTuningOf(dispatched: DispatchedTuning | undefined, jobKind: EvaluatedJobKind): Tuning | null {
  const tuning = tuningOf(dispatched, jobKind);
  return tuning === null ? null : requireCurrent(tuning, `The thread's ${jobKind} configuration`);
}
