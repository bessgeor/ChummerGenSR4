# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), one 1920×1080 display at 150 % scaling (working area 1920×1020), .NET 10 SDK, Visual Studio Build Tools MSBuild. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Fixture-tested scope

These checks use no desktop and no live app.

| Command | Result |
|---|---|
| `npm run openspec:validate` | `✓ change/add-parity-capture`, `✓ spec/development-process`, `Totals: 2 passed, 0 failed` |
| `npm run contracts:check` | `Generated contracts are up to date (6 files).` |
| `npm run contracts:check` after adding a `probe` property to `parity-cases.schema.json` (restored afterwards) | exit 1: `Generated contracts are out of date (run npm run contracts:generate):`, `stale: contracts/generated/csharp/ParityCases.g.cs`, `stale: contracts/generated/typescript/parity-cases.ts`. The number of `contracts-*` folders in the temp directory was the same before and after. |
| `npm run contracts:test` | `# tests 4`, `# pass 4`, `# fail 0` (the zod round-trip of each of the three examples, plus a check that schemas exist) |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 57, Skipped: 0, Total: 57` |

The 57 .NET tests cover:
- the C# round-trip of every contract example, and strict reading (an unknown property or an explicit `null` fails);
- case-file loading on the committed case file (two cases, build and career, with their action counts) and the loader failures: mode mismatch, unknown or missing property, unknown action type, unknown include, include cycle, wrong fields for an action type, `optional` outside `selectTab`, duplicate capture names, a missing fixture, a fixture that cannot be read, and the same fixture listed twice;
- execution outcomes on a scripted driver: all performed; an absent optional tab skipping only its own `waitFor` and `capture`; an absent required tab, a label timeout, a window-activation failure (reason kept) and a startup failure, each followed by `not-run`; and the capture filter;
- staging: the hash guard, the staged layout, fixtures with the same file name staged apart, an overlay replacing only staged settings (`bin/settings/default.xml` unchanged), an overlay holding `ChummerGenSR4.exe` failing the staged canonical check, an overlay folder inside the repository but outside `out/` being rejected, a missing candidate being a setup error, and an unusable runs folder ending the run with exit 3;
- the capture region: a maximized window at 100 % (window `(-8,-8)–(1928,1048)`, visible `1920×1040` → region `(8,8) 1920×1040`), a DPI-unaware window at 150 % (rendered `1296×696` → region `(8,8) 1280×680`), a restored window, and visible bounds outside the window failing;
- the pinned hash: `AGENTS.md` and `parity/scripts/build-candidate.mjs` state the same value as the runner;
- the pixel difference (identical, share of changed pixels, different sizes), threshold pass/fail, the `missing-canonical`/`missing-candidate` rows, no row for a capture lost to an execution failure, option parsing, the exit status and the summary counts.

## Fixture review

Both files are committed byte-exact (`*.chum binary` in `parity/.gitattributes`).
- `Diego_v_alpha2_by_bessgeor.chum` (build): a character with an alias only; no notes, links or images.
- `Шпала - карьера.chum` (career): before it was committed, its free-text notes, its link and its portrait were replaced with neutral placeholders of about the same length and line structure; the portrait is a flat grey image of the same size and format. Its game data is unchanged.

The committed fixtures were run again with the overlay command below and the same code, run `20261001T064525Z-e13b6614`, which exited 0: execution had no failed or not-run action on any side (build 37/3/6 and career 58/3/6 performed/optional-absent/skipped-optional on each side), and visual had 33 rows, 33 pass, every difference 0, with the canonical hash `9ff30099…` before and after.

## Live evidence

All runs used the code at the commit before this file. Each was started from the repository root with `npm.cmd` (PowerShell). Before and after each run `bin/ChummerGenSR4.exe` had SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, and every summary records that value for the source file and the staged copy, before and after. `git status` showed no changed tracked file after any run. Each `npm start` first ran `npm run build:candidate`, which printed `Canonical SHA-256 before: 9ff30099…`, `after: 9ff30099…` and wrote the candidate (SHA-256 `ac11afe5c6e933e2fd6fbd3b69820d47e01413586faf48b1d7c9f4b574fe2906`) to `out/candidate/bin/`.

The overlay is a folder `out/overlays/street-magic/` holding one file, `settings/default.xml`: `bin/settings/default.xml` with `<book>SM</book>` added to `<books>`, as `AGENTS.md` describes (SHA-256 `324ea75dc7250afccf4e20e3a0d929da75e262ebdb009ec2c21dba0f8927a8e6`). The summaries of both overlay runs record it with `replaced: true`.

In every summary, each side's action indexes run contiguously from 0 (0–45 for build, 0–66 for career), with exactly one outcome each.

### With the in-repo settings: `npm.cmd start`

Run `20260930T233554Z-db6d5584`: exit 2, status `execution-failures`.

| Case / side | Status | performed | optional-absent | skipped-optional | failed | not-run |
|---|---|---|---|---|---|---|
| build / canonical | completed, 72.5 s | 37 | 3 | 6 | 0 | 0 |
| build / candidate | completed, 73.2 s | 37 | 3 | 6 | 0 | 0 |
| career / canonical | **failed at startup**, 16.6 s | 0 | 0 | 0 | 0 | 67 |
| career / candidate | **failed at startup**, 16.6 s | 0 | 0 | 0 | 0 | 67 |

Both career failures: `startup: InvalidOperationException: The character did not open within 10 s: the largest window is 'Microsoft .NET Framework' and has no status bar.` The dialog's details, read from a separate launch of a staged copy of the same candidate (SHA-256 `ac11afe5…`) on the career fixture with the same settings, name `System.NullReferenceException` in `Chummer.frmCareer.cboTradition_SelectedIndexChanged`, called from `frmCareer_Load`. The same launch with the overlay's `settings/default.xml` showed no dialog.

Visual: 13 rows (build only), 13 pass, difference 0. The career case has no rows because its captures were lost to the execution failure.

### With the overlay: `npm.cmd start -- --settings-overlay out/overlays/street-magic`

Run `20260930T233905Z-24ef406b`: exit 2, status `execution-failures`.
- build / canonical: **failed at startup** after 3.3 s, `not-run` 46: `startup: window-activation: window 4004910 was not in the foreground after 10 attempts 200 ms apart (foreground: window 135666 'Claude' of class 'Chrome_WidgetWin_1' in process 11288 (claude)).` This was the first launch of the run; after the last attempt the foreground still belonged to another desktop application.
- build / candidate, career / canonical, career / candidate: completed, with 37/3/6 and 58/3/6 (performed / optional-absent / skipped-optional) and no failure.
- Visual: 20 rows (career only), 20 pass, difference 0. The build case has no rows because the canonical side failed.

Run `20260930T234425Z-694acd90`, the same command started again: exit 0, status `passed`.

| Case / side | Status | performed | optional-absent | skipped-optional | failed | not-run |
|---|---|---|---|---|---|---|
| build / canonical | completed, 72.5 s | 37 | 3 | 6 | 0 | 0 |
| build / candidate | completed, 73.1 s | 37 | 3 | 6 | 0 | 0 |
| career / canonical | completed, 104.0 s | 58 | 3 | 6 | 0 | 0 |
| career / candidate | completed, 105.2 s | 58 | 3 | 6 | 0 | 0 |

Optional tabs absent on both sides: build `Spells and Spirits`, `Complex Forms and Sprites`, `Critter Powers`; career `Complex Forms and Sprites`, `Critter Powers`, `Submersion`. Each absence skips its own `waitFor` and `capture` (6 per side). No required action failed.

Visual: 33 rows, 33 pass, 0 fail, every difference 0 (threshold 0.00004): 13 build captures and 20 career captures.

All 66 captures of this run are 1280×680 PNGs: the app is not DPI-aware, so it renders at its logical size, and the capture holds its visible window from the title bar through the status bar, without resize borders.

## Archive

`npx openspec archive add-parity-capture --yes` printed `Task status: ✓ Complete`, `parity-contracts: create` (+ 3 requirements), `visual-parity-capture: create` (+ 9 requirements) and `Change 'add-parity-capture' archived as '2026-10-01-add-parity-capture'.` Afterwards `npm run openspec:validate` printed `✓ spec/development-process`, `✓ spec/parity-contracts`, `✓ spec/visual-parity-capture` and `Totals: 3 passed, 0 failed (3 items)`.

## Unverified

- Foreground activation while other applications are in use: run `20260930T233905Z-24ef406b` failed at its first launch because another application still held the foreground after the bounded retry. The runner reports this as a `window-activation` failure naming the window that held the foreground; it cannot prevent it.
- Other displays and scaling: only one 1920×1080 display at 150 % was used. The 100 % region mapping is covered by a unit test only.
- The career fixture under the in-repo settings: it fails at startup on both executables (above). Only the overlay runs exercise it.
- The shared `HKCU\Software\Chummer` key: runs rewrite the app's recent-file list there; registry isolation is out of scope.
- The overlay path-escape check: files are enumerated below the overlay folder, so no test produces a path that leaves the staged app folder; the check is untested.
