import { z } from "zod";

export const repairPromptVersion = "repair-v3";

/** A repair job's answer; like the diagnosis schemas, types and enums only, with the rest checked by `validateRepair`. */
export const RepairOutputSchema = z.strictObject({
  outcome: z.enum(["patched", "no_patch"]),
  /** Why the change removes the discrepancy, or why there is none. */
  reason: z.string(),
  /** What was changed, in a sentence or two. */
  summary: z.string(),
  /** The changed files, relative to the source copy, with `/` separators. */
  files: z.array(z.string()),
});
export type RepairOutput = z.infer<typeof RepairOutputSchema>;

/** Why a path is no plain relative path inside the source copy, or null. */
export function unsafePath(path: string): string | null {
  if (path.length === 0) return "is empty";
  if (path.includes("\\")) return "uses \\ instead of /";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "is absolute";
  if (path.split("/").some((part) => part === ".." || part === "." || part === "")) return "has an empty, . or .. part";
  return null;
}

/** The errors of a schema-valid answer; empty when it may be used. */
export function validateRepair(output: RepairOutput): string[] {
  const errors: string[] = [];
  if (output.reason.trim().length === 0) errors.push("reason is empty");
  if (output.summary.trim().length === 0) errors.push("summary is empty");
  if (output.outcome === "patched" && output.files.length === 0) errors.push("a patched answer lists no file");
  if (output.outcome === "no_patch" && output.files.length > 0) errors.push("a no_patch answer lists files");
  for (const [index, path] of output.files.entries()) {
    const problem = unsafePath(path);
    if (problem !== null) errors.push(`files[${index}] '${path}' ${problem}`);
    if (output.files.indexOf(path) !== index) errors.push(`files[${index}] '${path}' is listed twice`);
  }
  return errors;
}
