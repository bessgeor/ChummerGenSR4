import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { SetupError } from "../host/setup-error.js";
import type { PatchFile } from "../repair/patch.js";

/** The only folder a patch may change and the only one the widened source holds: the compiled source. */
export const compiledFolder = "Chummer";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Makes `target` a copy of the accepted source's `Chummer/` with the patch's after sides from the attempt's archive
 * (`files/after/<path>`) written over it. Returns the files whose accepted content is not the content the patch was
 * made from; then nothing is written over, and `target` holds the plain copy.
 */
export function prepareWidenedSource(acceptedSource: string, archive: string, files: readonly PatchFile[], target: string): string[] {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(join(acceptedSource, compiledFolder), join(target, compiledFolder), { recursive: true });
  const conflicts: string[] = [];
  for (const file of files) {
    if (!file.path.startsWith(`${compiledFolder}/`) || file.change === "deleted" || file.after === null) {
      throw new SetupError(`The archived patch in ${archive} changes ${file.path} (${file.change}), which the patch guard does not let through.`);
    }
    const accepted = join(acceptedSource, file.path);
    const present = existsSync(accepted);
    if (file.before === null ? present : !present || sha256(accepted) !== file.before) conflicts.push(file.path);
  }
  if (conflicts.length > 0) return conflicts;
  for (const file of files) {
    const after = join(archive, "files", "after", file.path);
    if (!existsSync(after) || sha256(after) !== file.after) throw new SetupError(`The archive ${archive} has no file ${file.path} with the patch's content.`);
    mkdirSync(dirname(join(target, file.path)), { recursive: true });
    copyFileSync(after, join(target, file.path));
  }
  return [];
}
