## ADDED Requirements

### Requirement: A rejected attempt is followed by a next attempt
After widening finished, or after repair finished when widening is off, the workflow SHALL start a next repair attempt for each cluster that is retryable, and SHALL widen each next attempt that passes. A cluster SHALL be retryable only when its latest repair attempt was rejected, or passed and its widening was rejected; when that rejection was not an execution failure (a narrow check with status 2 or invalid coverage, or a level or baseline capture with execution failures) and not at widening stage `apply` or `promote`; when its finished attempts are fewer than `repair.maxAttempts` (from the profile, default 2; 1 for a thread whose stored options lack it); and when the thread's charged model time is below the run budget. A repair job that failed with `invalid_output` or `refused`, or that was not started for the budget, SHALL NOT be retried. Next attempts SHALL repeat until no cluster is retryable. A resumed thread SHALL NOT start a next attempt again that it already started.

#### Scenario: Rejected at the narrow check
- **WHEN** a cluster's first attempt is rejected at stage `check` with a visual difference and `repair.maxAttempts` is 2
- **THEN** a second attempt of that cluster runs with its own record and archive `attempt-2`
- **AND** no third attempt runs when the second is rejected too

#### Scenario: Rejected by widening
- **WHEN** a cluster's attempt passes and its widening is rejected at the `character` level with an `introduced` row
- **THEN** a next attempt runs, and when it passes it is widened on the source accepted at that time

#### Scenario: Execution failure
- **WHEN** an attempt's narrow check, or a level run of its widening, ends with status 2
- **THEN** the cluster gets no next attempt and the run's status is 2

#### Scenario: Budget spent
- **WHEN** a cluster's attempt is rejected at stage `check` after the thread's model time reached the run budget
- **THEN** no next attempt starts and the cluster's disposition is `budget_exhausted`

### Requirement: A next attempt sees the earlier attempts
A next attempt SHALL start from the thread's source snapshot like the first. Its prompt SHALL list every earlier attempt of the cluster as untrusted data: its number, whether repair or widening rejected it with the stage, the reason, and the patch text from its archive (empty without a patch, and cut after 20 000 characters with a note of the full length). An archive without its `patch.diff` SHALL end the run with a setup error rather than count as a patch that was never made. The repair prompt version SHALL change with this section.

#### Scenario: Second attempt after a rejected check
- **WHEN** the second attempt of a cluster starts after the first changed `Chummer/frmCreate.cs` and was rejected at stage `check`
- **THEN** its prompt holds the first attempt's patch of `Chummer/frmCreate.cs`, the stage `check` and its reason
- **AND** its source copy does not hold the first attempt's change

#### Scenario: A very large earlier patch
- **WHEN** an earlier attempt was rejected at stage `patch` with a diff of more than 20 000 characters
- **THEN** the next prompt holds its first 20 000 characters and a note of how long the whole patch was

#### Scenario: An archive lost its patch
- **WHEN** a next attempt starts and an earlier attempt's archive folder holds no `patch.diff`
- **THEN** the run ends with a setup error naming the missing file, and the model job does not start

### Requirement: Every cluster ends at a disposition
When the run concludes, every cluster of the thread's `triage.json` SHALL have exactly one disposition: `fixed` when its widening was promoted; else `budget_exhausted` when its diagnosis or repair is `budget_exhausted` or it was retryable but for the spent budget; else `not_diagnosed`, `diagnosis_failed`, `abstained`, `refuted`, `undecided` (also without a check), `not_repaired`, `repair_failed`, `repair_rejected`, `not_widened` or `widening_rejected` after the stage where it stopped. Each disposition SHALL carry the cluster's number of attempts, the stage and reason of its latest rejection (none for a `fixed` cluster, which carries the commit of its fix instead; its earlier rejections stay in `repair.json`).

#### Scenario: Refuted and fixed clusters
- **WHEN** a thread's check refutes one cluster and another cluster's attempt is promoted
- **THEN** the first cluster's disposition is `refuted` with 0 attempts and the second's is `fixed` with its commit

#### Scenario: A next attempt refused at the budget
- **WHEN** a cluster's first attempt was rejected at stage `check` and its next attempt is refused because the run budget is spent
- **THEN** its disposition is `budget_exhausted` with 1 attempt and the stage `check` and reason of the rejection

#### Scenario: Diagnosis turned off
- **WHEN** `npm start -- --no-diagnosis` triages two clusters
- **THEN** both dispositions are `not_diagnosed`

### Requirement: The thread ends with one outcome
Every run whose graph triaged SHALL end in a `conclude` step that decides the thread's outcome: `verified_for_scope` when every cluster's disposition is `fixed` (or there is no cluster), no planned case's capture or compare has status 2, and triage lists no other findings; else `budget_exhausted` when a cluster's disposition is `budget_exhausted`; else `findings_remaining`. The outcome SHALL NOT change the exit status. A run that ends before triage (`--only capture`, `--only compare`, a setup error) SHALL have no outcome.

#### Scenario: Nothing differs
- **WHEN** every planned case's capture and compare exits with 0 and triage finds no cluster
- **THEN** the outcome is `verified_for_scope` and the exit status is 0

#### Scenario: Every cluster fixed
- **WHEN** every capture exits with 1 and the only cluster is fixed
- **THEN** the outcome is `verified_for_scope` and the exit status is 1

#### Scenario: Execution failure in the scope
- **WHEN** triage finds no cluster but one case's capture exits with 2
- **THEN** the outcome is `findings_remaining` and the case is listed as a problem of the scope

#### Scenario: A cluster stays open
- **WHEN** one cluster is fixed and another is `refuted`
- **THEN** the outcome is `findings_remaining`

### Requirement: The outcome is documented and reported
`conclude` SHALL write `outcome.json` in the thread's folder with the thread, the outcome, the scope (the planned cases and captures), the scope's problems, each cluster's disposition, attempts, stage, reason and commit, the accepted branch and commit, and the measures: clusters, fixed, fix rate (null without clusters), attempts, the thread's charged model time and the elapsed time since the thread started (null when the thread does not record its start). The end-of-run report SHALL print one line per cluster with its disposition and an `Outcome:` line with the outcome, the counts and the document's path, after the widening lines.

#### Scenario: Report of a thread with a fix after two attempts
- **WHEN** a cluster is fixed by its second attempt
- **THEN** the report prints that the cluster is `fixed` after 2 attempts with the commit, and `outcome.json` counts 2 attempts and 1 fixed of 1 cluster
