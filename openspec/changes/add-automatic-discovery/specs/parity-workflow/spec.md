## ADDED Requirements

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
