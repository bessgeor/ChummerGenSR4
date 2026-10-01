# Agent guide

## OpenSpec workflow

- Every change is an OpenSpec change under `openspec/changes/<change-name>/` using the `spec-driven` schema. Project context and per-artifact rules live in `openspec/config.yaml`; the CLI feeds them into each artifact's instructions.
- Use the generated workflows: `/opsx:propose`, `/opsx:apply`, `/opsx:archive` in Claude Code, and the matching `openspec-*` skills in Codex. They are generated files; regenerate them with `npx openspec update` instead of editing them.
- Commit order on a change's branch:
  1. proposal, design, spec deltas and tasks (about eight tasks at most);
  2. small implementation commits;
  3. `verification.md`;
  4. `npx openspec archive <change-name>` as the final commit.
- Run `npm run openspec:validate` (strict) before every commit that touches `openspec/`. A failing validation blocks the change.

## One change per pull request

- A branch is named after its change and carries exactly that one change.
- Branch from `master`, or from the predecessor change's branch while its pull request is still open.

## Verification evidence

- Each change has `verification.md` beside its proposal. List the commands you ran and what they printed or produced.
- Keep fixture-tested scope separate from live evidence. When a live dependency is unavailable, list the requirement as unverified; fixture results never stand in for a live run.
- Preserve real failures: record a failed step as a failure with its output, never as a skip, a warning or a success. Report execution failures separately from visual differences.
- Mark a task done only when the evidence it names is recorded.

## Canonical executable

- `bin/ChummerGenSR4.exe` is the canonical build and is immutable. Never rebuild, replace, copy over or edit it.
- The app's Release configuration builds `ChummerGenSR4.exe` into `bin/`, so never build it with the default output path.
- Before and after any run that launches it, record its SHA-256. Both must equal `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Contracts

- Data read or written by more than one language is defined by a JSON Schema in `contracts/schemas/`. Edit the schema, then run `npm run contracts:generate`; never edit `contracts/generated/` by hand.
- Every schema needs an example in `contracts/examples/`. `npm run contracts:check` (drift), `npm run contracts:test` (TypeScript round-trip) and `npm run parity:test` (C# round-trip) must pass.

## Visual parity capture

- `npm run build:candidate` builds the app from the current source into `out/candidate/bin/`. Use it instead of building `Chummer/Chummer.csproj` yourself.
- `npm run parity` captures every case in `parity/cases/characters.json` on the canonical and the candidate executable; `npm start` builds the candidate first and compares the run afterwards (see below). Pass options after `--`, for example `npm run parity -- --case Diego_v_alpha2_by_bessgeor --capture common`; `--help` lists them. In PowerShell, call `npm.cmd` instead of `npm`, because the `npm.ps1` shim drops the `--`.
- A run writes only under `out/runs/<runId>/`: staged apps, fixture copies, `captures/`, `summary.json`, `results.json`, `coverage.json`, `timing.json` and the comparer's `compare/`. The exit status is 0 (all passed), 1 (visual differences), 2 (execution failures) or 3 (setup error). Read `coverage.json` for execution (`valid`, `invalidReasons`, failures, and optional absences listed apart from them) and `results.json` for visual pass/fail, and report them separately. Invalid coverage alone gives status 2. `timing.json` holds the durations of every UI operation; it measures, it never decides an outcome.
- Run-specific settings go in a folder passed with `--settings-overlay`. Keep it outside the repository or under `out/`; never edit `bin/settings/` for a run.
- The fixtures use sourcebooks that `bin/settings/default.xml`, which enables only the core book, does not enable; without them the cases that need them fail at startup on both sides. To run the suite, pass an overlay holding `settings/default.xml`: a copy of `bin/settings/default.xml` (UTF-16) with these books added to `<books>`: `AR`, `AT`, `AU`, `DG`, `GH`, `RC`, `RW`, `SA`, `SDN`, `SG`, `SM`, `TOD`, `UCL`, `UN`, `WA` and `WAR`.
- `--canonical-cache <dir>` (outside the repository or under `out/`) reuses the canonical side of a case from an earlier run when every input it is keyed on is the same (the staged canonical app, the fixture, the actions, the screens and their scale, the OS build, the Windows colour and text settings, the app's registry options and the runner's own assemblies), and stores canonical sides that completed. A reused side is marked `cache` in the summary and in `coverage.json`, with the run that stored it; say so when you report a run. Leave the cache off for evidence that must show both executables running.
- Add a fixture to `parity/fixtures/characters/` only after reviewing its content (names, notes, links, images), and declare its mode in the case file.

## Visual parity compare

- `npm run compare -- --run out/runs/<runId>` analyzes a capture run: it reads `results.json` and replaces only `out/runs/<runId>/compare/` with `report.json` and the crops under `crops/`. `--no-ocr` turns OCR off; `--help` lists the options.
- `npm start` builds the candidate, runs capture with your arguments and then compares that run, unless capture ended with a setup error. The comparer's `--no-ocr` and `--tessdata <dir>` go to the comparer; every other argument goes to capture. Its exit status is the higher of the two, or 3 when the comparer ends without a report that matches its status, for example because it could not be built. `npm run parity:scripts:test` tests this script.
- The exit status is 0 (every row passed), 1 (differences reported), 2 (analysis failures: a row could not be analyzed, OCR failed, or a planned capture is unaccounted) or 3 (setup error, no report). The comparer needs the run's `coverage.json`.
- The report's `completeness` accounts for every planned capture: `reported`, `analysis-failed`, `filtered`, `optional-absent`, `execution-lost` or `unaccounted`. Report its totals with the comparer's outcome. Report the comparer's outcome apart from the capture run's execution outcomes and visual results.
- Discrepancies come only from the raw pixel difference. OCR text helps a reader; it never shows that a difference is gone or that two discrepancies are the same. Duplicates share the same changed pixels at nearly the same place.

## Desktop use

- A capture run drives real windows. Only one live run may use the desktop at a time: never start a second run while one is active, and watch a slow run instead of restarting it.
- Leave the mouse and keyboard alone during a run; another window taking the foreground fails the current action with a `window-activation` reason. The capture runner parks the pointer in the middle of the app's title bar, and a pointer moved away from it fails the next capture with a `pointer` reason.
