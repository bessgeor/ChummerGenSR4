# Design

## Context

Diagnosis copies `Chummer/`, `Core/`, `bin/data/` and `bin/lang/` of the working tree into `diagnosis/source/` (the snapshot) and records the commit the working tree was on. Repair copies the snapshot into a scratch folder per attempt (and per subtask), computes the patch by comparing file contents with the snapshot, and archives the files before and after. Widening copies the accepted `Chummer/` and `Core/` into `widening/<cluster>/attempt-<n>/source/`, writes the archived after-files over it when every changed file still has the hash the patch was made from, and builds it. Promotion stages that folder with a private index and moves `accepted/<thread>` by compare-and-swap. `conclude` only writes `outcome.json`.

## Goals / Non-Goals

**Goals:**

- Every attempt, subtask and widening is a commit on a branch of its own, so its history can be inspected and reused with git.
- A thread's fixes end up on the branch the thread was started on, one merge commit per cluster, without a person merging them.
- Keep every existing guard: the patch guard, the apply rule, the compare-and-swap promotion, resumability of every step.

**Non-Goals:**

- No change to diagnosis: its jobs keep reading the sealed, history-less snapshot and context.
- No push, no pull request, no deletion of branches.
- No automatic conflict resolution: a fix that does not rebase cleanly is reported, not merged.

## Decisions

### Git access

All git calls go through one function `(args, { cwd, env, input })` that runs the repository's git with `core.quotepath=false` and fails with a setup error that names the command. Worktree creation, commits and ref updates are the only writes; the repository's own index and working tree are touched only by the final fast-forward of the base branch.

### The thread's source commit

`workflow/<thread>/source` is created when repair is prepared: the snapshot's commit, or a commit on it of the snapshot's four folders staged with a private index (as the first promotion did before), when they differ. The ref is created with an expected empty value; if it exists, its commit is used. The first promotion now starts from this commit instead of building it, so the accepted branch has the same history as before.

### Attempt worktrees

`git worktree add -B workflow/<thread>/repair/<cluster>/attempt-<n> <scratch>/source <source commit>` replaces the snapshot copy; `-B` lets an attempt interrupted after its worktree was made start again. The worktree holds the full tree of the source commit; the prompt still names only the source folder and the context copy, and the guard still lets only `Chummer/` and `Core/` change. After the job, `git add --all` and `git commit` (with the repository's configured identity, as promotions are made; the message names thread, cluster and attempt) make the attempt commit; a job that changed nothing makes no commit and its patch is empty. The patch is computed from `git diff-tree -r --no-renames` between the source commit and the attempt commit; each file's before and after sides are the blobs, laid out as before so the archive, the guard and the diff text keep their form. `attempt.json` and the attempt summary gain `branch` and `commit`. `git worktree remove --force` ends the attempt; a worktree that cannot be removed is named in the log like a scratch folder.

Ignored files are not part of the patch: a job that writes only ignored files made no change. A job that edits outside the worktree is still caught by the scratch folder check.

### Subtasks

A subtask's worktree is made on `…/attempt-<n>-task-<k>` from the source commit; its blockers' joined changes are written into it and committed as its start commit. After the job, its changes are committed; the subtask's change is the difference between its start and its commit, by blob ID. The join keeps its rule with blob IDs instead of SHA-256: replayed in ID order from the source commit, a file whose current blob is not the blob a subtask started from is a conflict. The joined files are written into the attempt's worktree and committed as the attempt commit.

### Widening

`git worktree add -B workflow/<thread>/widening/<cluster>/attempt-<n> <thread folder>/widening/<cluster>/attempt-<n>/source <accepted commit or source commit>`. The apply rule compares, for each path the attempt commit changes, the blob in the attempt's parent with the blob in the accepted commit (an added file must be absent); any difference rejects at stage `apply` naming the paths. Otherwise `git cherry-pick --no-commit <attempt commit>` applies the change, which cannot conflict once the rule passed. The build uses the worktree. With fix changes, promotion copies the archived fix change into the worktree. Promotion runs `git add --all` and `git commit` with the fix message and trailers in the worktree; when the staged tree equals the accepted tree within `Chummer/` and `Core/`, nothing is committed and the widening fails at stage `promote` as before. `accepted/<thread>` is then moved by compare-and-swap from the accepted commit to that commit; a tip that already carries the attempt's `Repair-Record` is taken as the promotion after a resume. A rollback and the end of the thread remove widening worktrees; branches stay. The accepted source for a baseline build stays the snapshot folder until a promotion, then the promoted worktree.

### Merging at conclude

The thread's state gains `base`: the branch `HEAD` named when the thread started and its commit. A thread with repair and widening that starts on a detached `HEAD` is a setup error before the build.

`conclude` merges the promoted clusters in promotion order in a worktree `<thread folder>/merge` detached at the base branch's tip:

1. `git checkout -B workflow/<thread>/fix/<cluster> <fix commit>` and `git rebase --onto <tip> <fix parent>`; a conflict runs `git rebase --abort`, ends that cluster `merge_failed` with the conflicting paths and stops the merging, so later fixes, verified on top of it, end `merge_failed` too with the earlier cluster as reason.
2. `git checkout --detach <tip>` and `git merge --no-ff --no-edit -m "Merge fix for discrepancy <cluster>" -m "Workflow-Thread: …" -m "Merged-Fix: <thread>/<cluster>" workflow/<thread>/fix/<cluster>`; the merge commit is the new tip.

The result is kept on `workflow/<thread>/integration`, then the base branch is advanced from the commit it had to the new tip: by `git merge --ff-only` in the worktree that has it checked out, or by a compare-and-swap ref update when no worktree has it checked out. A base branch that moved in a way that is not an ancestor of the new tip, or a fast-forward git refuses (local changes in the merged files), is a setup error naming the integration branch; on resume, merges whose `Merged-Fix` trailer is already reachable from the base branch are skipped. The merge worktree is removed afterwards.

A cluster is `fixed` only when its fix is merged. `outcome.json` gains `merge`: the base branch, its commit before and after, and per cluster the fix branch and merge commit or the failure.

## Risks / Trade-offs

- Each attempt checks out the full tree (about 1 600 files) instead of the four snapshot folders; the cost is seconds per attempt and the scratch folder is removed afterwards.
- The repair job can read git history through the worktree. Repair records are kept out of evaluation, so this cannot leak gold into datasets; diagnosis jobs keep their history-less copies.
- The base branch is advanced in the checked-out working tree, which is the point of the change; git refuses it when local edits touch the merged files, and the thread can be resumed after the edits are committed or stashed.

## Fixture and live evidence

Workflow tests on temporary git repositories prove the git mechanics (source commit, worktrees, commits, patch, apply rule, promotion, rebase and merge, conflicts, resumed merges, fast-forward refusal). Only a live run proves that a model job edits its worktree, that the worktree builds and that a merged fix is on the base branch after a real thread; it records the canonical hash before and after.
