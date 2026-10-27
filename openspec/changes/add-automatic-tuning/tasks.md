# Tasks

Each task names the tasks it builds on as `(after: …)`, by number in this list or as `<change>#<number>` for a task of another change; `[desktop]` marks a task that needs a live run on the desktop.

## 1. Trigger and state

- [x] 1.1 Add `autoTuning` to the profile, the count of new hypothesis records and `out/evals/tuning/auto.json`. Evidence: workflow tests for not due, due, `--force`, records added during a tuning, and an invalid profile.

## 2. Freeze and cycle

- [x] 2.1 (after: 1.1) Build the tuning graph (`buildTuningGraph`, checkpointed in `out/evals/tuning/checkpoints.sqlite`), freeze the next version of the automatic dataset and run the cycle's steps as its nodes from `tune auto` and `tune cycle`, resuming a tuning in progress. Evidence: workflow tests with fake eval runs and tune jobs for activated, no improvement and rejected cycles and a tuning stopped during its cycle.

## 3. Worktree and merge

- [x] 3.1 (after: 2.1, add-repair-worktrees#1.1) Run the cycle in a worktree on `tuning/<cycle>` when the tuning folders are inside the repository, commit its files and merge them into the branch; use folders outside the repository in place. Evidence: workflow tests on a temporary repository for a merged activation, uncommitted tuning files, a detached `HEAD`, a merge conflict with a resume, and external folders.

## 4. Docs

- [ ] 4.1 (after: 3.1) Document `tune auto` and `autoTuning` in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck`, `npm run workflow:test` and `npm run openspec:validate` pass (recorded in `verification.md`).

## 5. Verification and archive

- [ ] 5.1 (after: 4.1) Run `npm run eval -- tune auto` live on the store's records; record in `verification.md` the count, the dataset, the cycle's outcome with n and the 95 % intervals, the branch and merge, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 5.2 (after: 5.1) Archive the change with `openspec archive add-automatic-tuning`. Evidence: `npm run openspec:validate` passes after the archive.
