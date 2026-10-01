# Spec Delta

## ADDED Requirements

### Requirement: The report accounts for every planned capture
The comparer SHALL read the run's `coverage.json` and add a `completeness` section to the report with one entry per planned capture of every case, in plan order, each in exactly one state: `reported` (its row is in the report and did not fail), `analysis-failed` (its row failed), `filtered` (both sides filtered it), `optional-absent` (each side skipped it because an optional tab was absent), `execution-lost` (no row, and a side's capture action failed or did not run) or `unaccounted`. A report row that no case planned SHALL also be an `unaccounted` entry. The section SHALL hold the count of each state and `complete`, which is true only when no entry is `unaccounted`. An `unaccounted` entry SHALL make the report status `analysis-failures`. A missing or unreadable `coverage.json` SHALL be a setup error with no report.

#### Scenario: Every capture accounted for
- **WHEN** both sides performed every capture and each has a report row
- **THEN** every entry is `reported`
- **AND** `complete` is true

#### Scenario: A performed capture has no row
- **WHEN** both sides performed a capture but `results.json` has no row for it
- **THEN** its entry is `unaccounted`
- **AND** `complete` is false
- **AND** the comparer exits with status 2

#### Scenario: Capture lost to an execution failure
- **WHEN** a side failed before a capture action and there is no row for it
- **THEN** its entry is `execution-lost`
- **AND** the comparer's status does not change because of it

#### Scenario: Run folder without coverage
- **WHEN** the run folder has `results.json` but no `coverage.json`
- **THEN** the comparer exits with status 3 and writes no report
