# Spec Delta

## MODIFIED Requirements

### Requirement: Capture runs from the root entry points
The repository SHALL provide `npm start`, which runs the parity workflow: it builds the candidate from the current source into `out/`, runs capture one case at a time and compares each captured case, and `npm run parity`, which runs capture alone. Arguments after `--` SHALL be passed to the workflow, which passes the capture options `--case`, `--capture`, `--settings-overlay`, `--threshold` and `--case-file` to the capture runner and the comparer's options `--no-ocr` and `--tessdata <dir>` to the comparer. The candidate build SHALL NOT write to `bin/`. The capture runner SHALL accept `--run-folder-file <path>` and, once it has created its run folder, write that folder's full path to the file, so that the workflow compares exactly the run that capture wrote.

#### Scenario: Default start
- **WHEN** a contributor runs `npm start` on an interactive Windows desktop
- **THEN** the candidate is built under `out/`
- **AND** every case in the case file is run on both executables with the canonical settings
- **AND** every action of every side has an execution outcome in its case's summary
- **AND** the comparer writes its report into each case's run folder
- **AND** the canonical executable's hash is unchanged

#### Scenario: Options pass through
- **WHEN** a contributor runs `npm start -- --settings-overlay <dir>`
- **THEN** the capture runner applies that overlay to both staged apps

#### Scenario: Run folder reported to the caller
- **WHEN** the capture runner is given `--run-folder-file <path>` and creates its run folder
- **THEN** that file holds the run folder's full path
- **AND** the folder holds the run's summary when the run ends

## ADDED Requirements

### Requirement: The capture runner fingerprints its environment on request
The capture runner SHALL accept `--environment-fingerprint-file <path>`. It SHALL write to that file the lowercase hexadecimal SHA-256 of the lines the canonical capture cache's key reads from the machine (the screens with their per-monitor scale, the system scale, the OS build and patch level, the cultures, the Windows colour, theme, font smoothing, window metric, text scale and high contrast settings, the app's own options and the runner's assemblies), and exit with 0 without staging, running or writing anything else. Two runs on an unchanged machine SHALL write the same value, and a change to any of those inputs SHALL change it. A file that cannot be written SHALL end with status 3.

#### Scenario: Fingerprint requested
- **WHEN** the capture runner runs with `--environment-fingerprint-file <path>`
- **THEN** the file holds one 64-character hexadecimal SHA-256
- **AND** the exit status is 0 and no run folder is created

#### Scenario: Unchanged machine
- **WHEN** the option runs twice with no change to the machine or the runner
- **THEN** both files hold the same value

#### Scenario: Unwritable file
- **WHEN** the file's folder does not exist
- **THEN** the runner prints the error and exits with status 3
