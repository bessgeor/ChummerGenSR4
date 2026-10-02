## MODIFIED Requirements

### Requirement: npm start runs the parity workflow graph
`npm start` SHALL run a LangGraph graph with the nodes build, capture, compare and triage, followed by the diagnosis of triage's clusters, the repair of the confirmed ones, the widening of the passed repair attempts, the next attempts of rejected clusters and a `conclude` step. The build node SHALL build the candidate into `out/` (never into `bin/`) and the capture runner and comparer. The capture node SHALL capture one planned case per step on both executables; each captured case SHALL be compared by the compare node in the same step in which the next case is captured. Triage SHALL run once every planned case is compared, diagnosis once triage finished, repair once diagnosis finished, and widening once repair finished; after widening (or after repair when widening is off) the graph SHALL route the retryable clusters back to repair and widening, and then conclude; `--no-diagnosis` SHALL end the run with `conclude` after triage, `--no-repair` after diagnosis and `--no-widening` after repair and the next attempts. The exit status SHALL be the highest of the planned cases' capture and compare statuses (0, 1 or 2), of the diagnosis status (2 when a cluster's diagnosis failed with `invalid_output` or `refused` or the check run had execution failures, else 0), of the repair status (2 when a repair attempt failed with `invalid_output` or `refused` or a narrow check had execution failures, else 0) and of the widening status (2 when a level run or a baseline capture of a current or earlier widening had execution failures, else 0); the thread's outcome SHALL NOT change it, or 3 for a setup error: a failed build, a capture or compare status of 3, a compare status that does not match its report's status, an unreadable report, invalid options, a desktop lock that cannot be verified, a model job that failed with `infra` (or, outside repair, `timeout`), a widening build that exits with neither 0 nor 1, or an accepted branch at an unexpected commit. A setup error SHALL end the run at once, SHALL stop the child processes of the steps running beside the failed one (including a step still waiting for the desktop lane), and SHALL NOT be reported as any other status. Ctrl+C (and closing the console window) SHALL stop the running steps and their child processes the same way, and the apps a stopped capture started SHALL be stopped even when its runner ended first, release the desktop lane, end the run with status 3 and print the thread to resume. When the run ends, also with `--only`, the workflow SHALL print for each planned case its execution outcome (capture status, whether coverage is valid with its invalid reasons, whether the recorded action indexes are contiguous, failures, and whether the canonical side came from the cache, was live or both) on a line apart from its visual outcome (results passed and failed, the compare status, the report's status, discrepancies, groups and completeness counts), then the triage totals, then for each diagnosed cluster its diagnosis outcome (hypothesis, challenge and check outcome, or the failure kind, abstention or `budget_exhausted`) and the check run's execution outcome apart from its observations, then for each repaired cluster its repair outcome (passed, or rejected with its stage and reason, failed or `budget_exhausted`, and its archive folder) and its narrow check's execution outcome apart from its visual result, then for each widened cluster its outcome (promoted with its commit, or rejected with its stage and reason) and for each level its execution outcome (capture status, coverage, failures, run folder, and those of its baseline capture) apart from its visual result (rows passed and failed, and the failing rows by attribution), then the accepted branch and its commit, then for each cluster its disposition and the thread's outcome. A coverage, results or report document that cannot be read or does not match its schema SHALL be a setup error.

#### Scenario: Pipelined run
- **WHEN** `npm start` runs three cases
- **THEN** case 1 is compared while case 2 is captured, and case 2 while case 3 is captured
- **AND** triage runs after case 3 is compared

#### Scenario: Visual differences and an execution failure
- **WHEN** one case's capture exits with 1 and another's with 2, and every compare exits with 0 or 1
- **THEN** every case is compared and triaged
- **AND** `npm start` exits with status 2

#### Scenario: Setup error in a case
- **WHEN** a case's capture exits with status 3
- **THEN** that case is not compared, the run ends with status 3 and prints the thread to resume
- **AND** no later case is captured

#### Scenario: Compare report does not match its status
- **WHEN** the comparer exits with 0 but its report's status is `differences`, or it writes no report
- **THEN** `npm start` exits with status 3

#### Scenario: A failure stops the step beside it
- **WHEN** the compare of case 1 fails with a setup error while the capture of case 2 is running
- **THEN** the capture runner of case 2 and the processes it started are killed
- **AND** the desktop lane is released

#### Scenario: A failure while the next capture waits for the lane
- **WHEN** the compare of case 1 fails with a setup error while the capture of case 2 waits for a desktop lane another run holds
- **THEN** the wait ends at once and the run ends with status 3 without waiting for the other run

#### Scenario: Ctrl+C
- **WHEN** Ctrl+C is pressed while a capture runs
- **THEN** the capture runner and the Chummer processes it started are stopped, including when the runner ended first, the desktop lane is released and the run exits with status 3 printing the thread to resume

#### Scenario: Execution outcome apart from visual outcome
- **WHEN** a case's capture exits with 1 with valid coverage and its canonical side came from the cache
- **THEN** the run prints one line saying capture status 1, coverage valid and canonical side from the cache
- **AND** another line with that case's results, compare status, report status and completeness counts

#### Scenario: Reported after a partial run
- **WHEN** `npm start -- --only capture` ends
- **THEN** each case's execution line and its results are printed, and its compare outcome is printed as not run

#### Scenario: Diagnosis failure in the exit status
- **WHEN** every capture and compare exits with 1 and one cluster's hypothesis job fails with `invalid_output`
- **THEN** the other clusters are still diagnosed and checked
- **AND** `npm start` exits with status 2

#### Scenario: Diagnosis turned off
- **WHEN** `npm start -- --no-diagnosis` runs and triage reports clusters
- **THEN** no model job and no check run starts, and the exit status is the highest capture and compare status

#### Scenario: Rejected repair in the exit status
- **WHEN** every capture and compare exits with 1, a cluster is confirmed, and its repair attempt is rejected at stage `check` with a visual difference
- **THEN** `npm start` exits with status 1

#### Scenario: Widening in the exit status
- **WHEN** every capture and compare exits with 1, a repair attempt passes, and its widening is rejected at the `mode` level with an `introduced` row
- **THEN** `npm start` exits with status 1
- **AND** when instead the `mode` level's run exits with 2, `npm start` exits with status 2

#### Scenario: Widening turned off
- **WHEN** `npm start -- --no-widening` runs and a repair attempt passes
- **THEN** no widening level runs, no accepted branch is written and no `widening.json` is written

#### Scenario: Outcome after the stages
- **WHEN** a thread's only cluster is fixed by its first attempt
- **THEN** the report prints the widening lines, then the cluster's disposition `fixed` and an `Outcome: verified_for_scope` line
- **AND** the exit status is the highest status of the thread's runs and jobs
