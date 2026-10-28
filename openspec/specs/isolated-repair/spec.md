# isolated-repair Specification

## Purpose
Defines how the workflow repairs the clusters that diagnosis confirmed: one attempt per cluster by a model agent in an owned, history-less copy of the source, a patch guard, a build in the CPU pool, a narrow capture on the desktop lane, a deadline, the archive of every attempt and the repair records.

## Requirements

### Requirement: Each confirmed cluster gets a repair attempt
After diagnosis finished, the workflow SHALL start one repair attempt for each cluster whose check outcome is `confirmed`, and none for a cluster that is `refuted`, `undecided`, abstained, failed or `budget_exhausted`. The attempts SHALL run in parallel: their model jobs up to the model pool size, their builds in the CPU pool and their checks on the desktop lanes; an attempt's tries SHALL run in parallel the same way. A cluster SHALL get a further attempt only as the loop's next attempt after a rejection, and none after an attempt passed and was promoted. `--no-repair` SHALL end the run after diagnosis, and `--only` of any node SHALL run no repair. An attempt that a stopped or killed run interrupted SHALL start again from its model jobs when the thread is resumed; a finished attempt SHALL NOT run again. When a model job of an attempt fails with `quota_exhausted`, the graph SHALL wait with the diagnosis quota waits and then start the attempt again. A model job that cannot start because the run budget is spent SHALL leave its cluster `budget_exhausted` when no try of its attempt finished. The thread's `repair.json` SHALL list each repaired cluster's status, latest attempt with its tries, earlier attempts and records, with totals.

#### Scenario: Two confirmed clusters
- **WHEN** diagnosis confirms two clusters and refutes a third
- **THEN** two repair attempts start without waiting for each other, and the refuted cluster gets none

#### Scenario: Repair turned off
- **WHEN** `npm start -- --no-repair` runs and diagnosis confirms a cluster
- **THEN** no repair job starts and `repair.json` is not written

#### Scenario: Killed during the narrow check
- **WHEN** the run is killed while an attempt's narrow check runs and the thread is resumed
- **THEN** diagnosis does not run again, the attempt starts again from its model job under a new record ID, and the earlier record stays in the store and in the cluster's records

#### Scenario: A passed attempt is not repeated
- **WHEN** a cluster's attempt passes and its widening is promoted while another cluster gets a next attempt
- **THEN** the promoted cluster gets no further repair job

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
The attempt's patch SHALL be every file whose content in the source copy differs from the snapshot, added, modified or deleted, with a unified diff per file made with pinned diff options and paths `a/<path>` and `b/<path>`. The attempt SHALL be rejected at stage `patch`, before any build, with every rule it breaks listed, when the patch is empty, when its files differ from the answer's list, when a file lies outside `Chummer/` and `Core/`, when a file is deleted, when a file holds a NUL byte, or when it changes more than 10 files or more than 300 lines (added plus removed).

#### Scenario: Edit outside the app's source
- **WHEN** the repair job changes `bin/data/skills.xml`
- **THEN** the attempt is rejected at stage `patch` naming the file, and no build starts

#### Scenario: Undeclared file
- **WHEN** the answer lists `Chummer/frmCreate.cs` and the copy also has a changed `Chummer/frmCareer.cs`
- **THEN** the attempt is rejected at stage `patch` naming the undeclared file

#### Scenario: Edit in the library
- **WHEN** the repair job changes `Core/XmlManager.cs` and lists it in its answer
- **THEN** the guard lets the patch through to the build

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

### Requirement: With fix changes an attempt is planned as subtasks
In a thread with fix changes, an attempt SHALL start with a plan job of job kind `repair` in a read-only copy of the snapshot and the context, with prompt version `repair-plan-v2` and the attempt's record ID. It SHALL answer `planned` with a reason, a summary and 1 to 5 subtasks, or `no_plan` with a reason. A subtask SHALL have the ID of its position (1 to n), a title, instructions, the files it may change under `Chummer/` or `Core/` and the IDs of the subtasks that block it, all lower than its own. An answer SHALL be `invalid_output` when a subtask's ID is out of order, a blocker is not lower, a path is unsafe or outside `Chummer/` and `Core/`, a subtask names a file twice, the plan names more than 10 files, or two subtasks of which neither blocks the other, directly or through others, name the same file. A `no_plan` answer SHALL reject the attempt at stage `model`.

#### Scenario: Cyclic blockers
- **WHEN** subtask 1 names subtask 2 as its blocker
- **THEN** the plan is `invalid_output`, the attempt is rejected at stage `model` and the cluster is `failed`

#### Scenario: Independent subtasks on one file
- **WHEN** subtasks 1 and 2 have no blockers and both name `Chummer/frmCreate.Designer.cs`
- **THEN** the plan is `invalid_output`

### Requirement: Independent subtasks are implemented in parallel and joined
Each subtask whose blockers are done SHALL start as a writable job of job kind `repair` with prompt version `repair-task-v2` and record ID `<attempt record>/task-<id>`, in its own scratch folder outside the repository that holds a copy of the snapshot with its blockers' changes and a read-only copy of the context; subtasks of the same wave SHALL run at the same time up to the model pool size. A subtask's change SHALL be the files that differ from the copy it started with and SHALL be exactly the files its answer lists, else the attempt SHALL be rejected at stage `patch`. The changes SHALL be joined in ID order onto a copy of the snapshot; a file whose joined content is not the content a subtask started from SHALL reject the attempt at stage `patch`, naming both subtasks. The joined copy SHALL then pass the patch guard, with the subtasks' files as the declared list, the build and the narrow check as a single attempt does. A subtask's failure or `no_patch` answer SHALL reject the attempt at stage `model` (stage `deadline` for a timeout) and start no further wave, also when the spent run budget kept another subtask of its wave from starting; a usage limit SHALL park the attempt until the quota wait ends, after which it starts again under a new attempt number, and the model time of the jobs that finished before the limit SHALL be charged to the thread. A run budget spent after some of the attempt's jobs finished, before the next could start, SHALL end the attempt as rejected at stage `model`, archived like any rejected attempt with the labels of its finished jobs, and the cluster SHALL be `budget_exhausted`. The deadline SHALL run from the plan job's start over every job and the build, and a subtask's time limit SHALL be the smaller of its own and what is left of the deadline when it gets its place in the model pool. A subtask's copy holds the changes of every subtask that blocks it, directly or through others, and its prompt SHALL say so. The joined answer SHALL list the files whose joined content differs from the snapshot's. Every job SHALL be an eval record and charged to the run budget; the archive SHALL hold the plan and each subtask with its record, files and outcome, every subtask record SHALL get the attempt's `repair` label, and a passed attempt's archive SHALL hold the draft of its fix change under `fix/`.

#### Scenario: Two independent subtasks and a dependent one
- **WHEN** a plan has subtasks 1 and 2 without blockers and subtask 3 blocked by both
- **THEN** subtasks 1 and 2 start before either ends, subtask 3 starts after both with a copy holding both changes, and the joined patch holds all three changes

#### Scenario: Subtask changed an unplanned file of another subtask
- **WHEN** subtask 2 changes a file that subtask 1, which does not block it, also changed
- **THEN** the attempt is rejected at stage `patch` naming subtasks 1 and 2 and the file, and nothing is built

#### Scenario: Budget spent after the plan
- **WHEN** the plan job finishes and uses the run budget
- **THEN** no subtask starts, the attempt is archived as rejected at stage `model` with the plan job's record labelled, and the cluster is `budget_exhausted`

### Requirement: The repair prompt names the source that may change
The repair, plan and subtask prompts SHALL describe the source copy's `Chummer/` and `Core/` as the app's C# source and `bin/data/` and `bin/lang/` as its data and translations, and the repair and subtask prompts SHALL say that only C# source under `Chummer/` or `Core/` may change. The repair prompt SHALL carry the prompt version `repair-v3`, and the attempt's record SHALL carry it.

#### Scenario: Repair prompt
- **WHEN** a repair attempt of a thread without fix changes starts
- **THEN** its prompt starts with `PROMPT_VERSION=repair-v3` and names `Chummer/` and `Core/` as the source that may change

### Requirement: An attempt runs its tries side by side and selects the best
The profile's `repair.tries` (an integer from 1 to 3, default 1) SHALL set how many tries an attempt makes per confirmed hypothesis of its cluster, at most 6 in all. The tries SHALL start together, each as a single or planned attempt with the record ID `<attempt record>/try-<k>`, its own worktree and branch `workflow/<thread>/repair/<cluster>/attempt-<n>-try-<k>` (an attempt of one try keeps the attempt's own record ID and branch `workflow/<thread>/repair/<cluster>/attempt-<n>`), its hypothesis's answer, challenge and observations in its prompt, and the attempt's deadline; each SHALL go through the patch guard, the build and the narrow check on its own. A usage limit in any try SHALL park the attempt until the quota wait ends, after which the attempt starts again under a new number; the model time of the jobs that finished SHALL be charged. The attempt SHALL pass when at least one try passed and SHALL select, among the passed tries, the one with the fewest added plus removed lines, then the fewest files, then the lowest try number. A rejected attempt's reason SHALL list each try's stage and reason. The archive SHALL hold every try in `try-<k>/` with its own `attempt.json` fields, mark the selected try and keep the selected try's branch, commit, patch, build and check at its top level; a next attempt's prompt SHALL list every try of an earlier attempt with its patch.

#### Scenario: Two passed tries
- **WHEN** an attempt has two tries that pass, the first changing 12 lines and the second 5
- **THEN** the attempt passes with the second try selected, and the first is archived as passed and not selected

#### Scenario: Every try rejected
- **WHEN** one try is rejected at stage `build` and the other at stage `check`
- **THEN** the attempt is rejected with both stages and reasons, and a next attempt's prompt shows both patches
