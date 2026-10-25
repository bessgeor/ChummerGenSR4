## MODIFIED Requirements

### Requirement: The widened candidate is the accepted source plus the patch
The widened source SHALL be a git worktree in `widening/<cluster>/attempt-<n>/source/` of the thread's folder on the branch `workflow/<thread>/widening/<cluster>/attempt-<n>`, started at the accepted commit: the accepted branch's commit after a promotion, else the thread's source commit. A source commit or accepted commit without `Chummer/` or `Core/` SHALL be a setup error, since the candidate cannot be built without it, and a passed attempt whose archive names no attempt commit SHALL be a setup error. The attempt commit SHALL be applied only when every file it changes has, in the accepted commit, the blob it has in the attempt commit's parent (an added file SHALL not exist there). Otherwise the attempt SHALL be rejected at stage `apply` naming each such file, and nothing SHALL be merged. The change SHALL be applied with git into the worktree without a commit. The widened worktree SHALL be built with the candidate build script through the host runner's CPU pool into the thread's folder, never into `bin/` or `out/candidate/`; exit 1 SHALL reject the attempt at stage `build` and any other non-zero status SHALL be a setup error.

#### Scenario: Accepted source without the class library
- **WHEN** the accepted commit holds `Chummer/` but no `Core/`
- **THEN** preparing the widened source ends with a setup error naming `Core/`, and nothing is built or captured

#### Scenario: An earlier promotion changed the same file
- **WHEN** an attempt commit changes `Chummer/frmCreate.cs` and an attempt promoted earlier in the thread changed that file
- **THEN** the attempt is rejected at stage `apply` naming `Chummer/frmCreate.cs`, and nothing is built or captured for it

#### Scenario: The widened source does not build
- **WHEN** the build script exits with 1 for the widened worktree
- **THEN** the attempt is rejected at stage `build` and no level runs

### Requirement: An attempt whose levels pass is promoted on the accepted branch
When all four levels pass, the attempt SHALL be promoted as a commit on the local branch `accepted/<thread>`. The fix commit SHALL be made in the widened worktree on its branch, with the accepted commit as its parent, holding every change of the worktree that git does not ignore, and SHALL name the thread, the cluster and the repair record in its message. The accepted branch SHALL then be moved to it by a compare-and-swap ref update from the accepted commit (on the first promotion: from not existing), without changing the repository's working tree, index or checked-out branch. A widened worktree that lacks `Chummer/` or `Core/` SHALL be a setup error and make no commit. A tip that already carries the attempt's repair record SHALL be taken as the promotion after a resume, and a worktree branch whose tip carries it SHALL be taken as the fix commit; any other unexpected tip SHALL be a setup error that names the branch, which a thread that can still be resumed needs where it left it. A worktree whose staged `Chummer/` and `Core/` equal the accepted commit's (nothing to commit, for example a patch that differs only in line endings the repository normalises) SHALL fail the widening at stage `promote`, which the rollback then completes, without removing anything before the failure is checkpointed. The promoted worktree and build SHALL become the accepted source and build, and its level runs the baseline, for the next cluster.

#### Scenario: First promotion of a thread whose working tree had uncommitted changes
- **WHEN** the thread's snapshot was taken with an uncommitted edit under `Core/` and its first attempt passes all levels
- **THEN** `accepted/<thread>` holds the snapshot commit, then the source commit with the edit, then the fix commit, and `git status` of the repository is unchanged

#### Scenario: Widened source without the class library
- **WHEN** a promotion's widened worktree holds `Chummer/` but no `Core/`
- **THEN** it ends with a setup error naming `Core/`, and no commit is made

#### Scenario: Nothing to commit
- **WHEN** every level passes and the widened worktree stages the same `Chummer/` and `Core/` as the accepted commit
- **THEN** the attempt is rejected at stage `promote`, no commit is made, and the next cluster is widened

#### Scenario: Killed after the commit
- **WHEN** the run is killed after the ref was updated and before the state recorded it, and the thread is resumed
- **THEN** the promotion takes the existing commit and no second commit is made

### Requirement: A failed attempt is rolled back
When a widening fails at stage `apply`, `build`, a level or `promote`, the attempt SHALL be rolled back: its worktree and build SHALL be removed, its widening branch SHALL be kept, the accepted branch SHALL not be read or changed, and the accepted source, build and baseline SHALL stay as they were, so the next cluster is widened as if the attempt had not been made. Baseline captures made during the failed widening SHALL be kept as runs of the accepted source.

#### Scenario: The second of two attempts introduces a difference
- **WHEN** the first attempt is promoted and the second fails its `mode` level with an `introduced` row
- **THEN** the accepted branch stays at the first attempt's commit, the second attempt's worktree and build are removed while its widening branch stays, and a third cluster would widen on the first attempt's commit

### Requirement: With fix changes the fix commit holds the fix change
In a thread with fix changes, promoting a verified attempt SHALL complete the fix change drafted by its repair with the widening's levels, archive it through the OpenSpec CLI in a staging root under the attempt's widening folder, copy the archived folder into the widened worktree at `fixes/openspec/changes/archive/<archived name>/`, and commit it together with the change of `Chummer/` and `Core/` in the fix commit. The staging root SHALL be made anew on every try. A promotion resumed after its commit was made SHALL take that commit and archive nothing again. A passed attempt without a draft SHALL be a setup error. The fix change SHALL NOT make a commit by itself: a widened worktree whose `Chummer/` and `Core/` stage the accepted trees SHALL be rejected at stage `promote` as in a thread without fix changes.

#### Scenario: Promotion with a fix change
- **WHEN** a verified attempt of a thread with fix changes is promoted
- **THEN** the fix commit's tree holds `Chummer/` and `Core/` with the patch and `fixes/openspec/changes/archive/<date>-fix-<cluster>-<suffix>/` with `proposal.md`, `tasks.md`, `verification.md`, `fix.json` and `.openspec.yaml`, and the repository's working tree is unchanged

#### Scenario: Nothing changed in Chummer/
- **WHEN** a verified attempt of a thread with fix changes has a widened `Chummer/` and `Core/` that stage the accepted trees
- **THEN** it is rejected at stage `promote` and no commit holding only the fix change is made

#### Scenario: Killed after the commit
- **WHEN** the run is killed after the fix commit with its fix change was made and the thread is resumed
- **THEN** the promotion takes the existing commit and no second fix change is archived
