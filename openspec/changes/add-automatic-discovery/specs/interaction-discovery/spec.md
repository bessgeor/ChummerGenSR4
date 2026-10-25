## ADDED Requirements

### Requirement: A workflow thread whose scope shows no difference discovers
A workflow thread SHALL run discovery in its `discovery` stage, a subgraph of the workflow graph between `capture` and `conclude`, when discovery is on for it, its inventory ran, every planned case's capture and compare ended with status 0, and triage found no discrepancy and no other finding; otherwise it SHALL NOT discover. Discovery SHALL be off with `--no-discovery`, `--only`, `--no-diagnosis`, or a case file that is the registry's own case file. The discovery SHALL be a discovery thread with the ID `disc-<workflow thread>`, checkpointed and foldered as `npm run discover` threads are, whose baseline is the workflow thread, whose fixture case file is the thread's `--case-file` or else `parity/cases/characters.json`, whose settings overlay, threshold, canonical cache, unattended flag and rank and scenario configurations are the workflow thread's, and whose targets are the profile's `discovery.targets` (default 3). A workflow thread that is resumed SHALL resume that discovery thread when it is unfinished and SHALL read its conclusion without running it again when it is finished. A setup error of the discovery SHALL end the workflow run with status 3, and the workflow thread SHALL stay resumable. The workflow thread SHALL record the discovery thread, its exit status, the scenarios it admitted and those of them that differ.

#### Scenario: Clean scope
- **WHEN** every planned case captures and compares with status 0 and triage finds no discrepancy
- **THEN** the thread runs discovery thread `disc-<thread>` with the thread as its baseline, then concludes

#### Scenario: A difference remains
- **WHEN** triage finds a cluster
- **THEN** the thread diagnoses it and does not discover

#### Scenario: Resumed during discovery
- **WHEN** the run is stopped while its discovery's scenario jobs run and the workflow thread is resumed
- **THEN** the same discovery thread continues, its finished jobs are not run again, and no second discovery thread starts
