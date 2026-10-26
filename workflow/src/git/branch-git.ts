import { execFileSync } from "node:child_process";
import { SetupError } from "../host/setup-error.js";

export type GitOptions = {
  /** The working folder of the command, by default the repository's root. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
  /** Runs the command in this worktree of the repository instead of with the repository's own git folder. */
  readonly worktree?: string;
};

/** Runs git and returns its standard output; a non-zero exit throws `GitCommandError`. */
export type BranchGit = (args: readonly string[], options?: GitOptions) => string;

/** A git command that exited with a non-zero status; a setup error unless the caller expects it. */
export class GitCommandError extends SetupError {
  constructor(message: string, readonly status: number | null, readonly stdout: string, readonly stderr: string) {
    super(message);
  }
}

/** Settings every command gets, so the machine's configuration cannot quote paths or change line endings of the diff text. */
const pinned = ["-c", "core.quotepath=false"];

/**
 * The repository's git: commands run with its git folder (found once) in `cwd`, or in a worktree when `worktree` is given,
 * where git finds the worktree's own git folder.
 */
export function processBranchGit(repositoryRoot: string): BranchGit {
  let gitFolder: string | null = null;
  const run = (args: readonly string[], options: GitOptions = {}) => {
    try {
      return execFileSync("git", [...pinned, ...args], {
        cwd: options.cwd ?? repositoryRoot, env: { ...process.env, ...options.env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
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
