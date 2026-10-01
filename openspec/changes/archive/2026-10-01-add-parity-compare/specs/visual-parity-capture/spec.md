# Spec Delta

## MODIFIED Requirements

### Requirement: Capture runs from the root entry points
The repository SHALL provide `npm start`, which builds the candidate from the current source into `out/`, runs capture and then runs the comparer on the run capture wrote, and `npm run parity`, which runs capture alone. Arguments after `--` SHALL be passed to the capture runner, except the comparer's options `--no-ocr` and `--tessdata <dir>`, which `npm start` SHALL pass to the comparer. The candidate build SHALL NOT write to `bin/`. The capture runner SHALL accept `--run-folder-file <path>` and, once it has created its run folder, write that folder's full path to the file, so that `npm start` compares exactly the run that capture wrote.

#### Scenario: Default start
- **WHEN** a contributor runs `npm start` on an interactive Windows desktop
- **THEN** the candidate is built under `out/`
- **AND** every case in the case file is run on both executables with the canonical settings
- **AND** every action of every side has an execution outcome in the summary
- **AND** the comparer writes its report into the same run folder
- **AND** the canonical executable's hash is unchanged

#### Scenario: Options pass through
- **WHEN** a contributor runs `npm start -- --settings-overlay <dir>`
- **THEN** the capture runner applies that overlay to both staged apps

#### Scenario: Run folder reported to the caller
- **WHEN** the capture runner is given `--run-folder-file <path>` and creates its run folder
- **THEN** that file holds the run folder's full path
- **AND** the folder holds the run's summary when the run ends
