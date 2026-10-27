import { existsSync } from "node:fs";
import { join } from "node:path";
import { compiledFolders } from "../compiled-source.js";
import { SetupError } from "../host/setup-error.js";
import type { BranchGit } from "../git/branch-git.js";
import type { Worktrees } from "../git/worktrees.js";

/** The trailers a fix commit carries; `Repair-Record` identifies its attempt. */
export type FixTrailers = { readonly thread: string; readonly cluster: string; readonly record: string };

/** The accepted branch of a thread: fix commits made in widening worktrees, moved by compare-and-swap and never through the repository's working tree. */
export class AcceptedBranch {
  constructor(private readonly git: BranchGit, readonly threadId: string) {}

  get ref(): string {
    return `refs/heads/accepted/${this.threadId}`;
  }

  /** The branch's commit, or null when it does not exist. */
  tip(): string | null {
    const found = this.git(["for-each-ref", "--format=%(objectname)", this.ref]).trim();
    return found.length === 0 ? null : found;
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
  readonly worktrees: Worktrees;
  /** The branch's commit before this promotion, or null before the thread's first one. */
  readonly accepted: string | null;
  /** The commit the widened worktree started at: the accepted commit, or the thread's source commit before the first promotion. */
  readonly start: string;
  /** The widened worktree, with the attempt's change (and the archived fix change) applied. */
  readonly worktree: string;
  readonly trailers: FixTrailers;
  readonly summary: string;
};

/**
 * Commits the widened worktree on its branch and moves the accepted branch to that commit; returns the commit. A branch
 * whose tip already carries the attempt's record was moved before an interruption, and its tip is the promotion; a
 * worktree whose HEAD carries it was committed before one, and its HEAD is the fix. Any other tip than the accepted
 * commit is a setup error. A worktree whose `Chummer/` and `Core/` stage the start's gives null: there is nothing to commit.
 */
export function promote(promotion: Promotion): string | null {
  const { branch, worktrees, trailers, worktree } = promotion;
  const tip = branch.tip();
  if (tip !== null && branch.repairRecord(tip) === trailers.record) return tip;
  if (tip !== promotion.accepted) {
    throw new SetupError(`${branch.ref} is at ${tip ?? "nothing"}, not at the accepted ${promotion.accepted ?? "nothing"}; something else moved it or it was deleted, and a thread that can still be resumed needs the branch where it left it.`);
  }
  for (const folder of compiledFolders) {
    if (!existsSync(join(worktree, folder))) throw new SetupError(`${worktree} has no ${folder}/, which the candidate is compiled from.`);
  }
  const head = worktrees.head(worktree);
  let fix: string;
  if (head !== promotion.start) {
    // Only the promotion's own commit, made on the start before an interruption, may be on the worktree's branch.
    if (worktrees.trailer(head, "Repair-Record") !== trailers.record || worktrees.parent(head) !== promotion.start) {
      throw new SetupError(`The widened worktree ${worktree} is at ${head}, not at its start ${promotion.start}; a commit that is not this promotion's was made on its branch, and nothing is promoted.`);
    }
    fix = head;
  } else {
    worktrees.stage(worktree);
    if (worktrees.stagedAgainst(worktree, promotion.start, compiledFolders).length === 0) return null;
    fix = worktrees.commitStaged(worktree, fixMessage(trailers, promotion.summary));
  }
  branch.move(fix, tip);
  return fix;
}

export function fixMessage(trailers: FixTrailers, summary: string): string {
  return `Fix discrepancy ${trailers.cluster}\n\n${summary.trim()}\n\nWorkflow-Thread: ${trailers.thread}\nDiscrepancy: ${trailers.cluster}\nRepair-Record: ${trailers.record}\n`;
}
