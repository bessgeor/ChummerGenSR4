# Tasks

Each task names the tasks it builds on as `(after: …)`, by number in this list or as `<change>#<number>` for a task of another change; `[desktop]` marks a task that needs a live run on the desktop.

## 1. Worktrees

- [x] 1.1 (after: restructure-workflow-subgraphs#1.1) Add `workflow/src/git/` (the git runner, worktrees, the thread's source commit on `workflow/<thread>/source`, the integration of commits into a branch) and run repair attempts, subtasks and widenings in worktrees on their own branches: attempt commits, the patch from the source and attempt commits, `branch` and `commit` in the archive, the join by blob ID, the git apply rule, promotion by committing the widened worktree and moving `accepted/<thread>`, rollback by removing the worktree. Evidence: workflow tests on temporary repositories for a clean and a dirty snapshot, an edit, an empty change, ignored files, an edit outside `Chummer/` and `Core/`, two attempts side by side, the planned-attempt cases (independent and dependent subtasks, a conflict, a mislisted change), a stale file at apply, nothing to commit, a fix change and a resumed promotion.

## 2. Merging at conclude

- [x] 2.1 (after: 1.1) Record the base branch at the thread's start, merge each fixed cluster at conclude by rebase and merge commit, advance the base branch and report the merges; add `merge_failed`. Evidence: loop tests on a temporary repository for two merged fixes, a conflicting fix and the one after it, a moved base branch, a refused fast-forward with a resume, a branch that is not checked out and a detached `HEAD` at start.

## 3. Docs

- [ ] 3.1 (after: 2.1) Document worktrees, branches and the merge in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck`, `npm run workflow:test` and `npm run openspec:validate` pass (recorded in `verification.md`).

## 4. Verification and archive

- [ ] 4.1 (after: 3.1) [desktop] Run `npm start` live on a scope with a confirmed cluster through repair, widening and conclude; record in `verification.md` the canonical hash before and after, the branches and merge commits made, execution outcomes apart from visual results, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 4.2 (after: 4.1) Archive the change with `openspec archive add-repair-worktrees`. Evidence: `npm run openspec:validate` passes after the archive.
