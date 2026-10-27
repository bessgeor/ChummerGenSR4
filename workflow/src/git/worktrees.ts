import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { SetupError } from "../host/setup-error.js";
import { GitCommandError, type BranchGit } from "./branch-git.js";

/** A file's blob in a commit's tree, or null when the commit does not have it. */
export type BlobId = string | null;

/** One file a commit changes against another, by blob. */
export type ChangedFile = { readonly path: string; readonly before: BlobId; readonly after: BlobId; /** Either side is a symbolic link or a submodule, not a file. */ readonly special: boolean };

/** A worktree's `.git` file (null when it is not a file) and the branch and commit the repository has it on. */
export type WorktreeState = { readonly gitFile: string | null; readonly branch: string | null; readonly head: string | null };

const zeroBlob = /^0+$/;

/** Worktrees, commits and trees of the repository, through its git. */
export class Worktrees {
  constructor(private readonly git: BranchGit, private readonly repositoryRoot: string) {}

  /**
   * Adds a worktree at `folder` on `branch`, (re)set to `start`: an attempt interrupted after its worktree was made starts
   * again from `start`. A stale registration of the folder is pruned first.
   */
  add(folder: string, branch: string, start: string): void {
    this.git(["worktree", "prune"]);
    if (existsSync(folder)) throw new SetupError(`The worktree folder ${folder} exists already.`);
    this.git(["worktree", "add", "--quiet", "--force", "-B", branch, folder, start]);
  }

  /**
   * Adds a worktree at `folder` on `branch`, (re)set to `start`, whose files are only those under `paths` (the ones
   * `start` has): its index holds every file of `start`, so a commit made in it changes nothing outside `paths`.
   */
  addPartial(folder: string, branch: string, start: string, paths: readonly string[]): void {
    this.git(["worktree", "prune"]);
    if (existsSync(folder)) throw new SetupError(`The worktree folder ${folder} exists already.`);
    this.git(["worktree", "add", "--quiet", "--force", "--no-checkout", "-B", branch, folder, start]);
    this.git(["reset", "--quiet"], { worktree: folder });
    const present = paths.filter((path) => !this.missingFolders(start, [path]).length);
    if (present.length > 0) this.git(["checkout", "--quiet", "--", ...present], { worktree: folder });
  }

  /** Adds a worktree at `folder` detached at `start`. */
  addDetached(folder: string, start: string): void {
    this.git(["worktree", "prune"]);
    if (existsSync(folder)) throw new SetupError(`The worktree folder ${folder} exists already.`);
    this.git(["worktree", "add", "--quiet", "--force", "--detach", folder, start]);
  }

  /**
   * Removes the worktree at `folder` and its registration; nothing happens when there is none. Its branch stays. Fails when
   * the registration is still there afterwards, with git's own error when git refused to remove the worktree.
   */
  remove(folder: string): void {
    let refused: GitCommandError | null = null;
    if (this.list().some((item) => samePath(item.folder, folder))) {
      try {
        this.git(["worktree", "remove", "--force", "--force", folder]);
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error;
        // A process a job left behind may still hold a file (Windows): the folder is removed below and the registration pruned.
        refused = error;
      }
    }
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.git(["worktree", "prune"]);
    if (this.list().some((item) => samePath(item.folder, folder))) {
      throw refused ?? new SetupError(`The worktree ${folder} is still registered after its removal.`);
    }
  }

  /** The repository's worktrees with the branch each has checked out (null when detached) and its HEAD commit. */
  list(): { folder: string; branch: string | null; head: string | null }[] {
    const items: { folder: string; branch: string | null; head: string | null }[] = [];
    for (const block of this.git(["worktree", "list", "--porcelain"]).split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const folder = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      if (folder === undefined) continue;
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length) ?? null;
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length) ?? null;
      items.push({ folder, branch, head });
    }
    return items;
  }

  /**
   * A worktree's git state: its `.git` file, which ties the folder to the repository, and the branch and commit the
   * repository has it on, read from the repository's own git folder rather than through the worktree.
   */
  state(folder: string): WorktreeState {
    const path = join(folder, ".git");
    const gitFile = existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : null;
    const entry = this.list().find((item) => samePath(item.folder, folder));
    return { gitFile, branch: entry?.branch ?? null, head: entry?.head ?? null };
  }

  /** How a worktree's git state differs from `expected`, as sentences; empty when it does not. */
  changedState(folder: string, expected: WorktreeState): string[] {
    const now = this.state(folder);
    const changes: string[] = [];
    if (now.gitFile !== expected.gitFile) changes.push(`the worktree's .git file ${now.gitFile === null ? "is gone" : "changed"}`);
    if (now.branch !== expected.branch || now.head !== expected.head) {
      changes.push(`the worktree is on ${now.branch ?? "no branch"} at ${now.head ?? "no commit"}, not on ${expected.branch ?? "no branch"} at ${expected.head ?? "no commit"}`);
    }
    return changes;
  }

  /** Stages every change of the worktree (within `paths`, when given) and returns whether anything differs from its HEAD. */
  stage(folder: string, paths: readonly string[] = []): boolean {
    this.git(["add", "--all", ...(paths.length === 0 ? [] : ["--", ...paths])], { worktree: folder });
    return this.git(["diff", "--cached", "--name-only"], { worktree: folder }).trim().length > 0;
  }

  /** The staged files of the worktree that differ from `commit` within `paths`. */
  stagedAgainst(folder: string, commit: string, paths: readonly string[]): string[] {
    return this.git(["diff", "--cached", "--name-only", "-z", "--no-renames", commit, "--", ...paths], { worktree: folder }).split("\0").filter((path) => path.length > 0);
  }

  /** Commits what is staged in the worktree with `message` and returns the commit. */
  commitStaged(folder: string, message: string): string {
    this.git(["commit", "--quiet", "--no-verify", "-F", "-"], { worktree: folder, input: message });
    return this.head(folder);
  }

  /** Commits every change of the worktree; null when nothing changed. */
  commitAll(folder: string, message: string): string | null {
    return this.stage(folder) ? this.commitStaged(folder, message) : null;
  }

  /** Writes `path` of `commit` into the worktree, as a checkout writes it. */
  checkoutFile(folder: string, commit: string, path: string): void {
    this.git(["checkout", "--quiet", commit, "--", path], { worktree: folder });
  }

  head(folder: string): string {
    return this.git(["rev-parse", "HEAD"], { worktree: folder }).trim();
  }

  /** The commit a ref names, or null when it does not exist. */
  resolve(ref: string): string | null {
    const found = this.git(["for-each-ref", "--format=%(objectname)", ref]).trim();
    return found.length === 0 ? null : found;
  }

  /** The first parent of a commit. */
  parent(commit: string): string {
    return this.git(["rev-parse", `${commit}^`]).trim();
  }

  /** The files `to` changes against `from`, without rename detection, sorted by path. */
  changes(from: string, to: string): ChangedFile[] {
    const fields = this.git(["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", from, to]).split("\0").filter((field) => field.length > 0);
    const changes: ChangedFile[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      // `:<mode> <mode> <blob> <blob> <status>` then the path.
      const [beforeMode, afterMode, before, after] = fields[index]!.slice(1).split(" ");
      const special = [beforeMode, afterMode].some((mode) => mode === "120000" || mode === "160000");
      changes.push({ path: fields[index + 1]!, before: zeroBlob.test(before!) ? null : before!, after: zeroBlob.test(after!) ? null : after!, special });
    }
    return changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  }

  /** Every file of a commit's tree with its blob. */
  blobs(commit: string): Map<string, string> {
    const blobs = new Map<string, string>();
    for (const entry of this.git(["ls-tree", "-r", "-z", commit]).split("\0").filter((item) => item.length > 0)) {
      const tab = entry.indexOf("\t");
      const [, type, blob] = entry.slice(0, tab).split(" ");
      if (type === "blob") blobs.set(entry.slice(tab + 1), blob!);
    }
    return blobs;
  }

  /** The blob of `path` in a commit, or null when the commit does not have it. */
  blob(commit: string, path: string): BlobId {
    const found = this.git(["ls-tree", "-z", commit, "--", path]).split("\0").find((entry) => entry.endsWith(`\t${path}`));
    if (found === undefined) return null;
    const [, type, blob] = found.slice(0, found.indexOf("\t")).split(" ");
    return type === "blob" ? blob! : null;
  }

  /** A blob's bytes as git stores them. */
  read(blob: string): Buffer {
    try {
      return execFileSync("git", ["-C", this.repositoryRoot, "cat-file", "blob", blob], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      throw new SetupError(`git cat-file blob ${blob} failed: ${(error as Error).message}`);
    }
  }

  /** The folders a commit's tree does not have. */
  missingFolders(commit: string, folders: readonly string[]): string[] {
    return folders.filter((folder) => this.git(["ls-tree", "--name-only", commit, "--", folder]).trim().length === 0);
  }

  /** The value of a trailer of a commit's message, or null without one. */
  trailer(commit: string, key: string): string | null {
    const value = this.git(["log", "-1", `--format=%(trailers:key=${key},valueonly)`, commit]).trim();
    return value.length === 0 ? null : value;
  }
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

/**
 * A path in the form git lists worktrees in: absolute, with the existing part resolved (a Windows 8.3 short name such as
 * a temporary folder's becomes its long name, a link its target), with forward slashes and without case.
 */
function canonicalPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  const resolved = existsSync(existing) ? realpathSync.native(existing) : existing;
  return join(resolved, ...rest).replaceAll("\\", "/").toLowerCase();
}
