import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { certificatePath } from "../evals/certificate.js";
import { evaluatedJobKinds } from "../evals/evaluated-job-kinds.js";
import { GitCommandError, type BranchGit } from "../git/branch-git.js";
import { headBranch, integrate } from "../git/integration.js";
import { Worktrees } from "../git/worktrees.js";
import { SetupError } from "../host/setup-error.js";
import { tuningFiles } from "./active-configuration.js";

/** The tuning and certificates folders a cycle reads and writes. */
export type TuningFolders = { readonly tuningFolder: string; readonly certificatesFolder: string };

/**
 * The worktree an automatic tuning's cycle works in: on `branch` (`tuning/<cycle>`), started at `start`, the tip of
 * `target`, the branch `HEAD` named. `paths` are the folders inside the repository, relative to its root with forward
 * slashes; `folders` are the cycle's folders, those inside the repository mapped into the worktree.
 */
export type TuningWorkspace = {
  readonly target: string;
  readonly start: string;
  readonly branch: string;
  readonly folder: string;
  readonly paths: readonly string[];
  readonly folders: TuningFolders;
};

/** The trailer of a tuning's commit on its branch, and of the merge commit that merges it. */
export const tuningCommitTrailer = "Tuning-Cycle";
export const mergedTuningTrailer = "Merged-Tuning";

/** The temporary files `writeDocument` renames into place; one a stopped process left behind is never committed. */
const temporarySuffix = ".tmp";

export function tuningBranch(cycleId: string): string {
  return `tuning/${cycleId}`;
}

/** A path relative to the repository's root with forward slashes, or null when it lies outside it. */
function insidePath(repositoryRoot: string, path: string): string | null {
  const inside = relative(resolve(repositoryRoot), resolve(path));
  if (inside === "") return ".";
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  return inside.split(sep).join("/");
}

/** The tuning and certificates folders that lie inside the repository, relative to its root. */
export function repositoryPaths(repositoryRoot: string, folders: TuningFolders): string[] {
  const paths = [folders.tuningFolder, folders.certificatesFolder].map((folder) => insidePath(repositoryRoot, folder)).filter((path) => path !== null);
  return [...new Set(paths)];
}

/** The files a cycle writes in its folders: the ledger, the active files and the certificates of every job kind. */
function cycleFiles(folders: TuningFolders): string[] {
  const files = tuningFiles(folders.tuningFolder);
  return [files.holdout, ...evaluatedJobKinds.map((jobKind) => files.active(jobKind)), ...evaluatedJobKinds.map((jobKind) => certificatePath(folders.certificatesFolder, jobKind))];
}

/**
 * What a cycle in a worktree needs of the repository, read with the user's git configuration as the checkout was made:
 * the branch `HEAD` names (a detached `HEAD` is a setup error) and its tip; no file the cycle writes in the folders
 * inside the repository that git ignores, as it could not be committed; and no uncommitted change in those folders,
 * untracked files included, which the cycle would not see.
 */
export function requireWorkspaceStart(git: BranchGit, repositoryRoot: string, folders: TuningFolders): { branch: string; commit: string; paths: string[] } {
  const paths = repositoryPaths(repositoryRoot, folders);
  const checkoutGit: BranchGit = (args, options = {}) => git(args, { worktree: repositoryRoot, ...options, userSettings: true });
  const head = headBranch(checkoutGit);
  if (head.branch === null) {
    throw new SetupError(`The tuning folders ${paths.join(" and ")} lie inside the repository, so an automatic tuning merges its files into the branch HEAD names, but HEAD is detached at ${head.commit}. Check out a branch first.`);
  }
  const files = cycleFiles(folders).map((file) => insidePath(repositoryRoot, file)).filter((file) => file !== null);
  let ignored: string[] = [];
  try {
    ignored = checkoutGit(["check-ignore", "-z", "--stdin"], { input: `${files.join("\0")}\0` }).split("\0").filter((file) => file.length > 0);
  } catch (error) {
    // Exit status 1: none of them is ignored.
    if (!(error instanceof GitCommandError) || error.status !== 1) throw error;
  }
  if (ignored.length > 0) {
    throw new SetupError(`git ignores ${ignored.join(", ")}, which an automatic tuning writes inside the repository and so could not commit. Name folders git tracks, or folders outside the repository.`);
  }
  const changed = checkoutGit(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...paths]).split("\0").filter((entry) => entry.length > 0);
  if (changed.length > 0) {
    throw new SetupError(`${paths.join(" and ")} ${paths.length === 1 ? "has" : "have"} uncommitted changes (${changed.map((entry) => entry.slice(3)).join(", ")}), which an automatic tuning's cycle would not see: commit or discard them first.`);
  }
  return { branch: head.branch, commit: head.commit, paths };
}

/** A dataset version's folder as its name and version, without the machine's path: `auto-hypothesis v3`. */
export function datasetLabel(folder: string): string {
  return `${basename(dirname(folder))} ${basename(folder)}`;
}

/**
 * The repository's worktrees and branches as an automatic tuning uses them: its own worktrees with the pinned git, the
 * user's checkout with the user's git configuration.
 */
export class TuningRepository {
  private readonly worktrees: Worktrees;

  constructor(private readonly git: BranchGit, private readonly repositoryRoot: string) {
    this.worktrees = new Worktrees(git, repositoryRoot);
  }

  /** The folders inside the repository, and null when both lie outside it: then the cycle works on them in place. */
  paths(folders: TuningFolders): string[] | null {
    const paths = repositoryPaths(this.repositoryRoot, folders);
    return paths.length === 0 ? null : paths;
  }

  /**
   * Adds the worktree at `folder` on `tuning/<cycle>` at the tip of the branch `HEAD` names. A worktree that is there
   * already (its node interrupted after it was made, before any step used it) is made again.
   */
  open(cycleId: string, folder: string, folders: TuningFolders): TuningWorkspace {
    const start = requireWorkspaceStart(this.git, this.repositoryRoot, folders);
    const branch = tuningBranch(cycleId);
    this.worktrees.remove(folder);
    this.worktrees.addPartial(folder, branch, start.commit, start.paths);
    const mapped = (path: string) => {
      const inside = insidePath(this.repositoryRoot, path);
      return inside === null ? path : join(folder, inside);
    };
    return {
      target: start.branch, start: start.commit, branch, folder, paths: start.paths,
      folders: { tuningFolder: mapped(folders.tuningFolder), certificatesFolder: mapped(folders.certificatesFolder) },
    };
  }

  /** The worktree must still be the repository's worktree on its branch: a cycle step never writes into a folder that is not. */
  requireWorktree(workspace: TuningWorkspace): void {
    const state = this.worktrees.state(workspace.folder);
    if (state.gitFile === null || state.branch !== workspace.branch) {
      throw new SetupError(`The tuning's worktree ${workspace.folder} on ${workspace.branch} is gone or on ${state.branch ?? "no branch"}, so the cycle's files there are lost and the tuning cannot continue. If the branch is still there, run 'git worktree prune' and then 'git worktree add ${workspace.folder} ${workspace.branch}' to give the cycle its worktree back, then run tune auto again.`);
    }
  }

  /**
   * Commits the changes of the workspace's folders on its branch with `message`, which must carry the commit trailer.
   * Returns the branch's commit of the cycle, or null when nothing changed. Asked again after the commit was made (its
   * node interrupted), it finds that commit on the branch.
   */
  commit(workspace: TuningWorkspace, cycleId: string, message: string): string | null {
    this.requireWorktree(workspace);
    // A folder neither the worktree nor the start has is no pathspec git accepts, and has nothing to commit.
    const present = workspace.paths.filter((path) => existsSync(join(workspace.folder, path)) || this.worktrees.missingFolders(workspace.start, [path]).length === 0);
    if (present.length > 0) {
      this.worktrees.stage(workspace.folder, present);
      const staged = this.git(["diff", "--cached", "--name-only", "-z"], { worktree: workspace.folder }).split("\0").filter((path) => path.length > 0);
      const temporary = staged.filter((path) => path.endsWith(temporarySuffix));
      if (temporary.length > 0) this.git(["rm", "--cached", "--quiet", "--", ...temporary], { worktree: workspace.folder });
      if (staged.length > temporary.length) this.worktrees.commitStaged(workspace.folder, message);
    }
    const tip = this.worktrees.head(workspace.folder);
    if (tip === workspace.start) return null;
    const trailer = this.worktrees.trailer(tip, tuningCommitTrailer);
    if (trailer !== cycleId) {
      throw new SetupError(`The tip of ${workspace.branch} (${tip}) moved from the start ${workspace.start} but does not carry ${tuningCommitTrailer}: ${cycleId}${trailer === null ? "" : ` (it has ${trailer})`}; a commit hook may have changed the message. The cycle's files stay on ${workspace.branch} and are not merged.`);
    }
    return tip;
  }

  /** Removes the worktree; its branch stays. Nothing happens when it is gone already. */
  remove(workspace: TuningWorkspace): void {
    this.worktrees.remove(workspace.folder);
  }

  /**
   * Merges the cycle's commit, the tip of its branch, into the workspace's target: rebased onto the target's tip as the
   * tuning branch and merged with a merge commit carrying `Merged-Tuning: <cycle>`, then the target is advanced, a
   * checkout of it by a fast-forward with the user's git configuration. Returns the merge commit, or the one that merged
   * the cycle before, and the commit the branch keeps. When the target has the changes already, the rebase drops the
   * commit as empty: the merge commit then has the target's tree and the cycle's own commit as its second parent, and
   * the branch keeps that commit. A conflict is a setup error naming the branch.
   */
  merge(workspace: TuningWorkspace, cycleId: string, mergeFolder: string, subject: string, trailers: readonly { key: string; value: string }[]): { merge: string; commit: string } {
    const ref = `refs/heads/${workspace.branch}`;
    const commit = this.worktrees.resolve(ref);
    if (commit === null || this.worktrees.trailer(commit, tuningCommitTrailer) !== cycleId) {
      throw new SetupError(`The tuning branch ${workspace.branch} does not end with the commit of cycle ${cycleId} (${tuningCommitTrailer}: ${cycleId}).`);
    }
    const result = integrate(this.git, this.worktrees, {
      branch: workspace.target, worktree: mergeFolder, integrationBranch: `${workspace.branch}-merge`,
      items: [{ name: cycleId, commit, branch: workspace.branch, subject, trailer: { key: mergedTuningTrailer, value: cycleId }, trailers }],
    });
    const item = result.items[0]!;
    if (item.status !== "merged") {
      throw new SetupError(`The tuning branch ${workspace.branch} does not merge into ${workspace.target}: ${item.reason ?? item.status}. `
        + `Rebase ${workspace.branch} onto ${workspace.target} and resolve the conflict, keeping its commit message, then run tune auto again.`);
    }
    if (item.mergeCommit === null) {
      throw new SetupError(`The merge of ${workspace.branch} into ${workspace.target} made no merge commit.`);
    }
    return { merge: item.mergeCommit, commit: this.worktrees.resolve(ref)! };
  }
}
