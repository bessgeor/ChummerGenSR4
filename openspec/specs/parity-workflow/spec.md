# parity-workflow Specification

## Purpose
Defines the workflow graph that runs visual parity capture, comparison and triage for every case: its checkpoints and resume, idempotent host steps, the machine-wide desktop lane and CPU pool, the default canonical cache, the per-case report, and discrepancy clusters with identities that stay the same across runs.

## Requirements

### Requirement: npm start runs the parity workflow graph
`npm start` SHALL run a LangGraph graph with the nodes build, capture, compare and triage. The build node SHALL build the candidate into `out/` (never into `bin/`) and the capture runner and comparer. The capture node SHALL capture one planned case per step on both executables; each captured case SHALL be compared by the compare node in the same step in which the next case is captured. Triage SHALL run once every planned case is compared. The exit status SHALL be the highest capture and compare status of the planned cases (0, 1 or 2), or 3 for a setup error: a failed build, a capture or compare status of 3, a compare status that does not match its report's status, an unreadable report, invalid options or a desktop lock that cannot be verified. A setup error SHALL end the run at once, SHALL stop the child processes of the steps running beside the failed one (including a step still waiting for the desktop lane), and SHALL NOT be reported as any other status. Ctrl+C (and closing the console window) SHALL stop the running steps and their child processes the same way, and the apps a stopped capture started SHALL be stopped even when its runner ended first, release the desktop lane, end the run with status 3 and print the thread to resume. When the run ends, also with `--only`, the workflow SHALL print for each planned case its execution outcome (capture status, whether coverage is valid with its invalid reasons, whether the recorded action indexes are contiguous, failures, and whether the canonical side came from the cache, was live or both) on a line apart from its visual outcome (results passed and failed, the compare status, the report's status, discrepancies, groups and completeness counts), then the triage totals. A coverage, results or report document that cannot be read or does not match its schema SHALL be a setup error.

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

### Requirement: Runs are checkpointed and resumable
Each `npm start` SHALL be a thread whose graph state is checkpointed in `out/workflow/` after every step, and SHALL print its thread ID. `npm start -- --resume <thread>` SHALL continue that thread from its last checkpoint with the options it was started with, and SHALL NOT accept other options. Resuming a thread that does not exist or has finished SHALL be a setup error.

#### Scenario: Resume after an interruption
- **WHEN** a run is stopped (killed, Ctrl+C or a setup error) after case 1 was captured and compared, and `npm start -- --resume <thread>` runs
- **THEN** case 1 is neither captured nor compared again
- **AND** the run continues with the cases that had not completed

#### Scenario: Finished thread
- **WHEN** `npm start -- --resume <thread>` names a thread that ran to its end
- **THEN** it exits with status 3 without running any step

### Requirement: Host steps are idempotent
Each capture and compare step SHALL be keyed by a hash of its inputs. For capture: the case's character entry and expanded actions, the case file's timing settings, the fixture, the environment fingerprint the capture runner reports (screens and scale, OS build, Windows colour and text settings, the app's options), the capture filter, the threshold, the canonical executable and support files, the candidate folder, the settings overlay, whether the canonical side may come from the cache, and the capture runner's assemblies. For compare: the capture step and its results and coverage, whether OCR is on, the contents of the `--tessdata` folder, and every file of the comparer's output folder except debug symbols (its assemblies, the OCR engine's libraries and the default language data). A step that ended with status 0 or 1 SHALL be recorded with its key, run folder, status and the hashes of its outputs, which for capture include every screenshot. A later step with the same key SHALL reuse the recorded run folder only if every recorded output still has its hash, and SHALL otherwise run again and print why. Steps that end with status 2 or 3 SHALL NOT be recorded. `--recapture` SHALL make every capture step run again even when a valid record exists, and record the new run; it SHALL be a setup error together with `--only compare` or `--only triage`. If the candidate, the canonical files, the overlay or the capture runner's assemblies change while a thread runs, the next capture step SHALL fail with a setup error, and so SHALL a compare step after the comparer's assemblies changed.

#### Scenario: Unchanged inputs in a new thread
- **WHEN** a second `npm start` runs with the same inputs as a completed one
- **THEN** no capture or compare step runs again
- **AND** each case is reported as reused, with the run folder it came from

#### Scenario: Output changed since it was recorded
- **WHEN** a recorded capture run's `results.json` no longer has its recorded hash
- **THEN** the capture step runs again

#### Scenario: Execution failure is not reused
- **WHEN** a capture step ended with status 2
- **THEN** the next run with the same inputs captures that case again

#### Scenario: Screenshot changed since it was recorded
- **WHEN** a screenshot of a recorded capture run was edited or deleted
- **THEN** the capture step runs again and names the file

#### Scenario: The machine changed
- **WHEN** the screen scale or another part of the environment fingerprint differs from the one a capture step was recorded with
- **THEN** that case is captured again

#### Scenario: Forced recapture
- **WHEN** `npm start -- --recapture` runs with recorded capture steps whose inputs are unchanged
- **THEN** every planned case is captured again and the new runs are recorded

#### Scenario: OCR data replaced
- **WHEN** a file of the comparer's native libraries or language data, or of the `--tessdata` folder, changes
- **THEN** compare steps recorded before are not reused

#### Scenario: The runner covers another case
- **WHEN** a capture's `--case` value also selects a second case through its fixture file name, so the run's coverage lists two cases
- **THEN** the step fails with a setup error naming both cases and nothing is recorded

#### Scenario: Tools rebuilt during a thread
- **WHEN** the capture runner's assemblies differ from the ones the thread started with and the thread resumes
- **THEN** the next capture step fails with a setup error saying that its inputs changed since the thread started

### Requirement: Host processes share a desktop lane and a CPU pool
Every child process SHALL run through one host runner. Capture SHALL hold the machine-wide desktop lane, a lock file that records the owner's host, process ID and a token, for the whole step. The owner SHALL refresh the lock's modification time while it holds the lane, and a lock of this host that has not been refreshed for ninety seconds SHALL count as abandoned even if a process with its ID exists. Waiting for the lane SHALL end when the run is stopped. A failure to release the lane SHALL NOT replace the error of the child that failed. A lock whose owner process on this host is no longer running SHALL be taken over, by one run at a time and only if the lock still holds the token that was judged abandoned when the takeover happens; a lock whose owner is running SHALL be waited for; a lock that stays unreadable, or a takeover guard that stays in place, SHALL be a setup error naming the file. A step SHALL release only a lock that still holds its own token. Builds and compares SHALL run in a CPU pool whose size is set by the local profile, or by default half the logical processors, at least 1 and at most 4. A child that cannot start or ends from a signal SHALL be a setup error.

#### Scenario: Another run holds the desktop
- **WHEN** a capture step starts while a running process on this machine holds the desktop lane
- **THEN** the step waits, printing whom it waits for, and captures once the lane is released

#### Scenario: Abandoned lock
- **WHEN** the lock names a process on this host that is no longer running
- **THEN** the capture step takes the lane over without waiting

#### Scenario: Process ID reused
- **WHEN** the lock names a process on this host that exists but the lock has not been refreshed for ninety seconds
- **THEN** the capture step takes the lane over and says that the process ID may belong to another program

#### Scenario: Two waiters find the same abandoned lock
- **WHEN** two runs both read a lock of a dead process, and the first replaces it with its own lock
- **THEN** the second leaves the first's lock in place and waits for it

#### Scenario: Child ended by a signal
- **WHEN** a child process ends from a signal
- **THEN** the step fails with a setup error and the lane is released

### Requirement: A single node can run with --only
`npm start -- --only <node>` with `capture`, `compare` or `triage` SHALL run that node for every planned case. The nodes before it SHALL take their results from recorded steps and SHALL fail with a setup error naming the case when a step has no valid record. The nodes after it SHALL NOT run. The candidate SHALL be built only when the selected node is `capture`.

#### Scenario: Triage alone
- **WHEN** every planned case has recorded capture and compare steps and `npm start -- --only triage` runs
- **THEN** no capture or compare runs and triage writes its output

#### Scenario: Compare without a recorded capture
- **WHEN** `npm start -- --only compare` runs and a planned case has no recorded capture step
- **THEN** the run ends with status 3 naming that case

### Requirement: Capture uses the machine-wide canonical cache by default
The workflow SHALL pass the capture runner a canonical cache folder: `--canonical-cache <dir>` when given, else the `PARITY_CANONICAL_CACHE` environment variable, else the `canonicalCache` of the local workflow profile, else a folder in the user's local application data. `--live-canonical` SHALL pass no cache, so every canonical side runs live. The local profile is an optional JSON file (`PARITY_WORKFLOW_PROFILE` or the user's local application data) with `canonicalCache`, `settingsOverlay` and `cpuPool`; an invalid profile SHALL be a setup error. A settings overlay given on the command line SHALL take precedence over the profile's.

#### Scenario: Default cache
- **WHEN** `npm start` runs without cache options and `PARITY_CANONICAL_CACHE` is set
- **THEN** capture uses that folder and each case's summary records the cache with its hits, misses and stores

#### Scenario: Live canonical evidence
- **WHEN** `npm start -- --live-canonical` runs
- **THEN** every canonical side in the summaries has source `live`

### Requirement: Triage groups discrepancies into clusters with stable identity
Triage SHALL read every compared case's report and put each discrepancy into the first cluster whose representative has the same image hash and a core position match of at least 97 %, across cases. Each cluster SHALL get an identity that is reused when a stored identity has the same image hash and a core position match of at least 97 %, and is otherwise derived from the image hash and the core and stored. Report rows that failed, have a size mismatch or miss a capture, and completeness entries that are `execution-lost` or `unaccounted`, SHALL be listed apart from the clusters and SHALL NOT be dropped. Triage SHALL write the thread's `triage.json` with each case's capture and compare outcome, the clusters with their members and crops, the other findings and totals. OCR text SHALL NOT decide membership or identity. An identity that the same thread stored on an earlier triage that did not finish SHALL keep its ID and SHALL be reported as new. Each case's `triage.json` entry SHALL record whether its canonical sides came from the cache, ran live or both (`mixed`). A report that cannot be read or does not match its schema SHALL be a setup error, and so SHALL a report that another run replaced after the compare step recorded it.

#### Scenario: Same change in two cases
- **WHEN** two cases each report a discrepancy with the same image hash at nearly the same place
- **THEN** both are members of one cluster

#### Scenario: Identity in a later run
- **WHEN** a later thread reports a discrepancy with the same image hash and a core a few pixels away
- **THEN** its cluster has the identity the earlier thread stored

#### Scenario: Missing capture
- **WHEN** a report row has status `missing-candidate`
- **THEN** it is listed under the other findings with its case and capture

#### Scenario: Triage run again in the same thread
- **WHEN** triage stored a new identity and the thread was resumed before `triage.json` was written
- **THEN** the second triage reports that cluster with the same identity as new

#### Scenario: Partly cached canonical sides
- **WHEN** a case has one canonical side from the cache and one that ran live
- **THEN** its triage entry says `mixed`

#### Scenario: Report replaced by another run
- **WHEN** another run compares the same capture again with other options between this run's compare and its triage
- **THEN** triage fails with a setup error naming the case and the run folder
