# Design

## Context

Repair leaves, for each confirmed cluster, at most one attempt. A passed attempt is archived in `repair/<cluster>/attempt-<n>/` of the thread's folder with `attempt.json` (the patch's files, their change and hashes, the record ID), `patch.diff` and the changed files' sides in `files/before/` and `files/after/`; its scratch folder, source copy and build are gone. The patch was made against the thread's source snapshot (`diagnosis/source/`), which is exactly the source the thread's candidate was built from. The thread's capture steps and the diagnosis check captured that candidate, so their run folders show what the source looked like before any patch. The capture runner takes `--candidate-exe` for another candidate and `--canonical-cache` for the canonical side, which no patch changes. A results row names its case and capture, whether it is within the threshold, the share of differing pixels, and the PNG of each side.

## Goals / Constraints

**Goals:**

- Widen each passed attempt deterministically, without a model, from its own captures to the whole case file, failing as early as the narrowest failing level allows.
- Tell differences a patch brought apart from those that were there before, from pixels only, against the same source the patch was made for.
- Keep accepted patches as commits on a branch of their own, stacked in the order they were accepted, and leave nothing of a rejected patch in what is accepted.
- Resume a killed widening without repeating finished levels and without a second commit.

**Constraints:**

- The working tree, the index and the checked-out branch of the repository never change; only the branch `accepted/<thread>` is written.
- `bin/ChummerGenSR4.exe` is only read, by the build script and the capture runner, which both verify its hash.
- A difference counts as pre-existing only when a capture of the accepted source shows it with the same candidate pixels; a missing baseline is never assumed.

## Decisions

### Graph

After `finish_repair`, when widening is on (`--no-widening` turns it off; it is off whenever repair is), `prepare_widening` lists a widening for each cluster whose repair `passed`, in cluster ID order, and sets the accepted state to the thread's snapshot. `route_widening` takes the first widening that is not final and sends it to `widen` (when `pending` or `widening`), `promote` (when `verified`) or `roll_back` (when `failed`); with none left it goes to `finish_widening`, which writes the thread's `widening.json`. Widening is sequential: each attempt is widened on the source accepted before it. Every step is one graph task and checkpointed, so a resumed thread repeats only the step a kill interrupted.

```
widenings[clusterId] = { clusterId, attempt, recordId, archive, status: "pending" | "widening" | "verified" | "failed" | "promoted" | "rejected",
                         levels: LevelResult[], rejection: { stage, reason, execution } | null, commit: string | null }
accepted = { branch, base, commit: string | null, source, build: string | null, baselineRuns: string[], promoted: string[] }
```

### The widened candidate

The first `widen` step of a cluster removes `widening/<cluster>/` if a killed step left it, copies the accepted source's `Chummer/` to `widening/<cluster>/source/`, and applies the attempt's patch from its archive: for each changed file, the accepted file must exist with the SHA-256 of the patch's `before` side (or not exist for an added file); then the `after` side is written. A file whose content differs rejects the attempt at stage `apply` naming the file; no merge is attempted. The widened source is built by `build-candidate.mjs --source --output --log` into `widening/<cluster>/build/` through the host runner's CPU pool. Exit 1 rejects the attempt at stage `build`; any other non-zero status is a setup error. The thread's folder lies under the git-ignored `out/`; no `Directory.Build.*` file is above it.

### Ladder

With `C` the cases of the cluster, `K` its captures and the cases of the thread's case file (not the thread's `--case` and `--capture` selection):

| Level | Cases | Captures |
|---|---|---|
| `narrow` | `C` | `K` |
| `character` | `C` | all |
| `mode` | the other cases whose mode is a mode of `C` | all |
| `suite` | every case not yet captured at an earlier level | all |

Each level is one capture runner call on the desktop lane, made by the same function as every capture run, with `--candidate-exe` the widened build and the thread's case file, overlay, threshold and canonical cache. A level with no case passes as `nothing new` without a run. A level that fails ends the ladder. Before every level run and baseline capture the service checks that the thread's inputs (canonical executable and support files, overlay, capture tools; not the thread's candidate, since levels run widened builds) and the capture runner's environment fingerprint, taken when the thread started and kept with its input fingerprints, are unchanged, and afterwards that the run's coverage lists exactly the selected cases, as the capture step does; either failure is a setup error, so inputs drifting between the thread's runs and the levels are never read as regressions.

### Level verdict and attribution

A level run with status 2 or invalid coverage fails as an execution failure (no attribution is made). Otherwise every row that is not within the threshold is classified:

- `target`: the row's case and capture are a member of the cluster in `triage.json`;
- `introduced`: the baseline row passed;
- `changed`: the baseline row did not pass, and the two candidate PNGs differ in size, one is missing, or the share of differing pixels between them exceeds the level run's threshold;
- `pre-existing`: the baseline row did not pass and the candidate pixels are the same within the threshold (two missing candidate captures count as the same);
- `unattributed`: no baseline row exists even after a baseline capture.

The level passes when it ran without execution failures and every row is within the threshold or `pre-existing`.

The baseline is the newest row for the case and capture in the accepted state's baseline runs: at first the thread's capture runs and the diagnosis check run (all of the snapshot's candidate), except runs with status 2 or invalid coverage, whose rows are no baseline, after a promotion the promoted attempt's level runs, plus every baseline capture. Rows without a baseline are captured on the accepted build in one more run (their cases and captures); the accepted build of the snapshot is built once into `widening/accepted/build/`, a promoted attempt's build is reused. A baseline capture with execution failures fails the level as an execution failure. Baseline runs are of the accepted source and are kept for later clusters even when the attempt is rejected.

PNG pixels are read by a small decoder for the 8-bit, non-interlaced colour types the capture runner writes (grey, RGB, grey with alpha, RGBA); another format is a setup error.

### Promotion

`promote` runs when all four levels passed. The branch is `refs/heads/accepted/<thread>`. On the first promotion its base is the commit the snapshot was taken on, plus a commit `Source captured by thread <thread>` when the snapshot's `Chummer/` differs from that commit's. Commits are made with a private index file in the widening folder: `read-tree` of the parent, `git --work-tree=<widened source> add -A -- Chummer` (the repository's own clean filters apply, so blobs are those `git add` would store; the widened source holds only `Chummer/`, so the ignore rules of the repository's root do not apply and every file of it is committed), `write-tree`, `commit-tree`, and `update-ref` with the expected old value (absent on the first promotion). The fix commit's message is `Fix discrepancy <cluster>`, the repair answer's summary, and the trailers `Workflow-Thread`, `Discrepancy` and `Repair-Record`. Before committing, `promote` looks at the branch: when its tip carries the attempt's `Repair-Record` trailer, the commit was made before a kill and is taken as it is; a tip that is neither the accepted commit nor that commit (including a branch deleted since) is a setup error that says a resumable thread needs its branch. A widened source whose staged tree is the parent's has nothing to commit: the widening fails at stage `promote` and the rollback step rejects it; nothing is removed before that failure is checkpointed, so an interrupted promotion can be repeated. The widened source and build become the accepted source and build, the attempt's level runs replace the baseline runs, and the record gets its `widening` label.

### Rollback

`roll_back` runs when an attempt failed. It removes `widening/<cluster>/source/` and `build/`, and keeps the accepted state, so the next cluster widens from the source accepted before the rejected attempt. The patch stays in the repair archive.

### Documents, report, records and exit status

Each final widening writes `widening/<cluster>/widening.json`: the attempt, its record, every level (name, selection, run folder, execution outcome, rows passed and failed, each failing row with its attribution and baseline run, the baseline capture's run and execution outcome), the outcome (`promoted` or `rejected`), the stage (`apply`, `build`, a level or `promote`) and reason, and the commit. `finish_widening` writes the thread's `widening.json`: every widening, the accepted branch and commit, and totals. The repair record of the attempt gets the label `widening: { outcome, stage, reason, commit, labelledUtc }`; a stored record without it reads as empty, and it is automatic and never gold. The report prints per cluster the outcome, then per level its execution outcome (status, coverage, failures, run folder) apart from its visual result (passed, failed and the count of each attribution). The run's status is 2 when a level or baseline capture had execution failures; a rejection alone does not change it, since the discrepancy is already counted by the compare.

## Risks / Trade-offs

- [A cluster's discrepancy also shows in a case triage never saw, and the patch leaves it there] → It is classified `pre-existing`, because the cluster's members name the captures the thread analyzed. The row stays listed as a remaining finding with its baseline run.
- [Candidate pixels vary between runs of the same source] → The comparison uses the level run's own threshold; a larger variation is classified `changed` and rejects the attempt, which is visible in `widening.json` with both runs.
- [Two attempts change the same file] → The second is rejected at stage `apply`; nothing is merged.
- [A full suite takes about twenty minutes on the lane] → Levels run narrowest first and the ladder stops at the first failing level; the canonical side comes from the cache.
- [Promotion writes to the repository] → Only `accepted/<thread>` and its objects; the update is compare-and-swap and resumes by trailer.

## What fixture tests prove and what only a live run can

Fixture tests (a fake host, real folders and PNG files, a real git repository) prove the ladder's selections, patch application and its conflicts, the PNG comparison, every attribution, the baseline capture and its reuse, the level verdicts, promotion with and without a source commit and its resume, rollback, the graph's order, resume after a kill, the documents, the label, the report and the exit status. Only a live run proves that a passed repair's patch is built and captured level by level against the canonical executable on the desktop lane, that real captures of two builds of the same source give the same pixels, that a baseline capture on the accepted build attributes a real pre-existing difference, and that a commit lands on the accepted branch of the real repository without touching its working tree.
