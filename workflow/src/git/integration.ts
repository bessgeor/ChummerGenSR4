import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createScratchFolder, removalFailure, type ScratchFolder } from "../host/scratch-folder.js";
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

/** What the merges take from their host besides git. */
export type IntegrationHost = {
  /** Where a temporary folder that could not be removed is named; standard error by default. */
  readonly log?: (line: string) => void;
  readonly createScratchFolder?: typeof createScratchFolder;
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

/**
 * The trees of commits as a person's own `git add` on a reference commit would have staged their files: with the machine's
 * and the repository's line-ending settings, the attributes of the reference and its index entries. The reference is the
 * branch's tip unless another is named. A thread's commits hold the bytes of the checkout the candidate was built from,
 * and a clean checkout may hold other bytes than the repository's blobs (CRLF for LF with `core.autocrlf=true`). Only the
 * files a commit holds otherwise than the reference are staged again; without any conversion a commit's tree stays as it
 * is. A file the reference lacks is staged on its entry of the commit the source was captured on, so one the branch
 * renamed keeps the form it had there and its change follows the rename. A commit's file modes are kept.
 */
class Normalizer {
  private readonly trees = new Map<string, string>();
  private scratch: ScratchFolder | null = null;
  private count = 0;

  constructor(private readonly git: BranchGit, private readonly branchTip: string, private readonly start: string, private readonly createFolder: typeof createScratchFolder) {}

  tree(commit: string, reference: string = this.branchTip): string {
    const key = `${reference} ${commit}`;
    const known = this.trees.get(key);
    if (known !== undefined) return known;
    const removed: string[] = [];
    const special: string[] = [];
    const files: string[] = [];
    const lacked: string[] = [];
    // The files whose mode is, or was, executable: their mode in the commit, by path.
    const modes = new Map<string, string>();
    const fields = this.git(["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", reference, commit]).split("\0").filter((field) => field.length > 0);
    for (let index = 0; index + 1 < fields.length; index += 2) {
      // `:<mode> <mode> <blob> <blob> <status>` then the path.
      const [referenceMode, mode, , blob] = fields[index]!.slice(1).split(" ");
      const path = fields[index + 1]!;
      if (mode === "000000") removed.push(path);
      else if (mode === "100644" || mode === "100755") {
        files.push(path);
        if (referenceMode === "000000") lacked.push(path);
        if (mode === "100755" || referenceMode === "100755") modes.set(path, mode);
      } else special.push(`${mode} ${blob}\t${path}`);
    }
    let tree = this.git(["rev-parse", `${commit}^{tree}`]).trim();
    if (files.length > 0) {
      this.scratch ??= this.createFolder("workflow-normalize-");
      const count = ++this.count;
      const staged = join(this.scratch.path, `files-${count}`);
      mkdirSync(staged);
      const env = { GIT_INDEX_FILE: join(this.scratch.path, `index-${count}`) };
      // The commit's bytes as they are, then staged on the reference's index as the person's checkout would stage them.
      this.git(["read-tree", commit], { env });
      this.git(["checkout-index", "--force", "-z", "--stdin", `--prefix=${staged.replace(/\\/g, "/")}/`], { env, input: files.join("\0") });
      this.git(["read-tree", reference], { env });
      if (removed.length > 0) this.git(["update-index", "-z", "--force-remove", "--stdin"], { env, input: removed.join("\0") });
      if (special.length > 0) this.git(["update-index", "-z", "--index-info"], { env, input: special.join("\0") });
      if (lacked.length > 0 && reference !== this.start) {
        const entries = this.git(["--literal-pathspecs", "ls-tree", "-z", "--full-tree", this.start, "--", ...lacked]);
        if (entries.length > 0) this.git(["update-index", "-z", "--index-info"], { env, input: entries });
      }
      // The paths are file names, not patterns; and a conversion `core.safecrlf` would refuse stages the same bytes.
      this.git(["--literal-pathspecs", "-c", "core.safecrlf=false", `--work-tree=${staged}`, "add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"],
        { cwd: staged, env, input: files.join("\0"), userSettings: true, attributeSource: reference });
      if (modes.size > 0) this.keepModes(modes, env);
      tree = this.git(["write-tree"], { env }).trim();
    }
    this.trees.set(key, tree);
    return tree;
  }

  /**
   * Gives the staged entries their commit's mode: `add` keeps the index's mode or takes the file system's. The entries
   * are rewritten by blob, so no file is read, and so converted, again.
   */
  private keepModes(modes: ReadonlyMap<string, string>, env: Record<string, string>): void {
    const entries = this.git(["--literal-pathspecs", "ls-files", "--stage", "-z", "--", ...modes.keys()], { env }).split("\0").filter((entry) => entry.length > 0)
      .map((entry) => {
        const path = entry.slice(entry.indexOf("\t") + 1);
        return `${modes.get(path)!} ${entry.split(" ")[1]!}\t${path}`;
      });
    this.git(["update-index", "-z", "--index-info"], { env, input: entries.join("\0") });
  }

  /** `commit` on `parent`, or when either one's tree converts, commits of the converted trees with `commit`'s message and author. */
  pair(commit: string, parent: string): { readonly commit: string; readonly parent: string } {
    const parentTree = this.tree(parent);
    const tree = this.tree(commit);
    const own = (of: string) => this.git(["rev-parse", `${of}^{tree}`]).trim();
    if (parentTree === own(parent) && tree === own(commit)) return { commit, parent };
    const convertedParent = this.git(["commit-tree", parentTree, "-p", parent, "-F", "-"], { input: `Convert ${parent} as ${this.branchTip} stages it\n` }).trim();
    const [name, email, date] = this.git(["log", "-1", "--format=%an%x00%ae%x00%aI", commit]).trim().split("\0");
    const converted = this.git(["commit-tree", tree, "-p", convertedParent, "-F", "-"], {
      input: this.git(["log", "-1", "--format=%B", commit]), env: { GIT_AUTHOR_NAME: name!, GIT_AUTHOR_EMAIL: email!, GIT_AUTHOR_DATE: date! },
    }).trim();
    return { commit: converted, parent: convertedParent };
  }

  /** Removes the temporary folder; the error naming it when it stays. */
  dispose(): SetupError | null {
    const scratch = this.scratch;
    this.scratch = null;
    return scratch === null ? null : removalFailure(scratch);
  }
}

/** The paths whose entries differ between two trees. */
function differing(git: BranchGit, from: string, to: string): string[] {
  return git(["diff-tree", "-r", "-z", "--no-renames", "--name-only", from, to]).split("\0").filter((path) => path.length > 0);
}

/** The commit a thread's source was captured on: its parent when it holds captured edits, else the source itself. */
function capturedOn(git: BranchGit, source: string): string {
  const subject = git(["log", "-1", "--format=%s", source]).trim();
  return subject.startsWith(sourceSubjectPrefix) ? git(["rev-parse", `${source}^`]).trim() : source;
}

/**
 * The files the thread's source commit changed on the commit it was captured on, as the person's own `git add` on that
 * commit would hold them, whatever the branch gained since: a file the checkout held unchanged is no edit. None for a
 * commit of the repository's own.
 */
function sourceEdits(git: BranchGit, normalized: Normalizer, source: string): string[] {
  const start = capturedOn(git, source);
  return start === source ? [] : differing(git, start, normalized.tree(source, start));
}

/**
 * The files the thread's source commit changed that `tip` holds in another state than `verified` does: the fixes were
 * verified on top of those edits, so `verified` is the source or the last fix merged before.
 */
function missingEdits(git: BranchGit, normalized: Normalizer, source: string, verified: string, tip: string): string[] {
  const edits = sourceEdits(git, normalized, source);
  if (edits.length === 0) return [];
  const changed = new Set(differing(git, normalized.tree(verified), tip));
  return edits.filter((path) => changed.has(path));
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
 * refuses, is a setup error naming the integration branch. An item's branch only ever holds its commit or the rebased one.
 */
export function integrate(git: BranchGit, worktrees: Worktrees, request: IntegrationRequest, host: IntegrationHost = {}): Integration {
  const log = host.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
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
  // The thread's commits are compared and replayed as the branch's own commits would hold their files.
  const start = request.items.length === 0 ? before : capturedOn(git, worktrees.parent(request.items[0]!.commit));
  const normalized = new Normalizer(git, before, start, host.createScratchFolder ?? createScratchFolder);
  const inWorktree = (args: readonly string[]) => git(args, { worktree: request.worktree });
  try {
    const unmergedEdits = request.items.every((item) => mergedBefore(item) !== null)
      ? []
      : missingEdits(git, normalized, worktrees.parent(request.items[0]!.commit), request.items[lastMerged]?.commit ?? worktrees.parent(request.items[0]!.commit), before);
    if (unmergedEdits.length > 0) {
      blocked = `the thread's source held edits of ${unmergedEdits.join(", ")} that ${request.branch} lacks`;
    }
    worktrees.remove(request.worktree);
    worktrees.addDetached(request.worktree, before);
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
      const replayed = normalized.pair(item.commit, parent);
      // The rebase runs detached: the item's branch keeps its commit unless the rebase succeeds, never a converted one.
      inWorktree(["checkout", "--quiet", "-B", item.branch, item.commit]);
      inWorktree(["checkout", "--quiet", "--detach", replayed.commit]);
      try {
        // Pinned against the user's configuration: no other branch that points at the commit may move with it.
        inWorktree(["rebase", "--quiet", "--no-autosquash", "--no-update-refs", "--onto", tip, replayed.parent]);
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
      if (rebased === tip) {
        // The replay was dropped: the branch has the change. The fix still gets a merge commit of its own with the
        // branch's tree, so that the trailer marks the merge. Its second parent is the fix commit, or the commit the
        // fix was made on when the branch is at the fix commit itself (a merge needs two parents that differ).
        const recorded = inWorktree(["commit-tree", `${tip}^{tree}`, "-p", tip, "-p", item.commit === tip ? parent : item.commit, ...message(item)]).trim();
        inWorktree(["checkout", "--quiet", "--detach", recorded]);
        tip = recorded;
        items.push({ name: item.name, status: "merged", branch: item.branch, mergeCommit: recorded, reason: `${request.branch} has the change already; the merge commit records the fix without changing the tree`, files: [] });
        continue;
      }
      inWorktree(["checkout", "--quiet", "-B", item.branch, rebased]);
      inWorktree(["checkout", "--quiet", "--detach", tip]);
      inWorktree(["merge", "--quiet", "--no-ff", "--no-edit", ...message(item), item.branch]);
      tip = worktrees.head(request.worktree);
      // A commit hook may have rewritten the message: without its trailer a repeated merge would not find this one.
      if (worktrees.trailer(tip, item.trailer.key) !== item.trailer.value) {
        throw new SetupError(`The merge commit ${tip} of ${item.name} does not carry ${item.trailer.key}: ${item.trailer.value}; a commit hook may have changed its message. ${request.branch} was not advanced.`);
      }
      items.push({ name: item.name, status: "merged", branch: item.branch, mergeCommit: tip, reason: null, files: [] });
    }
  } finally {
    // The worktree first: a temporary folder that stays must not keep it registered, nor replace the result or the error.
    try {
      worktrees.remove(request.worktree);
    } finally {
      const leftover = normalized.dispose();
      if (leftover !== null) log(leftover.message);
    }
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
