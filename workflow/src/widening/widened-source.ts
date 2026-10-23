import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { compiledFolders, isCompiledPath } from "../compiled-source.js";
import { SetupError } from "../host/setup-error.js";
import type { PatchFile } from "../repair/patch.js";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Makes `target` a copy of the accepted source's compiled folders (`Chummer/` and `Core/`), the only ones a patch may
 * change and the only ones the widened source holds, with the patch's after sides from the attempt's archive
 * (`files/after/<path>`) written over it. A compiled folder that the accepted source lacks is a setup error: the source
 * cannot be built without it. Returns the files whose accepted content is not the content the patch was made from;
 * then nothing is written over, and `target` holds the plain copy.
 */
export function prepareWidenedSource(acceptedSource: string, archive: string, files: readonly PatchFile[], target: string): string[] {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const folder of compiledFolders) {
    if (!existsSync(join(acceptedSource, folder))) throw new SetupError(`The accepted source ${acceptedSource} has no ${folder}/, which the candidate is compiled from.`);
    cpSync(join(acceptedSource, folder), join(target, folder), { recursive: true });
  }
  const conflicts: string[] = [];
  for (const file of files) {
    if (!isCompiledPath(file.path) || file.change === "deleted" || file.after === null) {
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
