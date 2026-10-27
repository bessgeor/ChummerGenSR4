# parity-workflow Specification

## Purpose
Defines the workflow graph that runs visual parity capture, comparison and triage for every case: its checkpoints and resume, idempotent host steps, the desktop lanes and CPU pool, the default canonical cache, the per-case report, and discrepancy clusters with identities that stay the same across runs.

## Requirements

### Requirement: npm start runs the parity workflow graph
`npm start` SHALL run a LangGraph graph with the nodes build, capture, compare and triage, followed by the diagnosis of triage's clusters, the repair of the confirmed ones, the widening of the passed repair attempts, the next attempts of rejected clusters and a `conclude` step. The build node SHALL build the candidate into `out/` (never into `bin/`) and the capture runner and comparer. Each step SHALL capture as many planned cases as the host has desktop lanes, each on both executables, and compare the cases captured in the step before; with one lane each captured case is compared in the same step in which the next case is captured. Triage SHALL run once every planned case is compared, diagnosis once triage finished, repair once diagnosis finished, and widening once repair finished; after widening (or after repair when widening is off) the graph SHALL route the retryable clusters back to repair and widening, and then conclude; `--no-diagnosis` SHALL end the run with `conclude` after triage, `--no-repair` after diagnosis and `--no-widening` after repair and the next attempts. The exit status SHALL be the highest of the planned cases' capture and compare statuses (0, 1 or 2), of the diagnosis status (2 when a cluster's diagnosis failed with `invalid_output` or `refused` or the check run had execution failures, else 0), of the repair status (2 when a repair attempt failed with `invalid_output` or `refused` or a narrow check had execution failures, else 0) and of the widening status (2 when a level run or a baseline capture of a current or earlier widening had execution failures, else 0); the thread's outcome SHALL NOT change it, or 3 for a setup error: a failed build, a capture or compare status of 3, a compare status that does not match its report's status, an unreadable report, invalid options, a desktop lock that cannot be verified, a lane that cannot be reached or differs from the others, a model job that failed with `infra` (or, outside repair, `timeout`), a widening build that exits with neither 0 nor 1, or an accepted branch at an unexpected commit. A setup error SHALL end the run at once, SHALL stop the child processes of the steps running beside the failed one (including a step still waiting for a desktop lane), and SHALL NOT be reported as any other status. Ctrl+C (and closing the console window) SHALL stop the running steps and their child processes the same way, and the apps a stopped capture started SHALL be stopped even when its runner ended first, release the desktop lanes, end the run with status 3 and print the thread to resume. When the run ends, also with `--only`, the workflow SHALL print for each planned case its execution outcome (capture status, whether coverage is valid with its invalid reasons, whether the recorded action indexes are contiguous, failures, and whether the canonical side came from the cache, was live or both) on a line apart from its visual outcome (results passed and failed, the compare status, the report's status, discrepancies, groups and completeness counts), then the triage totals, then for each diagnosed cluster its diagnosis outcome (hypothesis, challenge and check outcome, or the failure kind, abstention or `budget_exhausted`) and the check run's execution outcome apart from its observations, then for each repaired cluster its repair outcome (passed, or rejected with its stage and reason, failed or `budget_exhausted`, and its archive folder) and its narrow check's execution outcome apart from its visual result, then for each widened cluster its outcome (promoted with its commit, or rejected with its stage and reason) and for each level its execution outcome (capture status, coverage, failures, run folder, and those of its baseline capture) apart from its visual result (rows passed and failed, and the failing rows by attribution), then the accepted branch and its commit, then for each cluster its disposition and the thread's outcome. A coverage, results or report document that cannot be read or does not match its schema SHALL be a setup error.

#### Scenario: Pipelined run
- **WHEN** `npm start` runs three cases on one desktop lane
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
Every child process SHALL run through one host runner. A capture runner call SHALL hold a desktop lane of the profile's lanes (see `desktop-lanes`) for the whole call; each lane's lock is a file that records the owner's host, process ID and a token. The owner SHALL refresh the lock's modification time while it holds the lane, and a lock of this host that has not been refreshed for ninety seconds SHALL count as abandoned even if a process with its ID exists. A lock of another host SHALL count as abandoned once this process has seen it unchanged for ninety seconds by its own clock. Waiting for a lane SHALL end when the run is stopped. A failure to release a lane SHALL NOT replace the error of the child that failed. A lock whose owner process on this host is no longer running SHALL be taken over, by one run at a time and only if the lock still holds the token that was judged abandoned when the takeover happens; a lock whose owner is running SHALL be waited for; a lock that stays unreadable, or a takeover guard that stays in place, SHALL be a setup error naming the file. A step SHALL release only a lock that still holds its own token. Builds and compares SHALL run in a CPU pool whose size is set by the local profile, or by default half the logical processors, at least 1 and at most 4. A child that cannot start or ends from a signal SHALL be a setup error. Stopping a desktop command SHALL stop the apps started from the run folders in the current Windows session only.

#### Scenario: Another run holds the desktop
- **WHEN** a capture step starts while a running process on this machine holds the only desktop lane
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

#### Scenario: Apps of another session
- **WHEN** a stopped capture's apps are stopped while another Windows session runs apps from the same run folders
- **THEN** only the apps of the workflow's own session are stopped

### Requirement: A single node can run with --only
`npm start -- --only <node>` with `capture`, `compare`, `triage` or `diagnose` SHALL run that node for every planned case (for `diagnose`: for every cluster of triage). The nodes before it SHALL take their results from recorded steps and SHALL fail with a setup error naming the case when a step has no valid record; triage runs again from the recorded reports. The nodes after it SHALL NOT run. The candidate SHALL be built only when the selected node is `capture`. `--only diagnose` with `--no-diagnosis` SHALL be a setup error.

#### Scenario: Triage alone
- **WHEN** every planned case has recorded capture and compare steps and `npm start -- --only triage` runs
- **THEN** no capture or compare runs and triage writes its output
- **AND** no model job runs

#### Scenario: Compare without a recorded capture
- **WHEN** `npm start -- --only compare` runs and a planned case has no recorded capture step
- **THEN** the run ends with status 3 naming that case

#### Scenario: Diagnosis alone
- **WHEN** every planned case has recorded capture and compare steps and `npm start -- --only diagnose` runs
- **THEN** no capture or compare runs, triage runs from the recorded reports, and its clusters are diagnosed and checked

### Requirement: Capture uses the machine-wide canonical cache by default
The workflow SHALL pass the capture runner a canonical cache folder: `--canonical-cache <dir>` when given, else the `PARITY_CANONICAL_CACHE` environment variable, else the `canonicalCache` of the local workflow profile, else a folder in the user's local application data. `--live-canonical` SHALL pass no cache, so every canonical side runs live. The local profile is an optional JSON file (`PARITY_WORKFLOW_PROFILE` or the user's local application data) with `canonicalCache`, `settingsOverlay`, `cpuPool`, `lanes`, `agents`, `certificates`, `tuning` and `repair`; an invalid profile SHALL be a setup error. A settings overlay given on the command line SHALL take precedence over the profile's. The check run of diagnosis and the narrow checks of repair SHALL use the same cache folder as the thread's captures.

#### Scenario: Default cache
- **WHEN** `npm start` runs without cache options and `PARITY_CANONICAL_CACHE` is set
- **THEN** capture uses that folder and each case's summary records the cache with its hits, misses and stores

#### Scenario: Live canonical evidence
- **WHEN** `npm start -- --live-canonical` runs
- **THEN** every canonical side in the summaries has source `live`, including the check run's and the narrow checks'

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

### Requirement: Unattended runs need certificates
`npm start -- --unattended` SHALL, before any node runs and again whenever the thread is resumed, require for each job kind that the run's diagnosis dispatches (`hypothesis` and `challenge`; none with `--no-diagnosis` or with `--only` of a node before diagnosis) a certificate in the certificates folder (the profile's `certificates`, else `workflow/evals/certificates/`) that is valid and names the thread's provider, model and effort for that job kind and the prompt version the code uses. A run that would dispatch repair jobs (repair on, diagnosis on and no `--only`) SHALL NOT start unattended, since no certificate covers the `repair` job kind; the problem SHALL say to add `--no-repair`. A missing, invalid or differing certificate, or repair, SHALL end the run with status 3 naming each job kind and the reason, before the build. A resumed thread SHALL keep `--unattended`. Without `--unattended` no certificate SHALL be required.

#### Scenario: No certificate
- **WHEN** `npm start -- --unattended --no-repair` runs and the certificates folder has no `challenge.json`
- **THEN** the run ends with status 3 naming `challenge` before the build, and nothing is captured

#### Scenario: Certificate for another effort
- **WHEN** the hypothesis certificate names effort `low` and the profile runs hypotheses with effort `medium`
- **THEN** the run ends with status 3 naming `hypothesis` and both efforts

#### Scenario: Diagnosis turned off
- **WHEN** `npm start -- --unattended --no-diagnosis` runs without certificates
- **THEN** the run starts

#### Scenario: Unattended repair
- **WHEN** `npm start -- --unattended` runs with valid hypothesis and challenge certificates and without `--no-repair`
- **THEN** the run ends with status 3 naming `repair` and saying to add `--no-repair`, before the build

### Requirement: Capture steps record UI trees and triage is followed by the inventory
The workflow's capture steps SHALL run the capture runner with `--ui-tree`, use a step key format under which records made without trees miss, and keep the tree files among the outputs a reused step must still have intact; check, narrow, level and baseline captures SHALL NOT record trees. Whenever triage runs, including with `--only triage`, an `inventory` node SHALL follow it and then route as triage did. The node SHALL write `out/workflow/threads/<thread>/inventory/source-inventory.json` and `coverage-manifest.json` from the thread's capture runs and the run's report SHALL print one `Inventory:` line, after the triage totals, with the number of classes and active classes, observed controls of the active ones, exercised interactions of the active ones, observed tuples of the planned ones and unresolved automation IDs. Any setup error of the inventory SHALL end the run with status 3 and leave the thread resumable at the inventory; the inventory SHALL NOT otherwise change the exit status. A thread stored before the node existed, whose capture runs recorded no trees, SHALL skip it, and its report SHALL say that the inventory did not run.

#### Scenario: Inventory after triage
- **WHEN** `npm start` captures, compares and triages every case
- **THEN** the thread's `inventory/` folder holds both documents before diagnosis starts, and the run's report prints the `Inventory:` line after the triage totals

#### Scenario: A reused capture without trees
- **WHEN** a capture step recorded before trees existed has the same inputs otherwise
- **THEN** its key differs, so the case is captured again with trees

#### Scenario: A thread from before the inventory
- **WHEN** a thread checkpointed before the inventory node existed is resumed and reaches it
- **THEN** the node does nothing, the thread goes on to diagnosis or `conclude`, and the report says the inventory did not run

#### Scenario: Source changed since the build
- **WHEN** `npm start -- --only triage` runs after `Chummer/` changed since the candidate was built
- **THEN** the inventory node fails with a setup error and the run exits with 3

### Requirement: The default suite holds the discovered scenarios
When `npm start` starts a thread without `--case-file`, it SHALL write the thread's suite to `out/workflow/threads/<thread>/suite-cases.json` and use it as the thread's case file: the document of `parity/cases/characters.json` with each character's path relative to the suite's folder, followed by the characters of `parity/cases/discovered.json` with their paths rewritten the same way when the discovery registry exists. A registry without its case file or the other way round, a case file that is not the registry's rendering, a discovered file whose startup delay or settle time differs from the fixture file's, or a case name that both files have SHALL be a setup error before the build. The suite SHALL be written once when the thread starts and a resumed thread SHALL keep it. With `--case-file` the thread SHALL use that file as before. A capture step recorded for a fixture case from `parity/cases/characters.json` SHALL be reused for the same case planned from the suite.

#### Scenario: Discovered scenarios captured by default
- **WHEN** the registry holds two admitted scenarios and `npm start` runs without `--case-file`
- **THEN** the thread plans the fixture cases followed by the two scenarios and captures all of them

#### Scenario: Case file out of step with the registry
- **WHEN** `parity/cases/discovered.json` was edited without the registry
- **THEN** `npm start` exits with 3 before the build, naming the case file

### Requirement: The exit status counts the thread's discovery
`npm start` SHALL accept `--no-discovery`. A thread that discovered SHALL exit with the highest of the status it would have without discovery and the discovery's exit status when that is 1 or 2. The end-of-run report SHALL print a `Discovery:` line with the discovery thread, its exit status, the scenarios it admitted and those that differ, after the triage and inventory lines. A thread that discovers SHALL read the active rank and scenario configurations into its options when it starts, and `--unattended` SHALL then also require certificates for the rank and scenario jobs before anything runs.

#### Scenario: An admitted scenario differs
- **WHEN** a thread's scope is clean and its discovery admits a scenario that differs
- **THEN** `npm start` exits with 1 and the report names the scenario

#### Scenario: Discovery turned off
- **WHEN** `npm start -- --no-discovery` runs on a clean scope
- **THEN** no discovery thread starts and the exit status is 0

### Requirement: The workflow graph is made of stage subgraphs
The workflow graph SHALL consist of one node per stage, each a compiled LangGraph subgraph sharing the thread's state: `start` (the build), `capture` (the captures and compares of the planned cases, then triage and the inventory), `discovery` (the thread's discovery thread, when the planned scope shows no difference), `diagnose`, `repair`, `widen` and `conclude`. The stage IDs SHALL be exported from the workflow's code and SHALL NOT change. The routing between stages, the next attempts back to `repair` and the stages a thread's options leave out SHALL be edges of the workflow graph. Fan-outs SHALL stay inside their stage, so a pending task's arguments are in its stage's checkpoint namespace. `getGraphAsync({ xray: true })` SHALL draw every stage with its inner nodes, and `getState(config, { subgraphs: true })` SHALL return the running stage's state and pending tasks. The host steps, model jobs, documents, exit statuses and outcomes SHALL be those of the same thread without stages. A thread checkpointed before the workflow graph had stages SHALL NOT be resumed: `npm start -- --resume` SHALL end with a setup error that says so, and a new thread SHALL reuse the old thread's recorded capture and compare steps.

#### Scenario: Stages in the drawing
- **WHEN** the workflow graph is drawn with `xray`
- **THEN** its nodes are `start`, `capture`, `discovery`, `diagnose`, `repair`, `widen` and `conclude`, and `capture` contains `capture`, `compare`, `triage` and `inventory`

#### Scenario: A fan-out seen from outside
- **WHEN** a thread captures three cases on one lane and its state is read with subgraphs during the first capture
- **THEN** the `capture` stage's state shows the capture task of the first case with its case index in the `capture` namespace

#### Scenario: Killed inside a stage
- **WHEN** a run is killed while a challenge job of the `diagnose` stage runs and the thread is resumed
- **THEN** the hypothesis jobs are not run again and the challenge job runs again

#### Scenario: A thread of the flat graph
- **WHEN** `npm start -- --resume` names a thread checkpointed before the workflow graph had stages
- **THEN** it exits with 3 saying the thread cannot be resumed and that a new thread reuses its recorded steps
