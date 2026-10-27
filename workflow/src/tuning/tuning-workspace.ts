import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { GitCommandError, type BranchGit } from "../git/branch-git.js";
import { headBranch, integrate } from "../git/integration.js";
import { Worktrees } from "../git/worktrees.js";
import { SetupError } from "../host/setup-error.js";

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

export function tuningBranch(cycleId: string): string {
  return `tuning/${cycleId}`;
}

/** The folder's path relative to the repository's root with forward slashes, or null when it lies outside it. */
function insidePath(repositoryRoot: string, folder: string): string | null {
  const path = relative(resolve(repositoryRoot), resolve(folder));
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return path === "" ? "." : null;
  return path.split(sep).join("/");
}

/** The tuning and certificates folders that lie inside the repository, relative to its root. */
export function repositoryPaths(repositoryRoot: string, folders: TuningFolders): string[] {
  const paths = [folders.tuningFolder, folders.certificatesFolder].map((folder) => insidePath(repositoryRoot, folder)).filter((path) => path !== null);
  return [...new Set(paths)];
}

/**
 * What a cycle in a worktree needs of the repository: the branch `HEAD` names (a detached `HEAD` is a setup error) and
 * its tip, and no uncommitted change, untracked file included, in the folders inside the repository, which the cycle
 * would not see; a folder git ignores is a setup error too, as its files could not be committed.
 */
export function requireWorkspaceStart(git: BranchGit, repositoryRoot: string, paths: readonly string[]): { branch: string; commit: string } {
  const head = headBranch(git);
  if (head.branch === null) {
    throw new SetupError(`The tuning folders ${paths.join(" and ")} lie inside the repository, so an automatic tuning merges its files into the branch HEAD names, but HEAD is detached at ${head.commit}. Check out a branch first.`);
  }
  for (const path of paths) {
    try {
      git(["check-ignore", "--quiet", "--no-index", "--", path], { worktree: repositoryRoot });
      throw new SetupError(`The tuning folder ${path} lies inside the repository, but git ignores it, so an automatic tuning could not commit its files. Name a folder git tracks, or one outside the repository.`);
    } catch (error) {
      if (!(error instanceof GitCommandError) || error.status !== 1) throw error;
    }
  }
  const changed = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...paths], { worktree: repositoryRoot }).split("\0").filter((entry) => entry.length > 0);
  if (changed.length > 0) {
    throw new SetupError(`${paths.join(" and ")} ${paths.length === 1 ? "has" : "have"} uncommitted changes (${changed.map((entry) => entry.slice(3)).join(", ")}), which an automatic tuning's cycle would not see: commit or discard them first.`);
  }
  return { branch: head.branch, commit: head.commit };
}

/** The repository's worktrees and branches as an automatic tuning uses them. */
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
  open(cycleId: string, folder: string, folders: TuningFolders, paths: readonly string[]): TuningWorkspace {
    const start = requireWorkspaceStart(this.git, this.repositoryRoot, paths);
    const branch = tuningBranch(cycleId);
    this.worktrees.remove(folder);
    this.worktrees.add(folder, branch, start.commit);
    const mapped = (path: string) => {
      const inside = insidePath(this.repositoryRoot, path);
      return inside === null ? path : join(folder, inside);
    };
    return {
      target: start.branch, start: start.commit, branch, folder, paths: [...paths],
      folders: { tuningFolder: mapped(folders.tuningFolder), certificatesFolder: mapped(folders.certificatesFolder) },
    };
  }

  /** The worktree must still be the repository's worktree on its branch: a cycle step never writes into a folder that is not. */
  requireWorktree(workspace: TuningWorkspace): void {
    const state = this.worktrees.state(workspace.folder);
    if (state.gitFile === null || state.branch !== workspace.branch) {
      throw new SetupError(`The tuning's worktree ${workspace.folder} on ${workspace.branch} is gone or on ${state.branch ?? "no branch"}, so the cycle's files there are lost; the tuning cannot continue.`);
    }
  }

  /**
   * Commits the changes of the workspace's folders on its branch with `message`, which must carry the commit trailer.
   * Returns the branch's commit of the cycle, or null when nothing changed. Asked again after the commit was made (its
   * node interrupted), it finds that commit on the branch.
   */
  commit(workspace: TuningWorkspace, cycleId: string, message: string): string | null {
    this.requireWorktree(workspace);
    const present = workspace.paths.filter((path) => existsSync(join(workspace.folder, path)) || this.worktrees.missingFolders(workspace.start, [path]).length === 0);
    if (present.length > 0) {
      const ignored = this.git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...present], { worktree: workspace.folder }).split("\0").filter((path) => path.length > 0);
      if (ignored.length > 0) throw new SetupError(`The tuning wrote files that git ignores in ${workspace.folder} (${ignored.join(", ")}), so they cannot be committed on ${workspace.branch}.`);
      this.git(["add", "--all", "--", ...present], { worktree: workspace.folder });
      if (this.git(["diff", "--cached", "--name-only"], { worktree: workspace.folder }).trim().length > 0) this.worktrees.commitStaged(workspace.folder, message);
    }
    const tip = this.worktrees.head(workspace.folder);
    return tip !== workspace.start && this.worktrees.trailer(tip, tuningCommitTrailer) === cycleId ? tip : null;
  }

  /** Removes the worktree; its branch stays. Nothing happens when it is gone already. */
  remove(workspace: TuningWorkspace): void {
    this.worktrees.remove(workspace.folder);
  }

  /**
   * Merges the cycle's commit, the tip of its branch, into the workspace's target: rebased onto the target's tip as the
   * tuning branch and merged with a merge commit carrying `Merged-Tuning: <cycle>`, then the target is advanced. Returns
   * the merge commit, or the one that merged the cycle before (null when the target has the changes already), and the
   * rebased commit. A conflict is a setup error naming the branch.
   */
  merge(workspace: TuningWorkspace, cycleId: string, mergeFolder: string, subject: string, trailers: readonly { key: string; value: string }[]): { merge: string | null; commit: string } {
    const commit = this.worktrees.resolve(`refs/heads/${workspace.branch}`);
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
    return { merge: item.mergeCommit, commit: this.worktrees.resolve(`refs/heads/${workspace.branch}`)! };
  }
}
