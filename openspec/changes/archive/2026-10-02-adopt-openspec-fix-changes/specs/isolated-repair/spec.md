## ADDED Requirements

### Requirement: With fix changes an attempt is planned as subtasks
In a thread with fix changes, an attempt SHALL start with a plan job of job kind `repair` in a read-only copy of the snapshot and the context, with prompt version `repair-plan-v1` and the attempt's record ID. It SHALL answer `planned` with a reason, a summary and 1 to 5 subtasks, or `no_plan` with a reason. A subtask SHALL have the ID of its position (1 to n), a title, instructions, the files it may change under `Chummer/` and the IDs of the subtasks that block it, all lower than its own. An answer SHALL be `invalid_output` when a subtask's ID is out of order, a blocker is not lower, a path is unsafe or outside `Chummer/`, a subtask names a file twice, the plan names more than 10 files, or two subtasks of which neither blocks the other, directly or through others, name the same file. A `no_plan` answer SHALL reject the attempt at stage `model`.

#### Scenario: Cyclic blockers
- **WHEN** subtask 1 names subtask 2 as its blocker
- **THEN** the plan is `invalid_output`, the attempt is rejected at stage `model` and the cluster is `failed`

#### Scenario: Independent subtasks on one file
- **WHEN** subtasks 1 and 2 have no blockers and both name `Chummer/frmCreate.Designer.cs`
- **THEN** the plan is `invalid_output`

### Requirement: Independent subtasks are implemented in parallel and joined
Each subtask whose blockers are done SHALL start as a writable job of job kind `repair` with prompt version `repair-task-v1` and record ID `<attempt record>/task-<id>`, in its own scratch folder outside the repository that holds a copy of the snapshot with its blockers' changes and a read-only copy of the context; subtasks of the same wave SHALL run at the same time up to the model pool size. A subtask's change SHALL be the files that differ from the copy it started with and SHALL be exactly the files its answer lists, else the attempt SHALL be rejected at stage `patch`. The changes SHALL be joined in ID order onto a copy of the snapshot; a file whose joined content is not the content a subtask started from SHALL reject the attempt at stage `patch`, naming both subtasks. The joined copy SHALL then pass the patch guard, with the subtasks' files as the declared list, the build and the narrow check as a single attempt does. A subtask's failure or `no_patch` answer SHALL reject the attempt at stage `model` (stage `deadline` for a timeout) and start no further wave, also when the spent run budget kept another subtask of its wave from starting; a usage limit SHALL park the attempt until the quota wait ends, after which it starts again under a new attempt number, and the model time of the jobs that finished before the limit SHALL be charged to the thread. A run budget spent after some of the attempt's jobs finished, before the next could start, SHALL end the attempt as rejected at stage `model`, archived like any rejected attempt with the labels of its finished jobs, and the cluster SHALL be `budget_exhausted`. The deadline SHALL run from the plan job's start over every job and the build, and a subtask's time limit SHALL be the smaller of its own and what is left of the deadline when it gets its place in the model pool. A subtask's copy holds the changes of every subtask that blocks it, directly or through others, and its prompt SHALL say so. The joined answer SHALL list the files whose joined content differs from the snapshot's. Every job SHALL be an eval record and charged to the run budget; the archive SHALL hold the plan and each subtask with its record, files and outcome, every subtask record SHALL get the attempt's `repair` label, and a passed attempt's archive SHALL hold the draft of its fix change under `fix/`.

#### Scenario: Two independent subtasks and a dependent one
- **WHEN** a plan has subtasks 1 and 2 without blockers and subtask 3 blocked by both
- **THEN** subtasks 1 and 2 start before either ends, subtask 3 starts after both with a copy holding both changes, and the joined patch holds all three changes

#### Scenario: Subtask changed an unplanned file of another subtask
- **WHEN** subtask 2 changes a file that subtask 1, which does not block it, also changed
- **THEN** the attempt is rejected at stage `patch` naming subtasks 1 and 2 and the file, and nothing is built

#### Scenario: Budget spent after the plan
- **WHEN** the plan job finishes and uses the run budget
- **THEN** no subtask starts, the attempt is archived as rejected at stage `model` with the plan job's record labelled, and the cluster is `budget_exhausted`
