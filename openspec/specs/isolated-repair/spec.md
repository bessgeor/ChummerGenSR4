# isolated-repair Specification

## Purpose
Defines how the workflow repairs the clusters that diagnosis confirmed: one attempt per cluster by a model agent in an owned, history-less copy of the source, a patch guard, a build in the CPU pool, a narrow capture on the desktop lane, a deadline, the archive of every attempt and the repair records.

## Requirements

### Requirement: Each confirmed cluster gets one repair attempt
After diagnosis finished, the workflow SHALL start one repair attempt for each cluster whose check outcome is `confirmed`, and none for a cluster that is `refuted`, `undecided`, abstained, failed or `budget_exhausted`. The attempts SHALL run in parallel: their model jobs up to the model pool size, their builds in the CPU pool and their checks one at a time on the desktop lane. A cluster SHALL get no second attempt after an attempt passed or was rejected. `--no-repair` SHALL end the run after diagnosis, and `--only` of any node SHALL run no repair. An attempt that a stopped or killed run interrupted SHALL start again from its model job when the thread is resumed; a finished attempt SHALL NOT run again. When an attempt's model job fails with `quota_exhausted`, the graph SHALL wait with the diagnosis quota waits and then start the attempt again. A model job that cannot start because the run budget is spent SHALL leave its cluster `budget_exhausted`. The thread's `repair.json` SHALL list each repaired cluster's status, attempt and records, with totals.

#### Scenario: Two confirmed clusters
- **WHEN** diagnosis confirms two clusters and refutes a third
- **THEN** two repair attempts start without waiting for each other, and the refuted cluster gets none

#### Scenario: Repair turned off
- **WHEN** `npm start -- --no-repair` runs and diagnosis confirms a cluster
- **THEN** no repair job starts and `repair.json` is not written

#### Scenario: Killed during the narrow check
- **WHEN** the run is killed while an attempt's narrow check runs and the thread is resumed
- **THEN** diagnosis does not run again, the attempt starts again from its model job under a new record ID, and the earlier record stays in the store and in the cluster's records

### Requirement: Attempts work in an owned, history-less workspace
Each attempt SHALL work in its own scratch folder outside the repository, whose copies are made when its model job gets its place in the model pool, and which is removed when the attempt ends (a folder that cannot be removed SHALL be named in the log): a writable copy of the thread's source snapshot, which is the model's working folder, and a copy of the cluster's sealed context, added read-only. Neither copy SHALL hold version history, and no other thread, attempt, log or file of the repository SHALL lie in the scratch folder. A context whose hash differs from the one diagnosis sealed SHALL be a setup error before the model job starts. The repair job SHALL be able to change files only in its source copy: on Claude it has Read, Grep, Glob, Edit and Write and no tool that runs commands; on Codex it runs in a workspace-write sandbox without network, and a file change outside the source copy SHALL stop the job with `infra`. After the job, whichever provider ran it, the context copy SHALL equal the sealed context and the scratch folder SHALL hold only the two copies; a job that changed anything else SHALL fail with `infra`, before any build or archive. The prompt SHALL be built from the sealed manifest, the confirmed hypothesis, the challenge's answer and the check observations, SHALL mark them as untrusted data and SHALL name only the two copies.

#### Scenario: No history in the workspace
- **WHEN** a repair job runs
- **THEN** its working folder is a copy of the snapshot outside the repository without a `.git` folder, and the prompt names only that copy and the context copy

#### Scenario: Two attempts side by side
- **WHEN** two attempts run at the same time
- **THEN** each edits its own copy, and neither copy shows the other's edits

#### Scenario: A job edits its evidence
- **WHEN** a repair job overwrites a crop or context.json in its context copy, or adds a file to the scratch folder
- **THEN** the job fails with infra naming the change, the run ends with status 3, and nothing is built, checked or archived

### Requirement: A repair job answers with the files it changed
A repair job SHALL answer with an outcome `patched` or `no_patch`, a reason, a summary and the list of files it changed, relative to its source copy. An answer whose reason or summary is empty, whose file list is empty for `patched` or not empty for `no_patch`, or that names a path that is absolute, uses `\` or `..`, or names a file twice SHALL be `invalid_output`. A `no_patch` answer SHALL reject the attempt at stage `model` with the model's reason. An attempt whose model job fails with `invalid_output` or `refused` SHALL be rejected at stage `model`, archived, and make the cluster `failed`.

#### Scenario: Model declines
- **WHEN** the repair job answers `no_patch` with a reason
- **THEN** the attempt is rejected at stage `model` with that reason, nothing is built and nothing is captured

### Requirement: A patch guard runs before the build
The attempt's patch SHALL be every file whose content in the source copy differs from the snapshot, added, modified or deleted, with a unified diff per file made with pinned diff options and paths `a/<path>` and `b/<path>`. The attempt SHALL be rejected at stage `patch`, before any build, with every rule it breaks listed, when the patch is empty, when its files differ from the answer's list, when a file lies outside `Chummer/`, when a file is deleted, when a file holds a NUL byte, or when it changes more than 10 files or more than 300 lines (added plus removed).

#### Scenario: Edit outside the app's source
- **WHEN** the repair job changes `bin/data/skills.xml`
- **THEN** the attempt is rejected at stage `patch` naming the file, and no build starts

#### Scenario: Undeclared file
- **WHEN** the answer lists `Chummer/frmCreate.cs` and the copy also has a changed `Chummer/frmCareer.cs`
- **THEN** the attempt is rejected at stage `patch` naming the undeclared file

### Requirement: An attempt is built in the CPU pool
An attempt that passed the guard SHALL be built with MSBuild from its source copy into an output folder of its own outside the repository, never into `bin/` or `out/candidate/`, through the host runner on the CPU pool, by `build-candidate.mjs` with `--source`, `--output` and `--log`, which verifies the canonical hash before and after. The build script SHALL exit with 0 for a build, 1 for a failed build, and 3 when the canonical hash is wrong or MSBuild cannot be found. Exit 1 SHALL reject the attempt at stage `build` with the build log in its archive; any other status but 0 SHALL be a setup error.

#### Scenario: Patch that does not compile
- **WHEN** the patched copy fails to compile
- **THEN** the attempt is rejected at stage `build`, its archive holds the build log, and no capture starts

### Requirement: An attempt is checked narrowly on the desktop lane
An attempt that built SHALL be checked by one capture runner call on the desktop lane with the attempt's executable as the candidate, the cluster's cases and captures, and the thread's case file, settings overlay, threshold and canonical cache; it SHALL NOT reuse or record a capture step. The attempt SHALL pass only when the run exits with 0 and its coverage is valid. Exit 1 SHALL reject it at stage `check` listing each failing case and capture with its difference. Exit 2 or invalid coverage SHALL reject it at stage `check` as an execution failure, reported apart from its visual result, and SHALL make the run's status 2. Exit 3 SHALL be a setup error.

#### Scenario: Discrepancy gone
- **WHEN** the narrow check of an attempt exits with 0 with valid coverage
- **THEN** the attempt passes, and its archive names the check's run folder

#### Scenario: Still different
- **WHEN** a capture of the narrow check still fails with a visual difference
- **THEN** the attempt is rejected at stage `check` naming that case and capture and its difference, and the run's status is not raised by it

#### Scenario: Check lost to an execution failure
- **WHEN** the narrow check exits with 2
- **THEN** the attempt is rejected at stage `check` as an execution failure, the report prints the check's execution outcome apart from its results, and the run exits with 2

### Requirement: A deadline bounds each attempt
Each attempt SHALL have a deadline, the profile's `repair.deadlineMinutes` (default 60) after its model job got its place in the model pool. The model job's time limit SHALL be the smaller of its job kind's limit and the deadline, and a model job that runs past it SHALL fail with `timeout` and reject the attempt at stage `deadline`. The build SHALL be stopped at the deadline and the attempt rejected at stage `deadline`; a stop of the run SHALL still be a setup error. The narrow check SHALL NOT be cut off by the deadline. A usage-limit wait SHALL start the attempt, and its deadline, again.

#### Scenario: Build past the deadline
- **WHEN** an attempt's build is still running at its deadline
- **THEN** the build's processes are stopped, the attempt is rejected at stage `deadline`, and the run continues with the other attempts

### Requirement: Every attempt is archived
Every attempt whose model job finished, passed or rejected, SHALL be archived in the thread's `repair/<cluster>/attempt-<n>/`: `attempt.json` with the attempt and record IDs, context hash, snapshot identity, hypothesis record, the answer or the failure, the patch summary, the guard's violations, the build, the check with each selected case and capture's result, the outcome, and for a rejected attempt the stage (`model`, `deadline`, `patch`, `build` or `check`) and reason; `patch.diff`; the files before and after the patch; and the build log when a build ran. The archive SHALL be written under a temporary name and renamed when complete, and an existing archive of the same name SHALL be a setup error. An attempt interrupted by a usage limit, an `infra` failure or a stopped run SHALL NOT be archived.

#### Scenario: Rejected attempt kept
- **WHEN** an attempt is rejected at stage `build`
- **THEN** its archive holds the answer, the patch, the files before and after, the build log, the stage and the reason

### Requirement: Repair jobs are recorded with their outcome
Every repair job, including a failed one and a usage-limit failure, SHALL be an eval record of job kind `repair` with origin `workflow`, the cluster as subject, the context hash, prompt version, agent, usage, result and answer, under an ID whose attempt number is the first without a stored record. When the attempt is archived, its record SHALL get the automatic `repair` label with the outcome, the rejection stage and reason, and the time; setting it SHALL leave the other labels unchanged. Repair records SHALL NOT enter the review queue, the grader or datasets.

#### Scenario: Label after a rejected build
- **WHEN** an attempt is rejected at stage `build`
- **THEN** its record carries `repair: { outcome: rejected, stage: build }` and its other labels are unchanged
