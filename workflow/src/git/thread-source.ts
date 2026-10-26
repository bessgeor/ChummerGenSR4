import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { compiledFolders } from "../compiled-source.js";
import { snapshotFolders } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { GitCommandError, type BranchGit } from "./branch-git.js";

/** The branches a thread makes, all under `workflow/<thread>/`. */
export const threadBranches = {
  source: (threadId: string) => `workflow/${threadId}/source`,
  attempt: (threadId: string, clusterId: string, attempt: number) => `workflow/${threadId}/repair/${clusterId}/attempt-${attempt}`,
  subtask: (threadId: string, clusterId: string, attempt: number, task: number) => `workflow/${threadId}/repair/${clusterId}/attempt-${attempt}-task-${task}`,
  widening: (threadId: string, clusterId: string, attempt: number) => `workflow/${threadId}/widening/${clusterId}/attempt-${attempt}`,
  fix: (threadId: string, clusterId: string) => `workflow/${threadId}/fix/${clusterId}`,
  integration: (threadId: string) => `workflow/${threadId}/integration`,
};

export function sourceMessage(threadId: string): string {
  return `Source captured by thread ${threadId}\n\nThe compiled source as the thread's candidate was built from it.\n`;
}

/**
 * A commit on `parent` whose `paths` are those of `folder`, staged as `git add` would with a private index, or null when
 * the staged tree is the parent's own within `paths`. The repository's working tree, index and branches do not change.
 */
export function commitFolders(git: BranchGit, indexFile: string, parent: string, folder: string, message: string, paths: readonly string[]): string | null {
  const env = { GIT_INDEX_FILE: indexFile };
  mkdirSync(dirname(indexFile), { recursive: true });
  try {
    git(["read-tree", parent], { env });
    // A path the folder lacks is removed from the index; `add` would not match it.
    const present = paths.filter((path) => existsSync(join(folder, path)));
    const absent = paths.filter((path) => !present.includes(path));
    if (absent.length > 0) git(["rm", "-r", "--cached", "--ignore-unmatch", "--quiet", "--", ...absent], { env });
    if (present.length > 0) git([`--work-tree=${folder}`, "add", "--all", "--", ...present], { cwd: folder, env });
    const tree = git(["write-tree"], { env }).trim();
    const changed = git(["diff-tree", "-r", "--name-only", `${parent}^{tree}`, tree, "--", ...paths]).trim();
    if (changed.length === 0) return null;
    return git(["commit-tree", tree, "-p", parent, "-F", "-"], { env, input: message }).trim();
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * The thread's source commit on `workflow/<thread>/source`: the snapshot's commit, or a commit on it of the snapshot's
 * folders when they differ from it. A branch that exists already is taken as it is, so a resumed thread and attempts
 * started side by side get the same commit. A snapshot without a compiled folder is a setup error.
 */
export function threadSource(git: BranchGit, threadId: string, base: string, snapshotFolder: string, indexFile: string): string {
  const ref = `refs/heads/${threadBranches.source(threadId)}`;
  const existing = () => {
    const found = git(["for-each-ref", "--format=%(objectname)", ref]).trim();
    return found.length === 0 ? null : found;
  };
  const found = existing();
  if (found !== null) return found;
  for (const folder of compiledFolders) {
    if (!existsSync(join(snapshotFolder, folder))) throw new SetupError(`The snapshot ${snapshotFolder} has no ${folder}/, which the candidate is compiled from.`);
  }
  const commit = commitFolders(git, indexFile, base, snapshotFolder, sourceMessage(threadId), snapshotFolders) ?? base;
  try {
    git(["update-ref", "-m", `workflow: source of ${threadId}`, ref, commit, ""]);
  } catch (error) {
    // Made by another attempt in the meantime: its commit is the source.
    const other = existing();
    if (error instanceof GitCommandError && other !== null) return other;
    throw error;
  }
  return commit;
}
