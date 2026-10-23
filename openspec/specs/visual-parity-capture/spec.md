# visual-parity-capture Specification

## Purpose
Defines how the capture runner drives the canonical and candidate executables through the same UI scenarios on real characters, captures what they show, and reports execution outcomes apart from visual pass/fail.

## Requirements

### Requirement: Cases are declared in a validated case file
The capture runner SHALL read its cases from a case file that conforms to `parity-cases.schema.json`. Each character entry SHALL name a fixture path relative to the case file and an explicit mode, `build` or `career`. The loader SHALL fail when a fixture is missing, when the declared mode does not match the character's `<created>` flag, when an included sequence is unknown or included recursively, or when two cases have the same name.

#### Scenario: Mode mismatch
- **WHEN** a character entry declares `build` for a file whose `<created>` element is `True`
- **THEN** loading fails with an error naming the entry and both modes
- **AND** no executable is launched

#### Scenario: Sequences are expanded
- **WHEN** a case's actions include a named sequence
- **THEN** the case runs the sequence's actions in place of the include, in order

### Requirement: The canonical executable is verified and never modified
Before any case runs, the runner SHALL compute the SHA-256 of `bin/ChummerGenSR4.exe` and compare it with the pinned canonical hash. It SHALL launch only a run-scoped copy whose hash also matches. It SHALL compute both hashes again after the last case. It SHALL NOT write to `bin/`. Every hash SHALL be recorded in the run summary.

#### Scenario: Hash mismatch before the run
- **WHEN** `bin/ChummerGenSR4.exe` does not have the pinned hash
- **THEN** the runner exits with the setup error status before launching anything

#### Scenario: Hashes recorded
- **WHEN** a run completes
- **THEN** the summary holds the canonical hash before and after the run for the source file and for the staged copy
- **AND** all four equal the pinned hash

### Requirement: Runs are staged in a run-scoped folder with the canonical settings
Each run SHALL create `out/runs/<runId>/` and stage both executables there, each with copies of the canonical `data`, `lang`, `settings`, `sheets` and `export` folders from `bin/`, and with copies of the fixtures. Both executables SHALL load the staged fixture copies. Nothing the run writes SHALL land outside `out/runs/<runId>/`, except the app's own registry key.

#### Scenario: Committed files are untouched
- **WHEN** a run completes
- **THEN** `git status` shows no change to tracked files

### Requirement: A per-run settings overlay is declared and recorded
The runner SHALL accept an optional settings overlay folder. It SHALL copy the overlay's files over both staged apps at the same relative paths, after the canonical copies. It SHALL record the overlay path and each overlaid file's relative path and SHA-256 in the summary. An overlay SHALL NOT be applied to `bin/` or to any tracked file. An overlay file whose path would leave the staged app folder SHALL fail the run.

#### Scenario: Run without overlay
- **WHEN** no overlay is given
- **THEN** both executables run with the canonical settings
- **AND** the summary records that no overlay was applied

#### Scenario: Run with overlay
- **WHEN** an overlay folder holding `settings/default.xml` is given
- **THEN** both staged apps use the overlay's `settings/default.xml`
- **AND** `bin/settings/default.xml` is unchanged
- **AND** the summary lists `settings/default.xml` with its SHA-256

### Requirement: Every action gets exactly one execution outcome
For each case and each side, the runner SHALL record exactly one outcome for every expanded action, indexed contiguously from zero: `performed`, `failed`, `optional-absent`, `skipped-optional`, `filtered` or `not-run`. A failed action SHALL stop that side of the case, and the remaining actions of that side SHALL be recorded as `not-run`. An absent optional tab SHALL NOT be recorded as a failure, and a failed required action SHALL NOT be recorded as a skip.

#### Scenario: Optional tab absent
- **WHEN** an optional `selectTab` finds no tab with that name
- **THEN** that action is `optional-absent`
- **AND** the following `waitFor` and `capture` actions up to the next `selectTab` are `skipped-optional`
- **AND** the execution status of that side is not failed

#### Scenario: Required action fails
- **WHEN** a required `waitFor` times out
- **THEN** that action is `failed`, with the error message
- **AND** every later action on that side is `not-run`
- **AND** the run exits with the execution-failure status even if every visual result passed

#### Scenario: Character fails to open
- **WHEN** the app shows a window without the character form's status bar, such as an unhandled-exception dialog, instead of the character
- **THEN** that side fails at startup with a reason naming the window's title
- **AND** every action on that side is `not-run`

#### Scenario: Window activation fails
- **WHEN** the app's window cannot be brought to the foreground after the bounded retries
- **THEN** the action is `failed` with a reason that starts with `window-activation`

### Requirement: Captures do not depend on focus or activation history
Before each capture, the runner SHALL bring the app's window to the foreground, move keyboard focus to the character form's status bar and paint the window frame as active, so that neither earlier input nor the order in which windows were activated changes the captured pixels.

#### Scenario: Frame state is the same on both sides
- **WHEN** one side's window is the first one launched in the run and the other side's is not
- **THEN** both sides' captures show an active window frame and the same focused control

### Requirement: A capture holds exactly the visible window
Each capture SHALL contain the window's visible area and nothing else: no invisible resize borders and nothing outside the screens. It SHALL have the size at which the app renders itself, so a DPI-unaware app is captured at its logical size.

#### Scenario: Maximized window
- **WHEN** a maximized window's rectangle reaches past the screen edges
- **THEN** the capture starts at the window's visible top-left corner
- **AND** it includes the visible right and bottom edges of the window

### Requirement: Visual results are reported apart from execution outcomes
For every capture name produced by either side of a case, the runner SHALL write a result row. The row carries the pixel difference ratio, the threshold, the capture paths and a pass flag. A capture that only one side produced, while the other side's action did not fail, SHALL be a failing row with reason `missing-canonical` or `missing-candidate`. Captures missing because of an execution failure SHALL produce no visual row. The exit status SHALL distinguish all-pass (0), visual differences only (1), execution failures (2) and setup errors (3).

#### Scenario: Visual difference without execution failure
- **WHEN** every action performs and one capture differs beyond the threshold
- **THEN** that row fails with reason `visual-difference`
- **AND** the summary reports zero execution failures
- **AND** the runner exits with status 1

#### Scenario: Summary and results are written
- **WHEN** a run finishes with status 0, 1 or 2
- **THEN** `summary.json` conforms to `parity-capture-summary.schema.json`
- **AND** `results.json` conforms to `parity-capture-results.schema.json`

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
