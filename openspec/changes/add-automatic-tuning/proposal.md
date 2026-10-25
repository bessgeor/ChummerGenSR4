# Proposal

## Why

Every workflow thread adds hypothesis records to the store, but nothing uses them for tuning until a person freezes a dataset and runs `npm run eval -- tune cycle` by hand. A cycle that activates a configuration writes the active file, the ledger and the certificate into the working tree, which a person then has to commit. So tuning happens rarely, and when it does it mixes its files with whatever else is in the working tree.

## What Changes

- **A trigger.** `npm run eval -- tune auto` counts the succeeded workflow `hypothesis` records that no earlier automatic tuning counted. When there are at least `autoTuning.every` of them (profile, default 12), the tuning is due; otherwise the command says how many there are and exits with 0. `--force` runs it regardless of the count.
- **An automatic cycle.** A due tuning freezes the next version of the dataset `autoTuning.dataset` (default `auto-hypothesis`) from the workflow's hypothesis records, with a fixed seed and test share, and runs a `tune cycle` on it with the profile's `autoTuning.minPass` (default 0.5), `autoTuning.candidates` (default 1) and the job kind's first metric. The holdout ledger, the development gate, the holdout run and the certified activation are the existing cycle's, unchanged.
- **In its own worktree.** When the tuning and certificates folders are the repository's own, the cycle works in a worktree on the branch `tuning/<cycle>` started at the tip of the branch `HEAD` names, and reads and writes the active files, the ledger and the certificates there. When the cycle ends, whatever its outcome, the changes to those folders are committed on that branch and merged into the branch with a rebase and a merge commit, the way a workflow thread merges its fixes. Folders the profile places outside the repository are used in place, without a worktree.
- **Resumable.** `out/evals/tuning/auto.json` records the counted records, each automatic tuning with its dataset, cycle, branch and merge, and the one in progress; `tune auto` continues one in progress before it counts anything.

Area: the workflow's evaluation tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests for the count, the dataset freeze, the cycle in a worktree with its merge (activated, no improvement, rejected), folders outside the repository, a stopped tuning that resumes, and a merge conflict; a live `tune auto` with real `tune` and eval jobs on recorded hypotheses, with the outcome, intervals and n recorded.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bounded-self-tuning`: tuning is triggered by new hypothesis records, runs in its own worktree and merges its files into the branch it started from.

## Impact

- New: the automatic tuning command, its state file and its tests.
- Edited: the eval CLI's help, the profile (`autoTuning`), the git integration shared with the workflow's merge; `AGENTS.md` and `README.md`.
- Tuning branches `tuning/<cycle>` stay in the repository; they are never pushed or deleted.
