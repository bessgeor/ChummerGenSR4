import { SetupError } from "../host/setup-error.js";
import { GitCommandError, type BranchGit } from "./branch-git.js";
import type { Worktrees } from "./worktrees.js";

/** One commit to merge: rebased from its parent onto the branch's tip as `branch`, then merged with a merge commit. */
export type MergeItem = {
  readonly name: string;
  readonly commit: string;
  /** The branch the rebased commit is kept on. */
  readonly branch: string;
  /** The merge commit's subject and body. */
  readonly subject: string;
  /** The trailer that marks the merge commit; a merge whose trailer the branch already reaches is not made again. */
  readonly trailer: { readonly key: string; readonly value: string };
  /** More trailers of the merge commit. */
  readonly trailers: readonly { readonly key: string; readonly value: string }[];
};

export type ItemMerge = {
  readonly name: string;
  readonly status: "merged" | "conflict" | "blocked";
  readonly branch: string;
  /** The merge commit, or null when nothing was merged (or the change was on the branch already). */
  readonly mergeCommit: string | null;
  /** Why it was not merged, or what made a merge unnecessary. */
  readonly reason: string | null;
  /** The files a conflicting rebase could not merge. */
  readonly files: readonly string[];
};

export type Integration = {
  readonly branch: string;
  /** The branch's commit before the merges and after them. */
  readonly before: string;
  readonly after: string;
  /** The branch the merged tip is kept on before the branch is advanced; null when nothing was merged. */
  readonly integrationBranch: string | null;
  readonly items: readonly ItemMerge[];
};

export type IntegrationRequest = {
  /** The branch the commits are merged into. */
  readonly branch: string;
  readonly items: readonly MergeItem[];
  /** A folder for the merge worktree, removed afterwards. */
  readonly worktree: string;
  /** Where the merged tip is kept before the branch is advanced. */
  readonly integrationBranch: string;
};

/** The values of a trailer on the commits `tip` reaches, each with the newest commit that carries it. */
function reachableTrailers(git: BranchGit, tip: string, key: string): Map<string, string> {
  const found = new Map<string, string>();
  const text = git(["log", "--format=%H%x1f%(trailers:key=" + key + ",valueonly,separator=%x1d)%x1e", tip]);
  for (const entry of text.split("\x1e")) {
    const [commit, values] = entry.trim().split("\x1f");
    if (commit === undefined || values === undefined || commit.length === 0) continue;
    for (const value of values.split("\x1d").map((item) => item.trim()).filter((item) => item.length > 0)) {
      if (!found.has(value)) found.set(value, commit);
    }
  }
  return found;
}

function message(item: MergeItem): string[] {
  const trailers = [...item.trailers, item.trailer].map((trailer) => `${trailer.key}: ${trailer.value}`).join("\n");
  return ["-m", item.subject, "-m", trailers];
}

/**
 * Merges each item, in order, into `branch`: rebased from its parent onto the current tip and merged with a merge commit
 * of its own, in a detached worktree. A rebase that conflicts is aborted, and that item and every later one are not
 * merged. An item whose trailer the branch already reaches was merged before (a resumed merge) and is not merged again.
 * The merged tip is kept on the integration branch, then the branch is advanced to it: by a fast-forward of the worktree
 * that has it checked out, or by a compare-and-swap ref update. A branch that moved meanwhile, or a fast-forward git
 * refuses, is a setup error naming the integration branch.
 */
export function integrate(git: BranchGit, worktrees: Worktrees, request: IntegrationRequest): Integration {
  const ref = `refs/heads/${request.branch}`;
  const before = worktrees.resolve(ref);
  if (before === null) throw new SetupError(`The branch ${request.branch} does not exist, so nothing can be merged into it.`);
  const done = new Map<string, Map<string, string>>();
  const mergedBefore = (item: MergeItem) => {
    if (!done.has(item.trailer.key)) done.set(item.trailer.key, reachableTrailers(git, before, item.trailer.key));
    return done.get(item.trailer.key)!.get(item.trailer.value) ?? null;
  };
  const items: ItemMerge[] = [];
  let tip = before;
  let blocked: string | null = null;
  worktrees.remove(request.worktree);
  worktrees.addDetached(request.worktree, before);
  const inWorktree = (args: readonly string[]) => git(args, { worktree: request.worktree });
  try {
    for (const item of request.items) {
      const existing = mergedBefore(item);
      if (existing !== null) {
        items.push({ name: item.name, status: "merged", branch: item.branch, mergeCommit: existing, reason: "merged before", files: [] });
        continue;
      }
      if (blocked !== null) {
        items.push({ name: item.name, status: "blocked", branch: item.branch, mergeCommit: null, reason: `${blocked} did not merge, and this change was verified on top of it`, files: [] });
        continue;
      }
      const parent = worktrees.parent(item.commit);
      inWorktree(["checkout", "--quiet", "-B", item.branch, item.commit]);
      try {
        // Pinned against the user's configuration: no other branch that points at the commit may move with it.
        inWorktree(["rebase", "--quiet", "--no-autosquash", "--no-update-refs", "--onto", tip, parent]);
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error;
        const files = inWorktree(["diff", "--name-only", "--diff-filter=U"]).split(/\r?\n/).filter((path) => path.length > 0);
        inWorktree(["rebase", "--abort"]);
        // A rebase that stopped with no file to resolve did not conflict: it failed, and that is not a result of the merge.
        if (files.length === 0) throw error;
        inWorktree(["checkout", "--quiet", "--detach", tip]);
        blocked = item.name;
        items.push({ name: item.name, status: "conflict", branch: item.branch, mergeCommit: null, reason: `the rebase onto ${request.branch} conflicts${files.length === 0 ? "" : ` in ${files.join(", ")}`}`, files });
        continue;
      }
      const rebased = worktrees.head(request.worktree);
      inWorktree(["checkout", "--quiet", "--detach", tip]);
      if (rebased === tip) {
        items.push({ name: item.name, status: "merged", branch: item.branch, mergeCommit: null, reason: `${request.branch} has the change already`, files: [] });
        continue;
      }
      inWorktree(["merge", "--quiet", "--no-ff", "--no-edit", ...message(item), item.branch]);
      tip = worktrees.head(request.worktree);
      items.push({ name: item.name, status: "merged", branch: item.branch, mergeCommit: tip, reason: null, files: [] });
    }
  } finally {
    worktrees.remove(request.worktree);
  }
  if (tip === before) return { branch: request.branch, before, after: before, integrationBranch: null, items };
  git(["update-ref", "-m", `workflow: merges into ${request.branch}`, `refs/heads/${request.integrationBranch}`, tip]);
  const now = worktrees.resolve(ref);
  if (now !== before) {
    throw new SetupError(`${request.branch} moved to ${now ?? "nothing"} while the merges were made on ${before}; they are kept on ${request.integrationBranch}. Resume the thread to merge onto the new tip.`);
  }
  const holder = worktrees.list().find((item) => item.branch === request.branch);
  try {
    if (holder === undefined) git(["update-ref", "-m", `workflow: merges into ${request.branch}`, ref, tip, before]);
    else git(["merge", "--quiet", "--ff-only", tip], { worktree: holder.folder });
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    throw new SetupError(`${request.branch} could not be advanced to the merges kept on ${request.integrationBranch}: ${error.message}. Commit or stash the local changes, then resume.`);
  }
  return { branch: request.branch, before, after: tip, integrationBranch: request.integrationBranch, items };
}

/** The branch `HEAD` names (null when `HEAD` is detached) and its commit. */
export type HeadBranch = { readonly branch: string | null; readonly commit: string };

/** The branch `HEAD` names and its commit; the branch is null when `HEAD` is detached. */
export function headBranch(git: BranchGit): HeadBranch {
  const commit = git(["rev-parse", "HEAD"]).trim();
  try {
    return { branch: git(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim(), commit };
  } catch (error) {
    if (error instanceof GitCommandError && error.status === 1) return { branch: null, commit };
    throw error;
  }
}
