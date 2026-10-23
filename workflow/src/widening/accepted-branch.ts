import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compiledFolders } from "../compiled-source.js";
import { SetupError } from "../host/setup-error.js";

/** Runs git with the repository's git folder, in `cwd`, with extra environment variables, and returns its standard output. */
export type BranchGit = (args: readonly string[], options?: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>>; readonly input?: string }) => string;

export function processBranchGit(repositoryRoot: string): BranchGit {
  let gitFolder: string | null = null;
  const run = (args: readonly string[], options: { cwd?: string; env?: Readonly<Record<string, string>>; input?: string } = {}) => {
    try {
      return execFileSync("git", args, {
        cwd: options.cwd ?? repositoryRoot, env: { ...process.env, ...options.env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
        ...(options.input === undefined ? {} : { input: options.input }),
      });
    } catch (error) {
      throw new SetupError(`git ${args.join(" ")} failed: ${(error as Error).message}`);
    }
  };
  return (args, options = {}) => {
    gitFolder ??= run(["rev-parse", "--absolute-git-dir"]).trim();
    return run([`--git-dir=${gitFolder}`, ...args], options);
  };
}

/** The trailers a fix commit carries; `Repair-Record` identifies its attempt. */
export type FixTrailers = { readonly thread: string; readonly cluster: string; readonly record: string };

/** The accepted branch of a thread: commits of accepted source, made with a private index and never through the working tree. */
export class AcceptedBranch {
  constructor(private readonly git: BranchGit, readonly threadId: string, private readonly indexFile: string) {}

  get ref(): string {
    return `refs/heads/accepted/${this.threadId}`;
  }

  /** The branch's commit, or null when it does not exist. */
  tip(): string | null {
    const found = this.git(["for-each-ref", "--format=%(objectname)", this.ref]).trim();
    return found.length === 0 ? null : found;
  }

  /**
   * A commit on `parent` whose `Chummer/` and `Core/` (and the other `paths` of `sourceFolder`) are those of `sourceFolder`,
   * staged as `git add` would, or null when the staged tree is the parent's own tree within `changing` (the `paths` by
   * default): a folder staged only to accompany the change does not make it one. A compiled folder that `sourceFolder`
   * lacks is a setup error, since the source cannot be built without it; any other path that it lacks fails in git.
   */
  commitSource(parent: string, sourceFolder: string, message: string, paths: readonly string[] = compiledFolders, changing: readonly string[] = paths): string | null {
    const env = { GIT_INDEX_FILE: this.indexFile };
    try {
      this.git(["read-tree", parent], { env });
      for (const folder of compiledFolders) {
        if (paths.includes(folder) && !existsSync(join(sourceFolder, folder))) throw new SetupError(`${sourceFolder} has no ${folder}/, which the candidate is compiled from.`);
      }
      this.git([`--work-tree=${sourceFolder}`, "add", "--all", "--", ...paths], { cwd: sourceFolder, env });
      const tree = this.git(["write-tree"], { env }).trim();
      const changed = this.git(["diff-tree", "-r", "--name-only", `${parent}^{tree}`, tree, "--", ...changing]).trim();
      if (changed.length === 0) return null;
      return this.git(["commit-tree", tree, "-p", parent, "-F", "-"], { env, input: message }).trim();
    } finally {
      rmSync(this.indexFile, { force: true });
    }
  }

  /** Moves the branch from `expected` (null: it must not exist) to `commit`; another value of the branch fails. */
  move(commit: string, expected: string | null): void {
    this.git(["update-ref", "-m", `workflow: accept ${commit}`, this.ref, commit, expected ?? ""]);
  }

  /** Whether the branch's tip carries a repair record: a promotion of that attempt was committed before an interruption. */
  promotedRecord(record: string): boolean {
    const tip = this.tip();
    return tip !== null && this.repairRecord(tip) === record;
  }

  /** The `Repair-Record` trailer of a commit, or null when it has none. */
  repairRecord(commit: string): string | null {
    const value = this.git(["log", "-1", "--format=%(trailers:key=Repair-Record,valueonly)", commit]).trim();
    return value.length === 0 ? null : value;
  }
}

export type Promotion = {
  readonly branch: AcceptedBranch;
  /** The commit the thread's snapshot was taken on. */
  readonly base: string;
  /** The branch's commit before this promotion, or null before the thread's first one. */
  readonly accepted: string | null;
  readonly snapshotFolder: string;
  readonly widenedSource: string;
  readonly trailers: FixTrailers;
  readonly summary: string;
  /** Folders of the widened source the fix commit holds besides `Chummer/` and `Core/`, such as the archived fix change. */
  readonly alsoCommitted?: readonly string[];
};

/**
 * Commits the widened source on the accepted branch and returns the commit. The first promotion starts the branch at
 * the snapshot's commit, with a commit of the snapshot's `Chummer/` and `Core/` when they differ. A branch whose tip already
 * carries the attempt's record was moved before an interruption, and its tip is the promotion; any other tip than
 * the accepted commit is a setup error. A widened source that stages the accepted tree gives null: there is nothing to
 * commit.
 */
export function promote(promotion: Promotion): string | null {
  const { branch, trailers } = promotion;
  const tip = branch.tip();
  if (tip !== null && branch.repairRecord(tip) === trailers.record) return tip;
  if (tip !== promotion.accepted) {
    throw new SetupError(`${branch.ref} is at ${tip ?? "nothing"}, not at the accepted ${promotion.accepted ?? "nothing"}; something else moved it or it was deleted, and a thread that can still be resumed needs the branch where it left it.`);
  }
  const parent = promotion.accepted ?? branch.commitSource(promotion.base, promotion.snapshotFolder, sourceMessage(branch.threadId)) ?? promotion.base;
  const fix = branch.commitSource(parent, promotion.widenedSource, fixMessage(trailers, promotion.summary), [...compiledFolders, ...(promotion.alsoCommitted ?? [])], compiledFolders);
  if (fix === null) return null;
  branch.move(fix, tip);
  return fix;
}

export function fixMessage(trailers: FixTrailers, summary: string): string {
  return `Fix discrepancy ${trailers.cluster}\n\n${summary.trim()}\n\nWorkflow-Thread: ${trailers.thread}\nDiscrepancy: ${trailers.cluster}\nRepair-Record: ${trailers.record}\n`;
}

export function sourceMessage(threadId: string): string {
  return `Source captured by thread ${threadId}\n\nThe compiled source as the thread's candidate was built from it.\n`;
}
