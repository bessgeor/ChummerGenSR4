# Design

## Context

The app is a .NET Framework WinForms program. It reads `data/`, `lang/`, `settings/`, `sheets/` and `export/` from its own folder (`Application.StartupPath`), and it writes to that folder too: new settings files, `mugshots/`, and `saves/backup/`. It also keeps recent files in `HKCU\Software\Chummer`. On master, `Chummer/Chummer.csproj` is an old-style project for .NET Framework 4.0 (Client profile). Both of its configurations build into `..\bin\`, which would overwrite the canonical executable.

The runner drives the app the way a user would, but through accessibility APIs: it launches an executable on a character file, selects tabs through MSAA, waits for a visible UI Automation label, captures the window with `PrintWindow`, and compares pixels. It works from an ordinary user shell. Bringing the app's window to the foreground can fail transiently while another window holds it, which this design addresses.

## Goals / Non-Goals

**Goals:**
- One command (`npm start`) builds the candidate and runs every case on both executables.
- Execution outcomes (did every action run) are recorded per action and reported apart from visual pass/fail.
- The canonical executable and the in-repo settings are never modified; everything a run writes lands in `out/runs/<runId>/`.
- The case file, the run summary and the results are defined by JSON Schemas, with generated C# and TypeScript code.

**Non-Goals:**
- Judging a capture pair by anything other than its pixel-difference ratio.
- Rich interactions such as clicks, typing, dialogs or value edits. The action set is only what the fixtures need.
- Isolating `HKCU\Software\Chummer`; both executables share the user's registry key.

## Decisions

**Schema-first contracts with quicktype.** `contracts/schemas/*.schema.json` (draft-07) is the only hand-written definition of each file format. `contracts/scripts/generate.mjs` runs the pinned `quicktype` CLI and writes:
- C# to `contracts/generated/csharp/<Name>.g.cs`, with `--framework SystemTextJson --check-required`. Each schema gets its own namespace (`Parity.Contracts.<Name>`) so the helper converters quicktype emits per file do not collide.
- TypeScript zod to `contracts/generated/typescript/<name>.ts`.

`npm run contracts:check` generates the same files into a temporary folder and fails if any checked-in file differs, is missing, or is extra. Generated files are exempt from the file-size and one-type rules. *Alternative:* hand-written C# records mirrored by zod, rejected because the two sides drift silently.

**Strict reading on the C# side.** quicktype marks required properties `[JsonRequired]`. The loader adds `UnmappedMemberHandling.Disallow` (unknown properties fail, matching `additionalProperties: false`) and `RespectNullableAnnotations` (an explicit `null` for a non-nullable property fails). Rules that JSON Schema states but the generated types cannot express, such as `minimum`, `minLength`, action-specific required fields and unique names, are checked by `Parity.Cases` when it maps the contract types to its own model. Every violation is an error that names the file and the property; nothing falls back to a default.

**Round-trip contract tests in both languages.** Each schema has an example document in `contracts/examples/`. The C# test deserializes it with the generated types and serializes it again; the TypeScript test parses it with the generated zod schema and stringifies it again. Both compare the result with the original as JSON values. So a schema change that one side does not pick up fails a test, and the drift check catches stale generated code.

**Case file.** `parity/cases/characters.json` follows `parity-cases.schema.json`:
- `settleMilliseconds` and `startupDelaySeconds`;
- named `sequences` of actions;
- `buildActions` and `careerActions`;
- `characters`: each entry has a `path` relative to the case file and an explicit `mode` (`build` or `career`). The loader checks the mode against the file's `<created>` element and fails on a mismatch instead of guessing.

The case name is `<mode>-<file name without extension>`. The action set is `selectTab` (with `optional`), `waitFor`, `wait`, `capture` and `include`; `include` is expanded when the case file is loaded. Clicks, typing and value edits are left out because no case needs them. A case file lists only committed fixtures, by relative path.

**Run-scoped staging.** A run creates `out/runs/<runId>/`, where `runId` is a UTC timestamp plus a short random suffix. Its layout:
- `apps/canonical/` and `apps/candidate/` each hold the executable plus copies of `bin/`'s `data`, `lang`, `settings`, `sheets`, `export` and the two manifest files (not `saves`, which is 51 MB of samples the scenarios never open);
- `characters/` holds byte-identical copies of the fixtures, so the app can never write to a committed fixture;
- `captures/<case>/<side>/<capture>.png`;
- `summary.json` and `results.json`.

Both executables therefore run with the same data and the canonical executable's own settings. Anything the app writes stays inside the run.

**Canonical executable guard.** The runner reads `bin/ChummerGenSR4.exe`, computes its SHA-256 and compares it with the pinned value `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`. It then copies the file into `apps/canonical/` and hashes the copy. After the cases run, it hashes both again. Any mismatch fails the run with a setup error (exit 3), and every hash is recorded in the summary. The file under `bin/` is only ever read. *Alternative:* launching `bin/ChummerGenSR4.exe` in place, rejected because the app writes into its own folder and a settings overlay could not be applied without editing `bin/settings/`.

**Declared settings overlay.** `--settings-overlay <dir>` names a folder whose files are copied over both staged apps, at the same relative paths (for example `settings/default.xml`), after the `bin/` copies. The overlay is optional, lives outside the repository (or under the ignored `out/`), and is never committed. The summary records its absolute path and the relative path and SHA-256 of every file it replaced or added. A path that escapes the app folder fails the run. Without an overlay, the summary records `overlay: null`.

**Candidate build.** `npm run build:candidate` runs MSBuild on `Chummer/Chummer.csproj` in Release, with `OutputPath` and `BaseIntermediateOutputPath` redirected under `out/candidate/`. It finds MSBuild through `vswhere`. The runner takes the candidate executable path (default `out/candidate/bin/ChummerGenSR4.exe`) and records its SHA-256.

**Driving the UI.**
- Launch the executable with the staged character path, wait up to 60 s for the largest visible top-level window of the process, maximize it, then wait for input idle and for stable window bounds. Startup is complete only when that window contains the character form's status bar. Otherwise the largest window is something else, such as an unhandled-exception dialog, and the side fails at startup with that window's title.
- Tab items whose MSAA name cannot be read (the control rejects the child id with `E_INVALIDARG`, or the COM call fails) count as unnamed and never match; any other error fails the action.
- `selectTab` finds the tab item by name through MSAA across all visible `SysTabControl32` children, ordered by position. It runs the default action and waits until the item is selected, either by the MSAA selected state or by the native current selection index. On a stale COM object it re-resolves once.
- `waitFor` waits for stable bounds and then up to 5 s for a visible UI Automation element with that exact name, then settles.
- `capture` waits for stable bounds, moves focus to the status bar (so a focus rectangle never differs between runs), and renders the window with `PrintWindow(PW_RENDERFULLCONTENT)`. If `PrintWindow` fails, the capture is an execution failure. There is no screen-copy fallback, because it would silently capture whatever is on top.

**Foreground activation with a bounded retry.** Before each action the runner activates the app's window. A single `SetForegroundWindow` call can fail while another window holds the foreground, so activation makes up to 10 attempts, 200 ms apart. If all fail, the action fails with the reason `window-activation: …`, which the summary keeps apart from UI failures. `AGENTS.md` asks users not to use the desktop during a run.

**Execution outcomes.** Every expanded action of every side gets exactly one outcome, by index:
- `performed`;
- `failed` (with the exception type and message);
- `skipped-optional`: a `waitFor` or `capture` after an optional tab that is absent, up to the next `selectTab`;
- `optional-absent`: the optional `selectTab` itself;
- `filtered`: a capture outside `--capture`;
- `not-run`: actions after a failure on that side.

A failure stops that side of the case and the process is closed. The other side still runs, so both are reported. The run continues with the next case. The summary lists the outcomes per side, with counts. *Alternative:* abort the whole run on the first failure; rejected because the summary would then lack the outcomes of later cases.

**Visual results.** For each capture name produced by either side of a case:
- When both sides captured, `difference` = the share of pixels whose ARGB bytes differ at all (tolerance 0), and the row passes if `difference <= threshold` (default `0.00004`, overridable with `--threshold`). Different dimensions count as `1.0`.
- When only one side captured and the other side's action ran without failing (an optional tab absent on one side only), the row fails with `missing-canonical` or `missing-candidate`.
- Captures missing because of an execution failure produce no visual row; the failure is already reported.

**Exit codes:**
- 0: every action executed and every capture passed;
- 1: every action executed, and at least one visual difference;
- 2: at least one execution failure (visual results are still written);
- 3: setup error, such as bad arguments, an invalid case file, a hash mismatch, or a staging or build failure.

`summary.json` is written for exit codes 0–2, and for 3 once the run folder exists.

**Composition.** `Parity.Capture/Program.cs` is the composition root (`Microsoft.Extensions.DependencyInjection`). Services are small single-purpose classes: options parsing, staging, the hash guard, window activation, tab navigation, label waiting, window capture, the pixel comparer, the case runner and the report writer. Win32 and MSAA interop sit in their own files. The runner calls `SetProcessDpiAwareness(PER_MONITOR)` at startup so window coordinates are physical pixels. *Alternative:* one large `static` runner; rejected by the code rules (500 SLOC per file, one type per file, DI at the root).

## What fixtures prove and what only a live run proves

- **Fixture and unit tests prove:** schema round-trips; drift detection; case file validation (unknown properties, missing fields, mode mismatch, unknown include, include cycles); action expansion; the optional-skip and not-run outcome rules on a scripted driver; the pixel difference and threshold; the overlay path rules; and the hash guard on temporary files.
- **Only a live run proves:** that both executables start from the staged folders, that tabs are found and selected, that labels appear, that captures render real content, the actual visual pass/fail, and that the canonical hash is unchanged after real launches.

## Risks / Trade-offs

- [The shared `HKCU\Software\Chummer` key changes during runs (recent files)] → recorded as a known side effect; isolating the registry is out of scope.
- [User input on the desktop steals the foreground] → bounded retry, a distinct failure reason, and the desktop lane rule.
- [Copying `data/` and `lang/` (about 7 MB) per run and side] → acceptable; captures dominate run time.
- [Generated C# uses `partial` classes and several types per file] → generated code is exempt from those rules and never hand-edited.
- [quicktype output could change between versions] → the version is pinned and the drift check compares exact bytes.

## Migration Plan

Additive only. Rolling back means reverting the change's commits; `out/` holds only disposable run output.
