# Spec Delta

## MODIFIED Requirements

### Requirement: The comparer runs from the root entry points
`npm run compare -- --run <run folder>` SHALL run the comparer alone. `npm start` SHALL run the comparer on each case's run folder as soon as capture has written it, passing it `--no-ocr` and `--tessdata <dir>` when they are given. It SHALL run the comparer when that case's capture exits with 0, 1 or 2, and SHALL NOT run it when capture exits with 3. The exit status of `npm start` SHALL be the highest capture and compare status of its cases. It SHALL be 3 when the candidate build fails, when the file through which capture reports its run folder cannot be created or read, or when the comparer exits with a status other than 0, 1 or 2 or leaves no `compare/report.json` whose status matches its exit status, for example because the comparer could not be built.

#### Scenario: Capture finds visual differences
- **WHEN** `npm start` runs and a case's capture exits with status 1
- **THEN** the comparer runs on that case's run folder
- **AND** `npm start` exits with the highest of the statuses

#### Scenario: Capture setup error
- **WHEN** a case's capture exits with status 3
- **THEN** the comparer does not run for it
- **AND** `npm start` exits with status 3

#### Scenario: The comparer cannot be built
- **WHEN** a case's capture exits with status 0 and the comparer exits with status 1 without writing a report
- **THEN** `npm start` exits with status 3
