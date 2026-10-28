import { SetupError } from "../host/setup-error.js";
import { GitCommandError, type BranchGit } from "./branch-git.js";
import { sourceSubjectPrefix } from "./thread-source.js";
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
  /** The merge commit, or null when nothing was merged (or the fix commit is part of the branch's history already). */
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

/** The files the thread's source commit changed on its parent when it captured working-tree edits; none for a commit of the repository's own. */
function sourceEdits(git: BranchGit, source: string): string[] {
  const subject = git(["log", "-1", "--format=%s", source]).trim();
  if (!subject.startsWith(sourceSubjectPrefix)) return [];
  return git(["diff-tree", "-r", "--no-renames", "--name-only", `${source}^`, source]).split(/\r?\n/).filter((path) => path.length > 0);
}

/**
 * The files the thread's source commit changed that `tip` holds in another state than `verified` does: the fixes were
 * verified on top of those edits, so `verified` is the source or the last fix merged before.
 */
function missingEdits(git: BranchGit, source: string, verified: string, tip: string): string[] {
  return sourceEdits(git, source).filter((path) => {
    const wanted = git(["ls-tree", verified, "--", path]).trim().split(/\s+/)[2] ?? null;
    const held = git(["ls-tree", tip, "--", path]).trim().split(/\s+/)[2] ?? null;
    return wanted !== held;
  });
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
  // The first fix was made on the thread's source. When that captured edits the repository's commits lack, the fixes
  // cannot be merged until the branch has them: the merged branch would not be the state the fixes were verified on.
  // A resumed merge checks it again, against the state its last merged fix was verified on, since that fix may have changed an edited file.
  const lastMerged = request.items.map((item) => mergedBefore(item) !== null).lastIndexOf(true);
  const unmergedEdits = request.items.every((item) => mergedBefore(item) !== null)
    ? []
    : missingEdits(git, worktrees.parent(request.items[0]!.commit), request.items[lastMerged]?.commit ?? worktrees.parent(request.items[0]!.commit), before);
  if (unmergedEdits.length > 0) {
    blocked = `the thread's source held edits of ${unmergedEdits.join(", ")} that ${request.branch} lacks`;
  }
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
        items.push({
          name: item.name, status: "blocked", branch: item.branch, mergeCommit: null, files: [],
          reason: unmergedEdits.length > 0 ? `${blocked}; commit them first (the fixes were verified on top of them)` : `${blocked} did not merge, and this change was verified on top of it`,
        });
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
        // The replay was dropped: the branch has the change. The fix still gets a merge commit of its own with the
        // branch's tree, so that the trailer marks the merge. Its second parent is the fix commit, or the commit the
        // fix was made on when the branch is at the fix commit itself (a merge needs two parents that differ). The
        // fix's branch goes back to the fix commit, which the rebase moved.
        git(["update-ref", "-m", `workflow: keep ${item.commit} on ${item.branch}`, `refs/heads/${item.branch}`, item.commit, rebased]);
        const recorded = inWorktree(["commit-tree", `${tip}^{tree}`, "-p", tip, "-p", item.commit === tip ? parent : item.commit, ...message(item)]).trim();
        inWorktree(["checkout", "--quiet", "--detach", recorded]);
        tip = recorded;
        items.push({ name: item.name, status: "merged", branch: item.branch, mergeCommit: recorded, reason: `${request.branch} has the change already; the merge commit records the fix without changing the tree`, files: [] });
        continue;
      }
      inWorktree(["merge", "--quiet", "--no-ff", "--no-edit", ...message(item), item.branch]);
      tip = worktrees.head(request.worktree);
      // A commit hook may have rewritten the message: without its trailer a repeated merge would not find this one.
      if (worktrees.trailer(tip, item.trailer.key) !== item.trailer.value) {
        throw new SetupError(`The merge commit ${tip} of ${item.name} does not carry ${item.trailer.key}: ${item.trailer.value}; a commit hook may have changed its message. ${request.branch} was not advanced.`);
      }
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
    // The checkout is a person's: its files are written with their line-ending settings and attributes.
    else git(["merge", "--quiet", "--ff-only", tip], { worktree: holder.folder, userSettings: true });
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
    // The full name: a short one is ambiguous (`heads/main`) when a tag has the branch's name.
    const ref = git(["symbolic-ref", "--quiet", "HEAD"]).trim();
    if (!ref.startsWith("refs/heads/")) throw new SetupError(`HEAD names ${ref}, which is not a branch.`);
    return { branch: ref.slice("refs/heads/".length), commit };
  } catch (error) {
    if (error instanceof GitCommandError && error.status === 1) return { branch: null, commit };
    throw error;
  }
}
