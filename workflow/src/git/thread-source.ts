import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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

/** The attributes that convert a file's bytes between the repository and a worktree. */
const conversionAttributes = ["text", "eol", "filter", "ident", "working-tree-encoding"];

/**
 * Fails when the repository's own `info/attributes`, the one attribute source the git runner cannot pin away, converts
 * any file of `paths` in `folder`: the worktrees would then hold other bytes than the snapshot the candidate was built from.
 */
function requireUnconvertedBytes(git: BranchGit, folder: string, paths: readonly string[]): void {
  const files: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(folder, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  for (const path of paths.filter((item) => existsSync(join(folder, item)))) {
    if (statSync(join(folder, path)).isDirectory()) walk(path);
    else files.push(path);
  }
  if (files.length === 0) return;
  const fields = git(["check-attr", "-z", "--stdin", ...conversionAttributes], { input: files.map((file) => `${file}\0`).join("") }).split("\0");
  const converted = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [path, attribute, value] = [fields[index]!, fields[index + 1]!, fields[index + 2]!];
    // `-text` switches the conversion off.
    if (value !== "unspecified" && !(attribute === "text" && value === "unset")) converted.add(path);
  }
  if (converted.size > 0) {
    const names = [...converted].sort();
    throw new SetupError(`The repository's info/attributes converts the bytes of ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""}, so a worktree would not hold the sealed snapshot's bytes. Remove those attributes from info/attributes.`);
  }
}

/**
 * The tree of `parent` with its `paths` replaced by those of `folder`, staged as `git add` would with a private index.
 * `then` may use the index before it is removed. The repository's working tree, index and branches do not change.
 */
function stageFolders<T>(git: BranchGit, indexFile: string, parent: string, folder: string, paths: readonly string[], then: (tree: string, env: { GIT_INDEX_FILE: string }) => T): T {
  const env = { GIT_INDEX_FILE: indexFile };
  requireUnconvertedBytes(git, folder, paths);
  mkdirSync(dirname(indexFile), { recursive: true });
  try {
    git(["read-tree", parent], { env });
    // A path the folder lacks is removed from the index; `add` would not match it.
    const present = paths.filter((path) => existsSync(join(folder, path)));
    const absent = paths.filter((path) => !present.includes(path));
    if (absent.length > 0) git(["rm", "-r", "--cached", "--ignore-unmatch", "--quiet", "--", ...absent], { env });
    if (present.length > 0) git([`--work-tree=${folder}`, "add", "--all", "--", ...present], { cwd: folder, env });
    return then(git(["write-tree"], { env }).trim(), env);
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/** A commit on `parent` whose `paths` are those of `folder`, or null when they are the parent's own. */
export function commitFolders(git: BranchGit, indexFile: string, parent: string, folder: string, message: string, paths: readonly string[]): string | null {
  return stageFolders(git, indexFile, parent, folder, paths, (tree, env) => {
    const changed = git(["diff-tree", "-r", "--name-only", `${parent}^{tree}`, tree, "--", ...paths]).trim();
    return changed.length === 0 ? null : git(["commit-tree", tree, "-p", parent, "-F", "-"], { env, input: message }).trim();
  });
}

/**
 * Fails unless the tree of `commit` is the snapshot's: the tree of `base` with the snapshot's folders as they are in
 * `snapshotFolder`. A source branch with other content is not what the candidate was built from.
 */
export function requireSourceOfSnapshot(git: BranchGit, threadId: string, commit: string, base: string, snapshotFolder: string, indexFile: string): void {
  const expected = stageFolders(git, indexFile, base, snapshotFolder, snapshotFolders, (tree) => tree);
  const differing = git(["diff-tree", "-r", "--name-only", expected, `${commit}^{tree}`]).split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (differing.length > 0) {
    throw new SetupError(`The thread's source branch ${threadBranches.source(threadId)} at ${commit} does not hold the sealed snapshot: ${differing.slice(0, 5).join(", ")}${differing.length > 5 ? ", ..." : ""} differ${differing.length === 1 ? "s" : ""}. Restore the branch or start a new thread.`);
  }
}

/**
 * The thread's source commit on `workflow/<thread>/source`: the snapshot's commit, or a commit on it of the snapshot's
 * folders when they differ from it. A branch that exists already is taken when its tree is the snapshot's, so a resumed
 * thread and attempts started side by side get the same commit. A snapshot without a compiled folder is a setup error.
 */
export function threadSource(git: BranchGit, threadId: string, base: string, snapshotFolder: string, indexFile: string): string {
  const ref = `refs/heads/${threadBranches.source(threadId)}`;
  const existing = () => {
    const found = git(["for-each-ref", "--format=%(objectname)", ref]).trim();
    return found.length === 0 ? null : found;
  };
  for (const folder of compiledFolders) {
    if (!existsSync(join(snapshotFolder, folder))) throw new SetupError(`The snapshot ${snapshotFolder} has no ${folder}/, which the candidate is compiled from.`);
  }
  const found = existing();
  if (found !== null) {
    requireSourceOfSnapshot(git, threadId, found, base, snapshotFolder, indexFile);
    return found;
  }
  const commit = commitFolders(git, indexFile, base, snapshotFolder, sourceMessage(threadId), snapshotFolders) ?? base;
  try {
    git(["update-ref", "-m", `workflow: source of ${threadId}`, ref, commit, ""]);
  } catch (error) {
    // Made by another attempt in the meantime: its commit is the source.
    const other = existing();
    if (error instanceof GitCommandError && other !== null) {
      requireSourceOfSnapshot(git, threadId, other, base, snapshotFolder, indexFile);
      return other;
    }
    throw error;
  }
  return commit;
}
