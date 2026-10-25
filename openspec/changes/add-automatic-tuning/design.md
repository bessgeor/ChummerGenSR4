# Design

## Context

`npm run eval -- freeze --job hypothesis --name <n>` freezes the next version of a dataset from the store's workflow records whose context is still in their thread's folder; a new version must keep the seed and test share of the one before. `tune cycle` runs a development baseline, proposals, the holdout and the activation, recording its steps in `out/evals/tuning/cycles/<cycle>/cycle.json`, and reads and writes the tuning folder (`active/<jobKind>.json`, `holdout.json`) and the certificates folder; both default to folders inside the repository (`workflow/evals/tuning/`, `workflow/evals/certificates/`). The workflow's conclude step merges commits into the branch a thread started on by rebasing them and making a merge commit.

## Goals / Non-Goals

**Goals:**

- Tuning runs when enough new evidence exists, without a person starting it.
- Its writes reach the branch as one reviewable merge, apart from the working tree.
- Nothing in the holdout and activation rules changes.

**Non-Goals:**

- No tuning of challenge, rank or scenario jobs by the trigger; a person still runs those cycles.
- No new gate: the trigger only decides when a cycle starts.

## Decisions

### Counting

A record counts when it is of job kind `hypothesis`, origin `workflow`, its result succeeded and its ID is not in `auto.json`'s `counted`. When a tuning starts, every record counted then is added to `counted`, so records of threads that run during the tuning count toward the next one. `every` defaults to 12 and must be a positive integer.

### Freezing

The dataset is frozen with the name `autoTuning.dataset`, seed `auto` and a test share of 50 %, and the reason `automatic tuning after <n> new hypothesis records`. A freeze with nothing to freeze is a setup error, as with `eval freeze`. The dataset's folder is recorded in `auto.json` before the cycle starts, so a resumed tuning does not freeze again.

### The worktree

When the tuning folder or the certificates folder lies inside the repository, the tuning needs the branch `HEAD` names (a detached `HEAD` is a setup error) and a working tree without uncommitted changes in those two folders (else a setup error: the cycle would not see them). It adds a worktree at `out/evals/tuning/cycles/<cycle>/worktree` on `tuning/<cycle>` at that branch's tip and runs the cycle with the tuning and certificates folders mapped to the same relative paths in the worktree; datasets, eval runs and candidates stay in `out/evals/`. When the cycle ends with any outcome, `git add --all -- <tuning folder> <certificates folder>` and a commit (`Tune <jobKind>: <outcome>` naming the cycle) are made in the worktree when anything changed, and the commit is merged with the integration the workflow's conclude uses: rebased onto the branch's tip as `tuning/<cycle>` and merged with a merge commit carrying `Merged-Tuning: <cycle>`, then the branch is advanced by a fast-forward of its worktree or a ref update. A rebase conflict or a refused fast-forward is a setup error naming the branch; a resumed tuning tries the merge again, skipping it when the trailer is already reachable. The worktree is removed after the merge. With both folders outside the repository the cycle runs on them directly and nothing is committed.

### A tuning graph

The automatic tuning is a checkpointed LangGraph graph, `buildTuningGraph` in `workflow/src/tuning/tuning-graph.ts`, saved in `out/evals/tuning/checkpoints.sqlite` under the tuning's ID (`tune-<time>-<suffix>`): `count → freeze → worktree → baseline → propose ⟲ (one proposal, its development run and comparison per pass) → holdout → test_baseline → activate → commit → merge`. Its nodes call the existing cycle steps, which record their run IDs before they start, so a node interrupted mid-run resumes its run; `cycle.json` is still written for `tune cycle` readers. Where a driver runs the tuning, the compiled tuning graph is its node `tune`. `tune cycle` runs the same graph from `baseline` on a given dataset, without the trigger, the worktree and the merge.

### State and resumption

`auto.json` (written to a temporary file and renamed) holds `counted`, `tunings` (each with its start, the records it counted, the dataset, the cycle, the branch, the commit, the merge commit and the outcome) and `current`. `tune auto` resumes `current` first: the freeze when its dataset is not recorded, the cycle with `resumeCycle`, then the commit and merge. Exit status: 0 for not due, `activated` or `no_improvement`; 1 for `rejected`; 2 for `failed`; 3 for a setup error.

## Risks / Trade-offs

- A tuning with too few test items cannot be certified and ends `rejected`; the ledger still records its exposure, and the merge carries it so a later cycle respects it.
- The trigger counts records, not distinct clusters; a thread that hypothesises the same cluster many times counts each record.

## Fixture and live evidence

Workflow tests with fake eval runs and tune jobs on a temporary repository prove the count, freeze, worktree, commit, merge and resumption. Only a live `tune auto` proves the cycle with real model jobs; its outcome is reported with n and the 95 % intervals of every comparison.
