## MODIFIED Requirements

### Requirement: The widened candidate is the accepted source plus the patch
The widened source SHALL be a copy of the accepted source's `Chummer/` and `Core/` in the thread's folder, and an accepted source that lacks either folder SHALL be a setup error, since the candidate cannot be built without it. The attempt's patch SHALL be applied from its archive, and only when every file the patch changes has, in the accepted source, the content the patch was made from (an added file SHALL not exist there). Otherwise the attempt SHALL be rejected at stage `apply` naming each such file, and nothing SHALL be merged. The widened source SHALL be built with the candidate build script through the host runner's CPU pool into the thread's folder, never into `bin/` or `out/candidate/`; exit 1 SHALL reject the attempt at stage `build` and any other non-zero status SHALL be a setup error.

#### Scenario: Accepted source without the class library
- **WHEN** the accepted source holds `Chummer/` but no `Core/`
- **THEN** preparing the widened source ends with a setup error naming `Core/`, and nothing is built or captured

#### Scenario: An earlier promotion changed the same file
- **WHEN** an attempt's patch changes `Chummer/frmCreate.cs` and an attempt promoted earlier in the thread changed that file
- **THEN** the attempt is rejected at stage `apply` naming `Chummer/frmCreate.cs`, and nothing is built or captured for it

#### Scenario: The widened source does not build
- **WHEN** the build script exits with 1 for the widened source
- **THEN** the attempt is rejected at stage `build` and no level runs

### Requirement: An attempt whose levels pass is promoted on the accepted branch
When all four levels pass, the attempt SHALL be promoted as a commit on the local branch `accepted/<thread>`. On the first promotion the branch SHALL start at the commit the thread's snapshot was taken on, followed by a commit with the snapshot's `Chummer/` and `Core/` when they differ from that commit's. A widened source that lacks `Chummer/` or `Core/` SHALL be a setup error and make no commit. The fix commit SHALL hold the widened source's `Chummer/` and `Core/` with the repository's filters applied as `git add` applies them (the ignore rules of the repository's root are not applied to the widened source, so every file of it is committed) and SHALL name the thread, the cluster and the repair record in its message. It SHALL be written with a private index and a compare-and-swap ref update, without changing the repository's working tree, index or checked-out branch. A tip that already carries the attempt's repair record SHALL be taken as the promotion after a resume; any other unexpected tip SHALL be a setup error that names the branch, which a thread that can still be resumed needs where it left it. A widened source whose staged tree is the accepted tree (nothing to commit, for example a patch that differs only in line endings the repository normalises) SHALL fail the widening at stage `promote`, which the rollback then completes, without removing anything before the failure is checkpointed. The promoted widened source and build SHALL become the accepted source and build, and its level runs the baseline, for the next cluster.

#### Scenario: First promotion of a thread whose working tree had uncommitted changes
- **WHEN** the thread's snapshot was taken with an uncommitted edit under `Core/` and its first attempt passes all levels
- **THEN** `accepted/<thread>` holds the snapshot commit, then a commit with the edit, then the fix commit, and `git status` of the repository is unchanged

#### Scenario: Widened source without the class library
- **WHEN** a promotion's widened source holds `Chummer/` but no `Core/`
- **THEN** it ends with a setup error naming `Core/`, and no commit is made

#### Scenario: Nothing to commit
- **WHEN** every level passes and the widened source stages the same tree as the accepted source
- **THEN** the attempt is rejected at stage `promote`, no commit is made, and the next cluster is widened

#### Scenario: Killed after the commit
- **WHEN** the run is killed after the ref was updated and before the state recorded it, and the thread is resumed
- **THEN** the promotion takes the existing commit and no second commit is made

### Requirement: With fix changes the fix commit holds the fix change
In a thread with fix changes, promoting a verified attempt SHALL complete the fix change drafted by its repair with the widening's levels, archive it through the OpenSpec CLI in a staging root under the attempt's widening folder, copy the archived folder into the widened source at `fixes/openspec/changes/archive/<archived name>/`, and stage that folder together with `Chummer/` and `Core/` in the fix commit. The staging root SHALL be made anew on every try. A promotion resumed after its commit was made SHALL take that commit and archive nothing again. A passed attempt without a draft SHALL be a setup error. The fix change SHALL NOT make a commit by itself: a widened source whose `Chummer/` and `Core/` stage the accepted trees SHALL be rejected at stage `promote` as in a thread without fix changes.

#### Scenario: Promotion with a fix change
- **WHEN** a verified attempt of a thread with fix changes is promoted
- **THEN** the fix commit's tree holds `Chummer/` and `Core/` with the patch and `fixes/openspec/changes/archive/<date>-fix-<cluster>-<suffix>/` with `proposal.md`, `tasks.md`, `verification.md`, `fix.json` and `.openspec.yaml`, and the repository's working tree is unchanged

#### Scenario: Nothing changed in Chummer/
- **WHEN** a verified attempt of a thread with fix changes has a widened `Chummer/` and `Core/` that stage the accepted trees
- **THEN** it is rejected at stage `promote` and no commit holding only the fix change is made

#### Scenario: Killed after the commit
- **WHEN** the run is killed after the fix commit with its fix change was made and the thread is resumed
- **THEN** the promotion takes the existing commit and no second fix change is archived
