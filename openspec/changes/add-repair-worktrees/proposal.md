# Proposal

## Why

A repair attempt works in a scratch copy of the thread's source snapshot, a subtask in another copy, and a widening in a third copy in the thread's folder. None of them has version history, so an attempt leaves no branch behind, a patch exists only as files in its archive, and a widening re-applies it by comparing file hashes. When a thread ends, its promoted fixes sit on `accepted/<thread>` as commits on top of the snapshot and nothing reaches the branch the thread was started on: every fix has to be merged by hand before the next run can build on it.

## What Changes

- **A source commit per thread.** Before the first attempt, the thread's source is committed once: the commit the snapshot was taken on, plus a commit of the snapshot's `Chummer/`, `Core/`, `bin/data/` and `bin/lang/` when the working tree differed. The branch `workflow/<thread>/source` points at it, so a resumed thread finds it again.
- **One worktree and branch per attempt.** Every repair attempt works in a `git worktree` of its own on the branch `workflow/<thread>/repair/<cluster>/attempt-<n>`, started at the source commit, in its scratch folder outside the repository. When the model job ends, the workflow commits what the job changed on that branch; the patch is the attempt commit's difference from the source commit. With fix changes, each subtask gets its own worktree and branch (`…/attempt-<n>-task-<k>`) started at the source commit with its blockers' changes committed, and the join is committed on the attempt's branch. The worktree is removed when the attempt ends; the branch and its commit stay.
- **Widening in a worktree.** A passed attempt is widened in a worktree on `workflow/<thread>/widening/<cluster>/attempt-<n>`, started at the accepted commit, by applying the attempt commit with git. The rule stays: every file the patch changes must still be what the patch was made from, else the attempt is rejected at stage `apply`. Promotion commits the widened worktree and moves `accepted/<thread>` to that commit; a rollback removes the worktree and keeps the branch.
- **Conclude merges each fix.** When a thread concludes, each fixed cluster's commit is rebased onto the tip of the branch the thread started on, as `workflow/<thread>/fix/<cluster>`, and merged into it with a merge commit of its own, in the order the fixes were promoted. A fix whose rebase conflicts is not merged and its cluster ends `merge_failed` with the conflicting files; later fixes are not merged either, since they were verified on top of it. The branch the thread started on is advanced only when the merges are done, by a fast-forward of the checked-out working tree (or a ref update when it is not checked out); a fast-forward git refuses is a setup error, and the resumed thread tries again. `outcome.json` records the merges.
- A repairing thread must start on a branch: a detached `HEAD` is a setup error before any capture.

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests on real temporary git repositories for the source commit, attempt and subtask worktrees, the widening apply rule, promotion, the conclude merges with and without conflicts and a resumed merge; graph tests for dispositions; a live `npm start` run that repairs and merges a fix, with the canonical hash before and after and execution outcomes apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `isolated-repair`: attempts and subtasks work in their own worktrees and branches from the thread's source commit, and the patch is the attempt commit's difference.
- `deterministic-widening`: the widened source is a worktree at the accepted commit with the attempt commit applied; promotion commits it and moves the accepted branch.
- `self-fixing-loop`: conclude merges each fixed cluster into the branch the thread started on; a fix that does not merge ends `merge_failed`.

## Impact

- New `workflow/src/git/` (worktrees, the thread's source commit, integration into the base branch) and their tests.
- Edited: repair workspace, patch computation, planned attempts and the subtask join, widening and promotion, the loop's conclude, dispositions and outcome, the thread's start, `main.ts`; `AGENTS.md` and `README.md`.
- Branches under `workflow/<thread>/` accumulate in the repository; they are never pushed and never deleted by the workflow.
- A thread stored before this change resumes without merging, and its passed attempts without a commit cannot be widened (setup error: start a new thread).
