## RENAMED Requirements

- FROM: `### Requirement: Each confirmed cluster gets one repair attempt`
- TO: `### Requirement: Each confirmed cluster gets a repair attempt`

## MODIFIED Requirements

### Requirement: Each confirmed cluster gets a repair attempt
After diagnosis finished, the workflow SHALL start one repair attempt for each cluster whose check outcome is `confirmed`, and none for a cluster that is `refuted`, `undecided`, abstained, failed or `budget_exhausted`. The attempts SHALL run in parallel: their model jobs up to the model pool size, their builds in the CPU pool and their checks one at a time on the desktop lane. A cluster SHALL get a further attempt only as the loop's next attempt after a rejection, and none after an attempt passed and was promoted. `--no-repair` SHALL end the run after diagnosis, and `--only` of any node SHALL run no repair. An attempt that a stopped or killed run interrupted SHALL start again from its model job when the thread is resumed; a finished attempt SHALL NOT run again. When an attempt's model job fails with `quota_exhausted`, the graph SHALL wait with the diagnosis quota waits and then start the attempt again. A model job that cannot start because the run budget is spent SHALL leave its cluster `budget_exhausted`. The thread's `repair.json` SHALL list each repaired cluster's status, latest attempt, earlier attempts and records, with totals.

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
