## ADDED Requirements

### Requirement: An attempt runs its tries side by side and selects the best
The profile's `repair.tries` (an integer from 1 to 3, default 1) SHALL set how many tries an attempt makes per confirmed hypothesis of its cluster, at most 6 in all. The tries SHALL start together, each as a single or planned attempt with the record ID `<attempt record>/try-<k>`, its own worktree and branch `workflow/<thread>/repair/<cluster>/attempt-<n>-try-<k>` (an attempt of one try keeps the attempt's own record ID and branch `workflow/<thread>/repair/<cluster>/attempt-<n>`), its hypothesis's answer, challenge and observations in its prompt, and the attempt's deadline; each SHALL go through the patch guard, the build and the narrow check on its own. A usage limit in any try SHALL park the attempt until the quota wait ends, after which the attempt starts again under a new number; the model time of the jobs that finished SHALL be charged. The attempt SHALL pass when at least one try passed and SHALL select, among the passed tries, the one with the fewest added plus removed lines, then the fewest files, then the lowest try number. A rejected attempt's reason SHALL list each try's stage and reason. The archive SHALL hold every try in `try-<k>/` with its own `attempt.json` fields, mark the selected try and keep the selected try's branch, commit, patch, build and check at its top level; a next attempt's prompt SHALL list every try of an earlier attempt with its patch.

#### Scenario: Two passed tries
- **WHEN** an attempt has two tries that pass, the first changing 12 lines and the second 5
- **THEN** the attempt passes with the second try selected, and the first is archived as passed and not selected

#### Scenario: Every try rejected
- **WHEN** one try is rejected at stage `build` and the other at stage `check`
- **THEN** the attempt is rejected with both stages and reasons, and a next attempt's prompt shows both patches

## MODIFIED Requirements

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
