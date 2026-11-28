## REMOVED Requirements

### Requirement: Attempts work in an owned, history-less workspace
**Reason**: An attempt now works in a git worktree on a branch of its own, so its change is a commit with history.
**Migration**: See "Attempts work in their own worktree and branch".

## ADDED Requirements

### Requirement: Attempts work in their own worktree and branch
Before the first attempt of a thread, the workflow SHALL commit the thread's source once: the commit the snapshot was taken on, or, when the snapshot's `Chummer/`, `Core/`, `bin/data/` and `bin/lang/` differ from it, a commit on it with the snapshot's content of those folders, made with a private index without changing the repository's working tree, index or checked-out branch. The branch `workflow/<thread>/source` SHALL point at it; a branch that exists already SHALL be used as it is. Each attempt SHALL work in its own scratch folder outside the repository, made when its model job gets its place in the model pool and removed when the attempt ends (a folder or worktree that cannot be removed SHALL be named in the log): a git worktree of the repository on the branch `workflow/<thread>/repair/<cluster>/attempt-<n>` at the source commit, which is the model's working folder, and a copy of the cluster's sealed context, added read-only, without version history. No other thread's or attempt's worktree, log or file SHALL lie in the scratch folder. A context whose hash differs from the one diagnosis sealed SHALL be a setup error before the model job starts. The repair job SHALL be able to change files only in its worktree: on Claude it has Read, Grep, Glob, Edit and Write and no tool that runs commands; on Codex it runs in a workspace-write sandbox without network, and a file change outside the worktree SHALL stop the job with `infra`. After the job, whichever provider ran it, the context copy SHALL equal the sealed context and the scratch folder SHALL hold only the worktree and the context copy; a job that changed anything else SHALL fail with `infra`, before any commit, build or archive. When the job finished, the workflow SHALL commit every change of the worktree that git does not ignore on the attempt's branch, the attempt commit; a job that changed nothing SHALL make no commit. The worktree SHALL be removed when the attempt ends and its branch SHALL be kept. The prompt SHALL be built from the sealed manifest, the confirmed hypothesis, the challenge's answer and the check observations, SHALL mark them as untrusted data and SHALL name only the worktree and the context copy.

#### Scenario: Worktree at the source commit
- **WHEN** a repair job runs
- **THEN** its working folder is a worktree outside the repository on `workflow/<thread>/repair/<cluster>/attempt-<n>` at the thread's source commit, and the prompt names only that worktree and the context copy
- **AND** after the attempt the worktree is gone and the branch holds the attempt commit

#### Scenario: Snapshot taken with uncommitted edits
- **WHEN** the thread's snapshot holds an uncommitted edit under `Core/` and the first attempt starts
- **THEN** `workflow/<thread>/source` is a commit with that edit on the snapshot's commit, the attempt's worktree holds the edit, and `git status` of the repository is unchanged

#### Scenario: Two attempts side by side
- **WHEN** two attempts run at the same time
- **THEN** each edits its own worktree on its own branch, and neither worktree shows the other's edits

#### Scenario: A job edits its evidence
- **WHEN** a repair job overwrites a crop or context.json in its context copy, or adds a file to the scratch folder beside the worktree
- **THEN** the job fails with infra naming the change, the run ends with status 3, and nothing is committed, built, checked or archived

## MODIFIED Requirements

### Requirement: A patch guard runs before the build
The attempt's patch SHALL be every file that differs between the source commit and the attempt commit, added, modified or deleted, compared without rename detection, with a unified diff per file made from the two blobs with pinned diff options and paths `a/<path>` and `b/<path>`; without an attempt commit the patch SHALL be empty. The attempt SHALL be rejected at stage `patch`, before any build, with every rule it breaks listed, when the patch is empty, when its files differ from the answer's list, when a file lies outside `Chummer/` and `Core/`, when a file is deleted, when a file holds a NUL byte, or when it changes more than 10 files or more than 300 lines (added plus removed).

#### Scenario: Edit outside the app's source
- **WHEN** the repair job changes `bin/data/skills.xml`
- **THEN** the attempt is rejected at stage `patch` naming the file, and no build starts

#### Scenario: Undeclared file
- **WHEN** the answer lists `Chummer/frmCreate.cs` and the worktree also has a changed `Chummer/frmCareer.cs`
- **THEN** the attempt is rejected at stage `patch` naming the undeclared file

#### Scenario: Edit in the library
- **WHEN** the repair job changes `Core/XmlManager.cs` and lists it in its answer
- **THEN** the guard lets the patch through to the build

#### Scenario: Only ignored files written
- **WHEN** the repair job writes only files that the repository ignores and answers `patched`
- **THEN** no attempt commit is made and the attempt is rejected at stage `patch` because the patch is empty

### Requirement: Every attempt is archived
Every attempt whose model job finished, passed or rejected, SHALL be archived in the thread's `repair/<cluster>/attempt-<n>/`: `attempt.json` with the attempt and record IDs, context hash, snapshot identity, hypothesis record, the attempt's branch and its commit (null without one), the answer or the failure, the patch summary, the guard's violations, the build, the check with each selected case and capture's result, the outcome, and for a rejected attempt the stage (`model`, `deadline`, `patch`, `build` or `check`) and reason; `patch.diff`; the files before and after the patch; and the build log when a build ran. The archive SHALL be written under a temporary name and renamed when complete, and an existing archive of the same name SHALL be a setup error. An attempt interrupted by a usage limit, an `infra` failure or a stopped run SHALL NOT be archived.

#### Scenario: Rejected attempt kept
- **WHEN** an attempt is rejected at stage `build`
- **THEN** its archive holds the answer, the attempt's branch and commit, the patch, the files before and after, the build log, the stage and the reason

### Requirement: Independent subtasks are implemented in parallel and joined
Each subtask whose blockers are done SHALL start as a writable job of job kind `repair` with prompt version `repair-task-v2` and record ID `<attempt record>/task-<id>`, in its own scratch folder outside the repository that holds a worktree on the branch `workflow/<thread>/repair/<cluster>/attempt-<n>-task-<id>` and a read-only copy of the context; the worktree SHALL start at a commit on the source commit that holds its blockers' joined changes (the source commit itself without blockers), and subtasks of the same wave SHALL run at the same time up to the model pool size. A subtask's changes SHALL be committed on its branch, and its change SHALL be the files whose blobs differ between its start commit and that commit; it SHALL be exactly the files its answer lists, else the attempt SHALL be rejected at stage `patch`. The changes SHALL be joined in ID order onto the source commit by blob; a file whose joined blob is not the blob a subtask started from SHALL reject the attempt at stage `patch`, naming both subtasks. The join SHALL be written into the attempt's worktree and committed as the attempt commit, which SHALL then pass the patch guard, with the subtasks' files as the declared list, the build and the narrow check as a single attempt does. A subtask's failure or `no_patch` answer SHALL reject the attempt at stage `model` (stage `deadline` for a timeout) and start no further wave, also when the spent run budget kept another subtask of its wave from starting; a usage limit SHALL park the attempt until the quota wait ends, after which it starts again under a new attempt number, and the model time of the jobs that finished before the limit SHALL be charged to the thread. A run budget spent after some of the attempt's jobs finished, before the next could start, SHALL end the attempt as rejected at stage `model`, archived like any rejected attempt with the labels of its finished jobs, and the cluster SHALL be `budget_exhausted`. The deadline SHALL run from the plan job's start over every job and the build, and a subtask's time limit SHALL be the smaller of its own and what is left of the deadline when it gets its place in the model pool. A subtask's worktree holds the changes of every subtask that blocks it, directly or through others, and its prompt SHALL say so. The joined answer SHALL list the files whose joined blob differs from the source commit's. Every job SHALL be an eval record and charged to the run budget; the archive SHALL hold the plan and each subtask with its record, files and outcome, every subtask record SHALL get the attempt's `repair` label, and a passed attempt's archive SHALL hold the draft of its fix change under `fix/`. A subtask's worktree SHALL be removed when the subtask ends and its branch SHALL be kept.

#### Scenario: Two independent subtasks and a dependent one
- **WHEN** a plan has subtasks 1 and 2 without blockers and subtask 3 blocked by both
- **THEN** subtasks 1 and 2 start before either ends, each on its own branch, subtask 3 starts after both in a worktree whose start commit holds both changes, and the attempt commit holds all three changes

#### Scenario: Subtask changed an unplanned file of another subtask
- **WHEN** subtask 2 changes a file that subtask 1, which does not block it, also changed
- **THEN** the attempt is rejected at stage `patch` naming subtasks 1 and 2 and the file, and nothing is built

#### Scenario: Budget spent after the plan
- **WHEN** the plan job finishes and uses the run budget
- **THEN** no subtask starts, the attempt is archived as rejected at stage `model` with the plan job's record labelled, and the cluster is `budget_exhausted`

### Requirement: With fix changes an attempt is planned as subtasks
In a thread with fix changes, an attempt SHALL start with a plan job of job kind `repair` that reads the attempt's worktree and the context copy without changing them, with prompt version `repair-plan-v2` and the attempt's record ID. It SHALL answer `planned` with a reason, a summary and 1 to 5 subtasks, or `no_plan` with a reason. A subtask SHALL have the ID of its position (1 to n), a title, instructions, the files it may change under `Chummer/` or `Core/` and the IDs of the subtasks that block it, all lower than its own. An answer SHALL be `invalid_output` when a subtask's ID is out of order, a blocker is not lower, a path is unsafe or outside `Chummer/` and `Core/`, a subtask names a file twice, the plan names more than 10 files, or two subtasks of which neither blocks the other, directly or through others, name the same file. A `no_plan` answer SHALL reject the attempt at stage `model`.

#### Scenario: Cyclic blockers
- **WHEN** subtask 1 names subtask 2 as its blocker
- **THEN** the plan is `invalid_output`, the attempt is rejected at stage `model` and the cluster is `failed`

#### Scenario: Independent subtasks on one file
- **WHEN** subtasks 1 and 2 have no blockers and both name `Chummer/frmCreate.Designer.cs`
- **THEN** the plan is `invalid_output`
