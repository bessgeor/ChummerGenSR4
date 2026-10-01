# Proposal

## Why

A capture run records an outcome for every action and the comparer explains every failing row, but nothing checks that this evidence is whole. A run whose action indexes have a gap, whose capture actions performed without leaving a file, or whose report silently lacks a planned capture would still look clean. The suite also covers only two characters, so most of the app's tabs (complex forms, critter powers, adept powers, initiation, submersion, vehicles) never appear with content. Every run launches the canonical executable again even though its captures cannot change while its inputs stay the same, and there is no record of where a run spends its time.

## What Changes

- **Execution coverage.** The capture runner audits every case and side and writes `coverage.json` (`parity-execution-coverage.schema.json`): action indexes contiguous from zero and matching the planned action count, failures, optional tabs found absent and the actions skipped with them listed separately, filtered and not-run counts, and each planned capture's outcome against the files the side wrote. A gap, a performed capture without a file, a file without a performed capture or any failure makes the coverage invalid, and invalid coverage gives the execution-failure status (2).
- **Completeness report.** The comparer reads `coverage.json` beside `results.json` and adds a `completeness` section to `compare/report.json`: every planned capture of every case is accounted for exactly once as reported, analysis-failed, filtered, optional-absent or lost to an execution failure. A planned capture with no such outcome, or a report row that no case planned, is `unaccounted` and makes the report status `analysis-failures` (2).
- **Canonical capture cache.** With `--canonical-cache <dir>`, the capture runner reuses a canonical side recorded by an earlier run when every input that decides its pixels is the same: the staged canonical executable and app folder after the overlay, the fixture, the case's expanded actions, the capture filter, the timing settings, the screens, the system DPI, the OS, the culture and the capture runner's own assemblies. A hit copies the recorded captures into the run after checking their hashes and records the side as `cache` with the run it came from; the candidate side always runs live. Only sides that completed are stored, and entries are never overwritten. Without the option nothing is cached.
- **Timing as a decorator.** A decorator around the UI driver and its sessions records the duration and success of every launch, activation, tab selection, label wait, wait, capture and close, without changing the driver. The run writes `timing.json` (`parity-capture-timing.schema.json`) with per-side samples and per-operation totals, median, 80th percentile and maximum.
- **Fixtures by archetype.** Ten reviewed characters join the suite: a face mage (build and career), a rigger (build and career), a hacker, a technomancer (build and career), an adept, a free spirit, and Skull Carver (pre-career build and career). `AGENTS.md` names the sourcebooks the suite needs and how to pass them as an overlay.
- Summary contract: each side records its source (`live` or `cache`), and the summary records the cache directory and its hits, misses and stores.

Area: the parity tools, the case file, fixtures and docs. The Chummer app and `bin/` are untouched. Evidence: contract drift check and round-trip tests; `dotnet test` covers the coverage audit, the completeness accounting, the cache key, hit, miss, store and corruption paths, and the timing decorator with scripted drivers; live `npm start` runs on the whole suite record the canonical hash before and after, execution coverage apart from visual results, the comparer's counts and completeness, timing, and a second run served from the cache.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `visual-parity-capture`: execution coverage audit, canonical capture cache, timing decorator, archetype fixtures.
- `visual-parity-compare`: completeness accounting of every planned capture.

## Impact

- New files: two schemas (`parity-execution-coverage`, `parity-capture-timing`) with examples and generated code; coverage, cache and timing classes under `parity/src/Parity.Capture/`; completeness classes under `parity/src/Parity.Compare/`; ten fixtures under `parity/fixtures/characters/`; tests.
- Edited files: the summary and compare report schemas, their examples and generated code, `CaptureRun`, `CaseRunner`, `RunStager`, the option parser, the composition roots, `CompareRun`, `ReportBuilder`, `ReportPrinter`, `parity/cases/characters.json`, `AGENTS.md`.
- Output still goes only to the git-ignored `out/`; the cache directory must be outside the repository or under `out/`.
