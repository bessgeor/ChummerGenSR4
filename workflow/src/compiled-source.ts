import { existsSync } from "node:fs";
import { join } from "node:path";

/** The folders the candidate is compiled from: the app and its class library. A repair may change files under them and nowhere else. */
export const compiledFolders = ["Chummer", "Core"] as const;

/** The compiled folders as prompts and messages name them. */
export const compiledFoldersText = compiledFolders.map((folder) => `${folder}/`).join(" and ");

/** The compiled folders that `root` holds, in their usual order: a snapshot taken before the class library existed holds only `Chummer/`. */
export function compiledFoldersIn(root: string): string[] {
  return compiledFolders.filter((folder) => existsSync(join(root, folder)));
}

/** Whether a path relative to the source root, with / separators, lies in one of the compiled folders. */
export function isCompiledPath(path: string): boolean {
  return compiledFolders.some((folder) => path.startsWith(`${folder}/`));
}
