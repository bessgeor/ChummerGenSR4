import { execFileSync } from "node:child_process";
import { SetupError } from "../host/setup-error.js";

export type GitOptions = {
  /** The working folder of the command, by default the repository's root. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
  /** Runs the command in this worktree of the repository instead of with the repository's own git folder. */
  readonly worktree?: string;
  /**
   * Runs the command with the machine's and the repository's line-ending settings and attributes instead of the pinned
   * ones: for a command that writes files into a person's own checkout, which must get them as git always gives them.
   */
  readonly userSettings?: boolean;
};

/** Runs git and returns its standard output; a non-zero exit throws `GitCommandError`. */
export type BranchGit = (args: readonly string[], options?: GitOptions) => string;

/** A git command that exited with a non-zero status; a setup error unless the caller expects it. */
export class GitCommandError extends SetupError {
  constructor(message: string, readonly status: number | null, readonly stdout: string, readonly stderr: string) {
    super(message);
  }
}

/** The empty tree, which git knows without an object: attributes are read from it instead of from the working tree. */
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Commands that read the working tree's attributes: git cannot clean up a conflicting rebase or merge with the empty tree's. */
const treeAttributesKept = new Set(["rebase", "merge"]);

/**
 * Settings every command gets, so the machine's configuration cannot quote paths, and no line-ending conversion or
 * attribute of the machine or the repository changes the bytes a file has when it is staged or checked out: a worktree
 * holds the bytes of the snapshot the candidate was built from.
 */
const pinned = [
  "-c", "core.quotepath=false", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.eol=lf",
  "-c", "core.attributesFile=/dev/null",
];

/**
 * The repository's git: commands run with its git folder (found once) in `cwd`, or in a worktree when `worktree` is given,
 * where git finds the worktree's own git folder.
 */
export function processBranchGit(repositoryRoot: string): BranchGit {
  let gitFolder: string | null = null;
  const run = (args: readonly string[], options: GitOptions = {}) => {
    try {
      const user = options.userSettings === true;
      const attributes = user || args.some((arg) => treeAttributesKept.has(arg)) ? [] : [`--attr-source=${emptyTree}`];
      return execFileSync("git", [...(user ? ["-c", "core.quotepath=false"] : pinned), ...attributes, ...args], {
        cwd: options.cwd ?? repositoryRoot, env: { ...process.env, ...(user ? {} : { GIT_ATTR_NOSYSTEM: "1" }), ...options.env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"], ...(options.input === undefined ? {} : { input: options.input }),
      });
    } catch (error) {
      const failed = error as { status?: number | null; stdout?: string; stderr?: string; message: string };
      throw new GitCommandError(`git ${args.join(" ")} failed: ${(failed.stderr ?? "").trim() || failed.message}`, failed.status ?? null, failed.stdout ?? "", failed.stderr ?? "");
    }
  };
  return (args, options = {}) => {
    if (options.worktree !== undefined) return run(["-C", options.worktree, ...args], options);
    gitFolder ??= run(["rev-parse", "--absolute-git-dir"]).trim();
    return run([`--git-dir=${gitFolder}`, ...args], options);
  };
}
