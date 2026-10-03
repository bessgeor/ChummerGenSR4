# visual-parity-capture Specification

## Purpose
Defines how the capture runner drives the canonical and candidate executables through the same UI scenarios on real characters, captures what they show, and reports execution outcomes apart from visual pass/fail.

## Requirements

### Requirement: Cases are declared in a validated case file
The capture runner SHALL read its cases from a case file that conforms to `parity-cases.schema.json`. Each character entry SHALL name a fixture path relative to the case file and an explicit mode, `build` or `career`. An entry MAY carry its own `actions`, which replace the mode's actions for that entry, together with a `scenario` name matching `^[a-z0-9][a-z0-9-]*$`; its case is then named `<mode>-<file>@<scenario>` instead of `<mode>-<file>`. The loader SHALL fail when a fixture is missing, when the declared mode does not match the character's `<created>` flag, when an included sequence is unknown or included recursively, when an entry has `actions` without `scenario`, `scenario` without `actions` or an empty `actions` list, or when two cases have the same name.

#### Scenario: Mode mismatch
- **WHEN** a character entry declares `build` for a file whose `<created>` element is `True`
- **THEN** loading fails with an error naming the entry and both modes
- **AND** no executable is launched

#### Scenario: Sequences are expanded
- **WHEN** a case's actions include a named sequence
- **THEN** the case runs the sequence's actions in place of the include, in order

#### Scenario: An entry with its own actions
- **WHEN** an entry for `rigger.chum` in build mode has `scenario` `pets` and its own actions
- **THEN** the case `build-rigger@pets` runs those actions and not the case file's `buildActions`

#### Scenario: Actions without a scenario name
- **WHEN** an entry has `actions` and no `scenario`
- **THEN** loading fails naming the entry

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

### Requirement: Execution coverage is audited and written for every run
At the end of a run that reaches its last case, the capture runner SHALL write `coverage.json`, conforming to `parity-execution-coverage.schema.json`, with an audit of every case and side. For each side it SHALL record whether the action indexes are exactly `0 … n-1` for the case's `n` planned actions with each record naming its planned action, every failed action and any startup failure, the optional tabs found absent and the actions skipped with them as separate lists, the filtered and not-run counts, and for each planned capture its outcome and whether the side wrote a file for it. Coverage SHALL be invalid when indexes are not contiguous, when an action failed or a side failed at startup, when a performed capture left no file, or when a file exists for a capture whose action did not perform. Invalid coverage SHALL give the run the execution-failure status (2). Optional absences and their skipped actions SHALL NOT make coverage invalid.

#### Scenario: Complete run
- **WHEN** every action of both sides performs, except an optional tab that is absent and the actions skipped with it
- **THEN** `coverage.json` is valid
- **AND** the absent tab is listed under `optionalAbsent` and its skipped actions under `skippedOptional`

#### Scenario: Gap in the action records
- **WHEN** a side's records skip an index or repeat one
- **THEN** coverage is invalid with the reason `action-gap:<case>/<side>`
- **AND** the run exits with status 2 even if every visual row passed

#### Scenario: Performed capture without a file
- **WHEN** a capture action is recorded as performed but the side wrote no file for it
- **THEN** coverage is invalid with the reason `capture-without-file:<case>/<side>`

### Requirement: Canonical sides can be reused from a capture cache
When the capture runner is given `--canonical-cache <dir>`, it SHALL compute for each case a key over the staged canonical executable's hash, a fingerprint of the staged canonical app folder after the overlay, the fixture's hash, the case name and mode, the expanded actions in order, the capture filter, the timing settings, the screens with each monitor's scale, the system DPI, the OS version and patch level, the cultures, the Windows colour, theme, system colour, font smoothing, window metric, text scale and high contrast settings windows are drawn with, the app's options in its registry key (without its recently used files and its Omae account) and the hashes of the capture runner's own assemblies. If an entry with that key exists, it SHALL copy the entry's captures into the run, check each copy against the recorded SHA-256, and use the recorded action outcomes instead of launching the canonical executable. Otherwise it SHALL run the canonical side live and, if the side completed, store it under the key without overwriting an existing entry; it SHALL store only after the run's final check that the canonical executable is unchanged and after it has written the results, the coverage and the timing, so a run that ends as a setup error before then stores nothing. A missing or corrupted entry file SHALL be a setup error naming the entry. The candidate side SHALL always run live. The summary SHALL record each side's source (`live` or `cache`), the entry key and the run that stored it, and the cache folder with its hits, misses and stores. The cache folder SHALL be outside the repository or under `out/`. Without the option nothing SHALL be read from or written to a cache.

#### Scenario: Second run with unchanged inputs
- **WHEN** a run with `--canonical-cache <dir>` completes and the same command runs again with nothing changed
- **THEN** the second run does not launch the canonical executable
- **AND** each canonical side in its summary has source `cache` and names the first run
- **AND** its coverage audits the cached sides like live ones

#### Scenario: An input changes
- **WHEN** the case's actions, the fixture, the overlay or the screens differ from the stored run
- **THEN** the key differs and the canonical side runs live

#### Scenario: Corrupted entry
- **WHEN** a cached capture's file no longer has its recorded SHA-256
- **THEN** the run ends with the setup error status naming the entry

#### Scenario: Failed side
- **WHEN** a live canonical side fails
- **THEN** nothing is stored for that case

### Requirement: The pointer position does not decide captures
Once the app's main window is maximized and its bounds are stable, the capture runner SHALL move the mouse pointer to the middle of the window's title bar, before the startup delay. Before each capture it SHALL check that the pointer is still there; if it is not, or if it cannot be moved or read, the capture action SHALL fail with a reason that starts with `pointer:`. The cache key's format version SHALL change whenever this placement changes.

#### Scenario: Pointer left over a control
- **WHEN** the pointer rests over a button or a text box of the app's window before a side starts
- **THEN** the side's captures show no hover effect of that position

#### Scenario: Pointer moved during a side
- **WHEN** the pointer leaves its spot on the title bar before a capture
- **THEN** that capture action fails with a `pointer:` reason naming both positions

### Requirement: UI timing is recorded by a decorator around the driver
The capture runner SHALL measure every launch, activation, tab selection, label wait, wait, capture and close through a decorator around its UI driver and sessions, recording the case, side, operation, target, duration and whether the call threw, and SHALL pass every exception through unchanged. At the end of a run that reaches its last case it SHALL write `timing.json`, conforming to `parity-capture-timing.schema.json`, with each live side's samples in order and their total, and per operation the count, failures, total, median, 80th percentile and maximum. A side served from the cache SHALL have no samples.

#### Scenario: Timing does not change outcomes
- **WHEN** a tab selection throws because the tab is absent
- **THEN** the sample is recorded as failed
- **AND** the action's outcome is the same as without the decorator

### Requirement: The character suite covers the main archetypes
The case file SHALL include, each with its declared mode, a build and a career face mage, a build and a career rigger, a hacker, a build and a career technomancer, an adept, a free spirit, and a pre-career build and a career Skull Carver, besides the existing build and career characters. Each fixture SHALL be reviewed for names, notes, links and images before it is added, and no fixture SHALL link another character file. `AGENTS.md` SHALL name the sourcebooks the suite needs and describe the overlay that enables them.

#### Scenario: Suite with its overlay
- **WHEN** a contributor runs `npm start -- --settings-overlay <dir>` with the documented sourcebooks enabled
- **THEN** every case opens on both executables
- **AND** the comparer's completeness accounts for every planned capture

#### Scenario: Fixture with a linked character file
- **WHEN** a fixture's contact or spirit names a linked character file
- **THEN** the fixture test fails and names the fixture and the link

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

### Requirement: The candidate's UI trees are recorded on request
With `--ui-tree`, the capture runner SHALL record after each performed capture of the candidate side, before the capture is recorded, the UI Automation tree of the main window as shown: every element of the control view that is not off screen, in depth-first order, with its parent's index, automation ID, name, control type, class name, enabled state and bounds. The tree SHALL be read before the capture's image is written, so a tree that cannot be read leaves no image of the failed capture. It SHALL write the tree to `ui-trees/<case>/<capture>.json` in the run folder (`parity-ui-tree.schema.json`) and name the folder in the summary's `uiTrees`, which SHALL be absent without the option or when the run ended with a setup error. A tree that cannot be recorded SHALL fail its capture action with the reason, like any other failed action, so coverage is invalid and the run's status is 2. The canonical side, live or from the cache, SHALL record no tree, and the option SHALL NOT change the canonical cache's key or entries. The timing decorator SHALL measure each recording as operation `uiTree`.

#### Scenario: Trees recorded
- **WHEN** a case runs with `--ui-tree` and its candidate side performs captures `common` and `skills`
- **THEN** the run holds `ui-trees/<case>/common.json` and `ui-trees/<case>/skills.json`, and the summary's `uiTrees` is `ui-trees`

#### Scenario: Recording fails
- **WHEN** reading the tree throws after the `skills` capture
- **THEN** that capture action is `failed` with the reason, the rest of the side is `not-run` and the run exits with 2

#### Scenario: Without the option
- **WHEN** a run has no `--ui-tree`
- **THEN** it writes no tree and the summary has no `uiTrees`
