## ADDED Requirements

### Requirement: Each passed repair attempt is widened in order
After repair, the workflow SHALL widen every cluster whose repair attempt passed, one cluster at a time in cluster ID order, each on the source accepted before it: the thread's source snapshot plus the attempts promoted earlier in the thread. No model job SHALL run during widening. Every step of a widening (preparing the widened candidate, each level, the promotion, the rollback) SHALL be checkpointed on its own, so a resumed thread repeats only the step that was interrupted.

#### Scenario: Two passed attempts
- **WHEN** the repairs of two clusters pass
- **THEN** the cluster with the lower ID is widened first, and the second is widened only after the first was promoted or rolled back

#### Scenario: Killed during a level
- **WHEN** a run is killed while the `mode` level of a widening is capturing, and the thread is resumed
- **THEN** the `narrow` and `character` levels are not captured again, and the `mode` level is captured again

### Requirement: The widened candidate is the accepted source plus the patch
The widened source SHALL be a copy of the accepted source's `Chummer/` in the thread's folder with the attempt's patch applied from its archive, and only when every file the patch changes has, in the accepted source, the content the patch was made from (an added file SHALL not exist there). Otherwise the attempt SHALL be rejected at stage `apply` naming each such file, and nothing SHALL be merged. The widened source SHALL be built with the candidate build script through the host runner's CPU pool into the thread's folder, never into `bin/` or `out/candidate/`; exit 1 SHALL reject the attempt at stage `build` and any other non-zero status SHALL be a setup error.

#### Scenario: An earlier promotion changed the same file
- **WHEN** an attempt's patch changes `Chummer/frmCreate.cs` and an attempt promoted earlier in the thread changed that file
- **THEN** the attempt is rejected at stage `apply` naming `Chummer/frmCreate.cs`, and nothing is built or captured for it

#### Scenario: The widened source does not build
- **WHEN** the build script exits with 1 for the widened source
- **THEN** the attempt is rejected at stage `build` and no level runs

### Requirement: Levels widen from the narrow scenario to the full suite
Each widening SHALL run the levels `narrow` (the cluster's cases and captures), `character` (every capture of the cluster's cases), `mode` (every other case of the case file whose mode is a mode of the cluster's cases) and `suite` (every case of the case file not captured at an earlier level), in that order, over the thread's case file regardless of the thread's `--case` and `--capture` selection. Each level SHALL be one capture runner call on the desktop lane with the widened build as candidate and the thread's case file, settings overlay, threshold and canonical cache. A level without a case SHALL pass as `nothing new` without a run. Before each level run and each baseline capture the workflow SHALL check that the thread's canonical executable, canonical support files, settings overlay and capture tools are those the thread started with and that the capture runner's environment fingerprint is the one taken when the thread started; any change SHALL be a setup error. A level run or baseline capture whose coverage lists cases other than the selected ones (the runner also matches `--case` against fixture file names) SHALL be a setup error. The first level that fails SHALL end the ladder.

#### Scenario: Ladder of a build case
- **WHEN** a cluster's members are `build-alpha/skills` and the case file has the build cases `alpha` and `gamma` and the career case `beta`
- **THEN** `narrow` captures `build-alpha` with `skills`, `character` captures `build-alpha` with every capture, `mode` captures `build-gamma` and `suite` captures `career-beta`, each with every capture

#### Scenario: Failing early
- **WHEN** the `character` level fails
- **THEN** neither `mode` nor `suite` is captured

### Requirement: Differences are attributed against the accepted source
A level run with status 2 or invalid coverage SHALL fail the level as an execution failure without attribution. Otherwise each row that is not within the threshold SHALL be classified `target` (its case and capture are a member of the cluster), `introduced` (the baseline row passed), `changed` (the baseline row did not pass and the candidate captures differ in size, one is missing, or their share of differing pixels exceeds the level run's threshold), `pre-existing` (the baseline row did not pass and the candidate captures have the same pixels within that threshold) or `unattributed` (no baseline row). The baseline row SHALL be the newest row for that case and capture among the runs of the accepted source: the thread's capture runs and its diagnosis check run, without those with status 2 or invalid coverage, until an attempt is promoted, then the promoted attempt's level runs, and every baseline capture. Rows without a baseline SHALL first be captured in one run on the accepted build; a baseline capture with status 2 or invalid coverage SHALL fail the level as an execution failure. A level SHALL pass only when it ran without execution failures and each of its rows is within the threshold or `pre-existing`; a difference SHALL never count as pre-existing without a baseline row.

#### Scenario: A difference the patch did not touch
- **WHEN** the `suite` level shows `career-beta/calendar` differing, the thread never captured that case, and the baseline capture on the accepted build shows it differing with the same candidate pixels
- **THEN** the row is `pre-existing`, the level passes and the row is listed as a remaining finding

#### Scenario: A difference the patch brought
- **WHEN** the `character` level shows `build-alpha/common` differing and the thread's own capture of it passed
- **THEN** the row is `introduced` and the level fails

#### Scenario: A pre-existing difference the patch changed
- **WHEN** a row differs in the level and in its baseline, and the two candidate captures differ in more pixels than the threshold allows
- **THEN** the row is `changed` and the level fails

#### Scenario: The target still differs at a wider level
- **WHEN** a capture that is a member of the cluster is not within the threshold at the `character` level
- **THEN** the row is `target` and the level fails

#### Scenario: Execution failure
- **WHEN** a level run exits with 2
- **THEN** the level fails as an execution failure, no row is attributed, and the run's status becomes 2

#### Scenario: A candidate run with execution failures
- **WHEN** the thread's capture of `build-alpha` ended with execution failures and its row for `armor` shows no candidate capture, and the `character` level shows `build-alpha/armor` differing
- **THEN** that row is no baseline, the accepted build is captured for it, and the row is attributed against that capture

#### Scenario: An input changed
- **WHEN** the settings overlay or the capture runner's environment changed between the thread's start and a level run
- **THEN** the level is not captured and the run ends with a setup error

### Requirement: An attempt whose levels pass is promoted on the accepted branch
When all four levels pass, the attempt SHALL be promoted as a commit on the local branch `accepted/<thread>`. On the first promotion the branch SHALL start at the commit the thread's snapshot was taken on, followed by a commit with the snapshot's `Chummer/` when it differs from that commit's. The fix commit SHALL hold the widened source's `Chummer/` with the repository's filters applied as `git add` applies them (the ignore rules of the repository's root are not applied to the widened source, so every file of it is committed) and SHALL name the thread, the cluster and the repair record in its message. It SHALL be written with a private index and a compare-and-swap ref update, without changing the repository's working tree, index or checked-out branch. A tip that already carries the attempt's repair record SHALL be taken as the promotion after a resume; any other unexpected tip SHALL be a setup error that names the branch, which a thread that can still be resumed needs where it left it. A widened source whose staged tree is the accepted tree (nothing to commit, for example a patch that differs only in line endings the repository normalises) SHALL fail the widening at stage `promote`, which the rollback then completes, without removing anything before the failure is checkpointed. The promoted widened source and build SHALL become the accepted source and build, and its level runs the baseline, for the next cluster.

#### Scenario: First promotion of a thread whose working tree had uncommitted changes
- **WHEN** the thread's snapshot was taken with an uncommitted edit under `Chummer/` and its first attempt passes all levels
- **THEN** `accepted/<thread>` holds the snapshot commit, then a commit with the edit, then the fix commit, and `git status` of the repository is unchanged

#### Scenario: Nothing to commit
- **WHEN** every level passes and the widened source stages the same tree as the accepted source
- **THEN** the attempt is rejected at stage `promote`, no commit is made, and the next cluster is widened

#### Scenario: Killed after the commit
- **WHEN** the run is killed after the ref was updated and before the state recorded it, and the thread is resumed
- **THEN** the promotion takes the existing commit and no second commit is made

### Requirement: A failed attempt is rolled back
When a widening fails at stage `apply`, `build`, a level or `promote`, the attempt SHALL be rolled back: its widened source and build SHALL be removed, the accepted branch SHALL not be read or changed, and the accepted source, build and baseline SHALL stay as they were, so the next cluster is widened as if the attempt had not been made. Baseline captures made during the failed widening SHALL be kept as runs of the accepted source.

#### Scenario: The second of two attempts introduces a difference
- **WHEN** the first attempt is promoted and the second fails its `mode` level with an `introduced` row
- **THEN** the branch stays at the first attempt's commit, the second attempt's widened source and build are removed, and a third cluster would widen on the first attempt's source

### Requirement: Every widening is documented and labelled
Each final widening SHALL write `widening/<cluster>/widening.json` in the thread's folder with the attempt and its record, every level (its selection, run folder, execution outcome, rows passed and failed, each failing row's attribution and baseline run, and the baseline capture's run and execution outcome), the outcome `promoted` or `rejected`, the stage and reason of a rejection, and the commit of a promotion. The thread's `widening.json` SHALL list every widening, the accepted branch and commit, and totals. The repair record of a widened attempt SHALL get the automatic `widening` label with the outcome, stage, reason and commit.

#### Scenario: Remaining findings are listed
- **WHEN** an attempt is promoted with two `pre-existing` rows at the `suite` level
- **THEN** its `widening.json` lists both rows with their baseline runs, and the report counts them as pre-existing
