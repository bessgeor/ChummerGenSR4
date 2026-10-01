# Design

## Context

A capture run (`visual-parity-capture`) expands each case's actions, runs them on the canonical and the candidate side, and writes `summary.json` with one outcome per action (`performed`, `failed`, `optional-absent`, `skipped-optional`, `filtered`, `not-run`) and `results.json` with one visual row per capture name. The comparer (`visual-parity-compare`) reads `results.json` and writes `compare/report.json`. The suite has two fixtures, one build and one career character; a full run takes about six minutes, two thirds of it spent waiting for the app.

## Goals / Non-Goals

**Goals:**
- A run proves its own completeness: every planned action has one outcome on each side, every planned capture ends in the report or is explained, and any gap fails the run instead of passing unnoticed.
- Reusing the canonical side's captures only when nothing that decides their pixels changed, with the reuse visible in the summary.
- Knowing where a run spends its time, without changing the code that drives the app.
- Fixtures that bring every main tab of the app on screen with content.

**Non-Goals:**
- Caching the candidate side or the comparer's analysis.
- Making captures faster; timing only measures.
- New actions or scenarios beyond tab captures.

## Decisions

**Coverage audit after each case.** `CoverageAuditor` takes a case's planned actions and the records of both sides and produces a `CaseCoverage`. For each side:
- `contiguous`: the record indexes are exactly `0 … n-1` for the `n` planned actions, each once, and each record names the planned action at its index;
- `failures`: every `failed` action (index, action, reason), and `startupFailure` when the side failed before its first action;
- `optionalAbsent` and `skippedOptional`: the optional tabs found absent and the actions skipped with them, listed separately and never counted as failures;
- `filtered` and `notRun` counts;
- `captures`: each planned capture name with its outcome on that side, and whether the side wrote a file for it.

Invalid reasons, as `<code>:<case>/<side>`: `action-gap` (the index check fails), `failure` (a failed action or a startup failure), `capture-without-file` (a performed capture without a file), `file-without-capture` (a file for a capture whose action did not perform). The run's `coverage.json` (`parity-execution-coverage.schema.json`, title `ExecutionCoverage`) holds every case, `valid` and the list of reasons, and totals. The run status is `execution-failures` when coverage is invalid, in addition to the existing rule for failed sides, so a gap that the executor never reported as a failure still fails the run. Coverage is written with the summary for runs that reach their end; a setup error writes no coverage. *Alternative:* fields inside `summary.json`; rejected so the summary stays the raw record and the audit is a separate, checkable verdict on it.

**Completeness in the comparer.** The comparer reads `coverage.json` strictly (missing or invalid JSON is a setup error, exit 3) and builds a `completeness` section of the report: one entry per planned capture of every case, in plan order, with a state:
- `reported`: the report has its row and the row's status is not `failed`;
- `analysis-failed`: its row is `failed`;
- `filtered`: both sides filtered it;
- `optional-absent`: on each side it was skipped because an optional tab was absent;
- `execution-lost`: there is no row and at least one side's capture action failed or did not run;
- `unaccounted`: anything else, for example both sides performed it but no row exists; a report row whose case and capture no case planned also becomes an `unaccounted` entry.

Totals count each state. `complete` is true when nothing is `unaccounted`. An `unaccounted` entry makes the report status `analysis-failures` (exit 2), because the evidence chain has lost something the plan asked for. `execution-lost` does not change the comparer's status: capture already exits with 2 for it, and `npm start` takes the higher status.

**Canonical capture cache.** `--canonical-cache <dir>` turns it on; the folder must be outside the repository or under `out/`, like an overlay. The key is the SHA-256 of these lines, recorded in the entry:
- the cache format version;
- the staged canonical executable's SHA-256;
- a fingerprint of the staged canonical app folder after the overlay (every file's relative path and SHA-256, ordinally sorted), computed before any app starts;
- the fixture's SHA-256, the case name and its mode;
- every expanded action in order, as its description and whether it is optional;
- the sorted capture filter, or `*`;
- the startup delay and settle time;
- the screens (bounds and working areas), the system DPI, the OS version, and the current culture and UI culture;
- the SHA-256 of each `Parity.*.dll` of the capture runner, so a change to how captures are taken invalidates every entry. The parity tools build without git queries (`EnableSourceControlManagerQueries` is false), so the commit ID reaches neither their informational version nor their Source Link data, and a commit that does not change their code keeps the entries valid.

An entry is `<dir>/<key>/entry.json` (the key lines, the run ID that stored it, the side's action records and duration, and each capture's file name and SHA-256) plus the PNG files. On a hit, each PNG is copied to the run's capture path and its hash checked; a missing file, a hash mismatch or an unreadable entry is a setup error that names the entry, never a silent fall-back to a live run. A cached side's records are audited like a live side's. After a live canonical side that completed, the entry is written to a temporary folder and moved into place; if another entry with the same key already exists it is left as it is. Failed sides are never stored. The summary records each side's `source` (`live` or `cache`), the entry key and the run it came from, and a `canonicalCache` block with the folder, hits, misses and stores. *Alternative:* running the canonical actions and reusing only the bitmaps; rejected because it keeps the launch and navigation cost, which is most of a side's time, while the recorded side carries its full action evidence anyway. *Known limit:* the app's own registry key (`HKCU\Software\Chummer`) is not part of the key.

**Timing as a decorator.** `TimedUiDriver` implements `IUiDriver` around `ChummerUiDriver` and returns `TimedAppSession`s around the real sessions. Each call is measured with `TimeProvider` and reported to `TimingRecorder` with the operation (`launch`, `activate`, `selectTab`, `waitForLabel`, `wait`, `capture`, `close`), its target (tab, label or milliseconds), its duration and whether it threw; exceptions pass through unchanged. `CaseRunner` opens a recorder scope per case and side, so samples carry their case and side without the driver knowing them. The composition root registers the decorator as `IUiDriver`; `SideExecutor` and the driver are unchanged. The run writes `timing.json` (`parity-capture-timing.schema.json`, title `CaptureTiming`): per side its samples in order and their total, and per operation the count, failures, total, nearest-rank median and 80th percentile, and maximum. A side served from the cache has no samples. *Alternative:* stopwatch calls inside the executor; rejected because it mixes measuring with driving.

**Fixtures.** Ten characters are added under `parity/fixtures/characters/`, each with its mode declared in the case file: `facemage_Sam.chum` (build) and `facemage_Sam_career.chum` (career), `rigger.chum` (build) and `rigger_career.chum` (career), `hacker4boegspriet.chum` (build), `technotest.chum` (build) and `technotest - career.chum` (career), `test_adept.chum` (career), `spirit.chum` (build, a free spirit), and `Skull Carver - precareer.chum` (build) and `Skull Carver - career.chum` (career). Each file was reviewed for names, notes, links and images before it was added. Before they were committed, free-text notes, links, one contact name and the face mage portrait were replaced with neutral placeholders of about the same length and line structure, the portrait with a flat grey image of the same size and format; game data is unchanged. No fixture links another character file: the app loads a pet's linked file when it shows the Pets and Cohorts tab, so a link would make a case depend on a file outside the fixture, and the technomancer's pet link is cleared. Together the fixtures use the sourcebooks AR, AT, AU, DG, GH, RC, RW, SA, SDN, SG, SM, SR4, TOD, UCL, UN, WA and WAR, while `bin/settings/default.xml` enables only SR4. `AGENTS.md` describes the overlay: a copy of `bin/settings/default.xml` (UTF-16) with those books in `<books>`.

**Composition.** New classes are registered in the composition roots; the new contracts follow the existing rules (generated C# and zod, an example, both round-trip tests, `ContractJson` readers and writers).

## What fixtures prove and what only a live run proves

- **Unit tests prove:** the audit's verdict on contiguous, gapped, duplicated and mislabeled indexes, failures, startup failures, optional absences and capture/file mismatches, and that invalid coverage gives status 2; every completeness state, an unplanned row, the status change for `unaccounted`, and a missing `coverage.json` as a setup error; the cache key changing with each input, a miss, a store, a hit restoring captures and records, a corrupted entry failing the run, a failed side not being stored and an existing entry not being overwritten; the timing decorator recording each operation with a substituted clock, passing exceptions through, and the percentiles; the contracts' round-trips.
- **Only a live run proves:** that the new fixtures open and every tab they show is captured on both executables, the real coverage of a full suite, the comparer's completeness on a real run, real timings, and that a second run with the cache reuses every canonical side and still yields the same visual results; and that the canonical executable's hash is unchanged.

## Risks / Trade-offs

- [A cache key misses an input that changes pixels] → the key includes everything the runner controls, the format version and the runner's own assemblies; the cache is off by default, and a cached side is labelled in the summary so evidence from it is never mistaken for a live run.
- [Fingerprinting the app folder costs time] → it is computed only when the cache is on, once per run.
- [New fixtures need sourcebooks the canonical settings do not enable] → the overlay is documented; without it the affected cases fail at startup on both sides and are reported as execution failures.
- [A longer suite] → `--case` still selects cases, and the cache halves repeated runs.

## Migration Plan

Additive. `coverage.json` is now required by the comparer, so a run folder written before this change cannot be compared again; capture it again. Rolling back means reverting the change's commits; `out/` holds only disposable output.
