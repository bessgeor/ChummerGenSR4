import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { SetupError } from "../host/setup-error.js";
import { GitCommandError, type BranchGit } from "./branch-git.js";

/** A file's blob in a commit's tree, or null when the commit does not have it. */
export type BlobId = string | null;

/** One file a commit changes against another, by blob. */
export type ChangedFile = { readonly path: string; readonly before: BlobId; readonly after: BlobId; /** Either side is a symbolic link or a submodule, not a file. */ readonly special: boolean };

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

  /** Adds a worktree at `folder` detached at `start`. */
  addDetached(folder: string, start: string): void {
    this.git(["worktree", "prune"]);
    if (existsSync(folder)) throw new SetupError(`The worktree folder ${folder} exists already.`);
    this.git(["worktree", "add", "--quiet", "--force", "--detach", folder, start]);
  }

  /** Removes the worktree at `folder` and its registration; nothing happens when there is none. Its branch stays. */
  remove(folder: string): void {
    const registered = this.list().some((item) => samePath(item.folder, folder));
    if (registered) {
      try {
        this.git(["worktree", "remove", "--force", "--force", folder]);
      } catch (error) {
        // A process a job left behind may still hold a file (Windows): the folder is removed below and the registration pruned.
        if (!(error instanceof GitCommandError)) throw error;
      }
    }
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.git(["worktree", "prune"]);
  }

  /** The repository's worktrees with the branch each has checked out (null when detached). */
  list(): { folder: string; branch: string | null }[] {
    const items: { folder: string; branch: string | null }[] = [];
    for (const block of this.git(["worktree", "list", "--porcelain"]).split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const folder = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      if (folder === undefined) continue;
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length) ?? null;
      items.push({ folder, branch });
    }
    return items;
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
  return resolve(left).replaceAll("\\", "/").toLowerCase() === resolve(right).replaceAll("\\", "/").toLowerCase();
}
