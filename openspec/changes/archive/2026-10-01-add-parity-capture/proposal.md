# Proposal

## Why

Changing the app safely needs a way to tell whether a build of the current source still behaves like the canonical `bin/ChummerGenSR4.exe`. The most direct check is visual: drive both builds through the same UI scenario on a real character and compare what they show. The runner is written in C# while the repository's tooling runs on Node, so the case file and the runner's output files are defined once as JSON Schemas, with generated code for C# and TypeScript.

## What Changes

- Add `contracts/`: JSON Schemas as the single source for cross-language data, starting with the parity case file, the capture run summary and the capture results. `quicktype` generates C# (`System.Text.Json`) and TypeScript zod code, which is checked in. `npm run contracts:check` fails on drift, and every schema has a round-trip contract test in both languages.
- Add `parity/` (.NET 10, Windows):
  - `Parity.Cases`: the case model and loader, built on the generated contract types.
  - `Parity.Capture`: the capture runner. It stages both executables in a run-scoped folder, launches each on the same character, navigates tabs through MSAA and UI Automation, captures the main window, compares each capture pair against a pixel threshold, and writes the run summary and results.
  - `Parity.Tests`: unit and contract tests.
- Settings: both executables run with the canonical executable's own settings, copied from `bin/` into `out/runs/<runId>/`. An optional per-run settings overlay is declared on the command line, applied only in that run folder, and recorded by hash. It is never committed, and the in-repo settings stay as they are.
- The runner checks the canonical executable's SHA-256 before and after the run and refuses to start on a mismatch.
- Add the first character fixtures under `parity/fixtures/characters/`: one build-mode and one career-mode character, plus the case file that drives them.
- Root `npm start` builds the candidate (the current source, built into `out/`) and runs capture. `npm run parity` runs capture on its own.
- `AGENTS.md` gains the capture runner usage and the rule that only one live run uses the desktop at a time.

Area: the parity tools, plus process docs. The Chummer app and `bin/` are untouched. Evidence: contract drift check and round-trip tests pass, `dotnet test` passes, and live `npm start` runs record, for both fixtures, the outcome of every action and the canonical hash before and after. Execution results are reported apart from visual pass/fail.

## Capabilities

### New Capabilities

- `parity-contracts`: schema-first cross-language data, with generated C# and TypeScript, drift checking and round-trip tests.
- `visual-parity-capture`: running the canonical and candidate executables through a case, capturing each step, and reporting execution outcomes apart from visual pass/fail.

### Modified Capabilities

None.

## Impact

- New files: `contracts/**`, `parity/**`, including two `.chum` fixtures and their case file.
- Edited files: `package.json` and `package-lock.json` (new dev dependencies `quicktype`, `zod`, `typescript` and `tsx`, and new scripts), `AGENTS.md`.
- New prerequisites for live runs: the .NET 10 SDK, MSBuild for .NET Framework projects (Visual Studio Build Tools), and an interactive Windows desktop session.
- Run output goes to the git-ignored `out/` only.
