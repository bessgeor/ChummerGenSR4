## ADDED Requirements

### Requirement: New hypothesis records trigger a tuning
`npm run eval -- tune auto [--force]` SHALL count the eval records of job kind `hypothesis`, origin `workflow` and a succeeded result whose IDs no earlier automatic tuning counted, as listed in `out/evals/tuning/auto.json`. With fewer than the profile's `autoTuning.every` (a positive integer, default 12) and without `--force`, it SHALL print the count and the threshold and exit with 0 without any other effect. Otherwise it SHALL record a new tuning as in progress with the records it counts, freeze the next version of the dataset named by `autoTuning.dataset` (default `auto-hypothesis`) with seed `auto` and a test share of 50 %, record the dataset, and run a tuning cycle on it with the job kind's first metric, `autoTuning.minPass` (default 0.5) and `autoTuning.candidates` (1 to 3, default 1), under the cycle's existing rules. A tuning in progress SHALL be continued, without freezing or counting again, before anything is counted. `auto.json` SHALL be written to a temporary file and renamed. Exit status SHALL be 0 when not due or when the cycle ended `activated` or `no_improvement`, 1 for `rejected`, 2 for `failed` and 3 for a setup error, after which the tuning SHALL stay in progress.

#### Scenario: Not due
- **WHEN** 7 hypothesis records were added since the last automatic tuning and `every` is 12
- **THEN** `tune auto` prints 7 of 12, freezes nothing and exits with 0

#### Scenario: Due
- **WHEN** 13 new hypothesis records exist
- **THEN** `tune auto` freezes the next version of `auto-hypothesis`, runs a cycle on it and marks the 13 records counted

#### Scenario: Stopped during the cycle
- **WHEN** `tune auto` is stopped while its cycle's candidate runs and is started again
- **THEN** it resumes that cycle without freezing another version or counting records

### Requirement: An automatic tuning works in its own worktree and merges its files
When the tuning folder or the certificates folder lies inside the repository (symbolic links and junctions followed, so a folder that links to one inside the repository lies inside), an automatic tuning SHALL require the branch the repository's `HEAD` names, else a setup error, and a working tree without uncommitted changes in those folders, else a setup error naming them; a folder that is the repository itself SHALL be a setup error. Its cycle SHALL read and write those folders in a worktree on the branch `tuning/<cycle>` started at that branch's tip, never in the repository's working tree. When the cycle ends with any outcome, the changes of those folders SHALL be committed on `tuning/<cycle>` when there are any, and that commit SHALL be rebased onto the branch's tip and merged into it with a merge commit carrying the trailer `Merged-Tuning: <cycle>`; the branch SHALL then be advanced by a fast-forward of the worktree that has it checked out, or by a compare-and-swap ref update when none has. A rebase conflict or a refused fast-forward SHALL be a setup error naming the branch, and the resumed tuning SHALL try the merge again, skipping it when the trailer is already reachable from the branch. While such a tuning is in progress after its worktree was added, `tune holdout`, `tune activate`, `tune rollback`, `tune cycle` and `certify` SHALL end with a setup error naming the tuning and its branch, so that the exposure limit is kept on one copy of the ledger; the check SHALL be made holding the ledger's lock, and the tuning SHALL add its worktree and record its branch holding the same lock, so that a command already running when the tuning adds its worktree is stopped at the write of those files. Folders outside the repository SHALL be used in place, and nothing SHALL be committed for them. No branch SHALL be pushed or deleted.

#### Scenario: Activation merged
- **WHEN** an automatic cycle activates a hypothesis configuration
- **THEN** the branch `HEAD` names gains a merge commit of `tuning/<cycle>` holding the active file, the ledger and the certificate, and the working tree holds them after the fast-forward

#### Scenario: A refused activation still records the ledger
- **WHEN** a cycle's candidate is held out and the activation is refused
- **THEN** the ledger's exposure is committed on `tuning/<cycle>` and merged, and the cycle's outcome is `rejected`

#### Scenario: Tuning commands wait for the tuning
- **WHEN** an automatic tuning has added its worktree and has not merged, and `tune holdout` is run in the checkout
- **THEN** it exits with 3 naming the tuning and its branch, and the checkout's ledger is not touched

#### Scenario: A cycle run by hand reaches its holdout after the worktree was added
- **WHEN** a `tune cycle` has passed its start and an automatic tuning adds its worktree before the cycle's holdout
- **THEN** the cycle's holdout ends with a setup error naming the tuning and its branch, and the checkout's ledger is not written

#### Scenario: Uncommitted tuning files
- **WHEN** `workflow/evals/tuning/holdout.json` has an uncommitted change and a tuning is due
- **THEN** `tune auto` exits with 3 naming the folder and starts no cycle

### Requirement: Tuning runs as a checkpointed graph
An automatic tuning and a `tune cycle` SHALL run as threads of the tuning graph built by `buildTuningGraph` in `workflow/src/tuning/tuning-graph.ts` and checkpointed in `out/evals/tuning/checkpoints.sqlite`, one node per step of the trigger, the freeze, the worktree, the cycle's runs, proposals, holdout and activation, the commit and the merge. A resumed tuning SHALL continue from its checkpoint without repeating a finished node, and an interrupted node SHALL resume the eval run it recorded. The graph SHALL compile from step objects that do nothing until a node runs.

#### Scenario: Killed during the holdout run
- **WHEN** an automatic tuning is killed while its holdout run runs and `tune auto` is started again
- **THEN** the tuning thread resumes at its holdout node, the run resumes its missing samples, and the freeze, the baseline and the proposals do not run again
