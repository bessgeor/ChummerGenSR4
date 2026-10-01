# Spec Delta

## ADDED Requirements

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
When the capture runner is given `--canonical-cache <dir>`, it SHALL compute for each case a key over the staged canonical executable's hash, a fingerprint of the staged canonical app folder after the overlay, the fixture's hash, the case name and mode, the expanded actions in order, the capture filter, the timing settings, the screens, the system DPI, the OS version, the cultures and the hashes of the capture runner's own assemblies. If an entry with that key exists, it SHALL copy the entry's captures into the run, check each copy against the recorded SHA-256, and use the recorded action outcomes instead of launching the canonical executable. Otherwise it SHALL run the canonical side live and, if the side completed, store it under the key without overwriting an existing entry. A missing or corrupted entry file SHALL be a setup error naming the entry. The candidate side SHALL always run live. The summary SHALL record each side's source (`live` or `cache`), the entry key and the run that stored it, and the cache folder with its hits, misses and stores. The cache folder SHALL be outside the repository or under `out/`. Without the option nothing SHALL be read from or written to a cache.

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
