import { compiledFoldersText, isCompiledPath } from "../compiled-source.js";
import type { Patch } from "./patch.js";

// A repair may change only the compiled source (see compiled-source.ts). Data and translations are staged from the canonical app.
export const maximumFiles = 10;
/** Added plus removed lines over every file. */
export const maximumChangedLines = 300;

/** Every rule a patch breaks, given the files the repair job said it changed; empty when it may be built. */
export function guardPatch(patch: Patch, declared: readonly string[]): string[] {
  const violations: string[] = [];
  if (patch.files.length === 0) violations.push("the patch is empty: the attempt changed no file that git does not ignore");
  const changed = patch.files.map((file) => file.path);
  const undeclared = changed.filter((path) => !declared.includes(path));
  const unchanged = declared.filter((path) => !changed.includes(path));
  if (undeclared.length > 0) violations.push(`changed but not listed in the answer: ${undeclared.join(", ")}`);
  if (unchanged.length > 0) violations.push(`listed in the answer but not changed: ${unchanged.join(", ")}`);
  for (const path of patch.others) violations.push(`${path} is neither a file nor a folder`);
  for (const file of patch.files) {
    if (!isCompiledPath(file.path)) violations.push(`${file.path} is outside ${compiledFoldersText}`);
    if (file.change === "deleted") violations.push(`${file.path} is deleted`);
    if (file.binary) violations.push(`${file.path} holds a NUL byte`);
  }
  if (patch.files.length > maximumFiles) violations.push(`${patch.files.length} files changed, more than ${maximumFiles}`);
  const lines = patch.added + patch.removed;
  if (lines > maximumChangedLines) violations.push(`${lines} lines changed (${patch.added} added, ${patch.removed} removed), more than ${maximumChangedLines}`);
  return violations;
}
