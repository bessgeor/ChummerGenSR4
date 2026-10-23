import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { SetupError } from "../host/setup-error.js";
import { sha256File, sha256Lines } from "../steps/fingerprint.js";

/** The folders the candidate is built and run from: the app's source and its tracked data and translations. */
export const snapshotFolders = ["Chummer", "bin/data", "bin/lang"] as const;

/** The folder the candidate is compiled from. `bin/data` and `bin/lang` are no build input: capture steps copy them into each staged app. */
const compiledFolder = "Chummer/";

/** SHA-256 over the lines (`path<TAB>SHA-256`) of the compiled source files among the snapshot lines. */
function compiledIdentityOf(lines: readonly string[]): string {
  return sha256Lines(lines.filter((line) => line.startsWith(compiledFolder)));
}

export type SourceSnapshot = {
  /** The snapshot's folder: a plain copy of the files, without version history. */
  readonly folder: string;
  /** SHA-256 over the sorted relative paths and their files' SHA-256. */
  readonly identity: string;
  /** The same over the compiled source (`Chummer/`) only: what the candidate's build recorded. */
  readonly compiledIdentity: string;
  /** The commit the working tree was on when the snapshot was taken. */
  readonly commit: string;
  readonly files: number;
};

/** Runs git in the repository and returns its standard output. */
export type Git = (args: readonly string[]) => string;

export function processGit(repositoryRoot: string): Git {
  return (args) => {
    try {
      return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    } catch (error) {
      throw new SetupError(`git ${args.join(" ")} failed: ${(error as Error).message}`);
    }
  };
}

/** The tracked and untracked, not ignored, files of the snapshot folders that exist in the working tree, sorted. */
function sourcePaths(repositoryRoot: string, git: Git): string[] {
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...snapshotFolders])
    .split("\0").filter((path) => path.length > 0);
  const paths = [...new Set(listed)].filter((path) => existsSync(join(repositoryRoot, path)))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (paths.length === 0) throw new SetupError(`git lists no file under ${snapshotFolders.join(", ")} in ${repositoryRoot}.`);
  return paths;
}

/** The identity of the compiled source of the working tree now, without copying anything; equals `compiledIdentity` of a snapshot taken now. */
export async function compiledSourceIdentity(repositoryRoot: string, git: Git): Promise<string> {
  const lines: string[] = [];
  for (const path of sourcePaths(repositoryRoot, git).filter((item) => item.startsWith(compiledFolder))) {
    lines.push(`${path}\t${await sha256File(join(repositoryRoot, path))}`);
  }
  return sha256Lines(lines);
}

/**
 * Copies the tracked and untracked, not ignored, files of the snapshot folders as they are in the working tree
 * (the state the candidate is built from) into `folder`, replacing what was there. Files git tracks but the
 * working tree deleted are not part of it.
 */
export async function createSourceSnapshot(repositoryRoot: string, folder: string, git: Git): Promise<SourceSnapshot> {
  const paths = sourcePaths(repositoryRoot, git);
  rmSync(folder, { recursive: true, force: true });
  const lines: string[] = [];
  for (const path of paths) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repositoryRoot, path), target);
    lines.push(`${path}\t${await sha256File(target)}`);
  }
  return { folder, identity: sha256Lines(lines), compiledIdentity: compiledIdentityOf(lines), commit: git(["rev-parse", "HEAD"]).trim(), files: paths.length };
}
