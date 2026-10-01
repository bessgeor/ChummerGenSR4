# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), one 1920×1080 display at 150 % scaling, .NET SDK 10.0.401, Node 22.17.0, Visual Studio Build Tools MSBuild. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Fixture-tested scope

These checks use no desktop and no live app. They ran on the commit before this file.

| Command | Result |
|---|---|
| `npm run openspec:validate` | `✓ change/add-parity-compare`, `✓ spec/development-process`, `✓ spec/parity-contracts`, `✓ spec/visual-parity-capture`, `Totals: 4 passed, 0 failed (4 items)` |
| `npm run contracts:check` | `Generated contracts are up to date (8 files).` |
| `npm run contracts:test` | `ok 5 - parity-compare-report round-trips through its zod schema`; `# tests 5`, `# pass 5`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 124, Skipped: 0, Total: 124` |
| `npm run parity:scripts:test` | `ok 1` to `ok 10`; `# tests 10`, `# pass 10`, `# fail 0` |

### Each commit on its own

Each commit of this change, from the proposal to the commit before this file, was checked out in a separate detached worktree and tested there with `dotnet test parity/Parity.slnx`. Every run exited with 0 and printed `Passed!` with `Failed: 0` and these totals:

| Commit | Tests passed |
|---|---|
| Propose add-parity-compare | 57 |
| Share the raw pixel difference through Parity.Imaging | 61 |
| Add the compare report contract | 62 |
| Share option and run path helpers through Parity.Cases | 62 |
| Find discrepancies and review crops in the raw pixel difference | 81 |
| Read crop text with Tesseract OCR | 93 |
| Group duplicates and add the compare command, report and exit statuses | 117 |
| Run compare after capture from npm start, through a run folder file | 119 |
| Keep a written report when printing it fails, and print the status as the contract names it | 121 |
| Write a row's crops only once the row is analyzed, and remove them when one fails | 122 |
| Resolve capture paths inside a run folder at a drive root | 124 |
| End npm start with a setup error when its run folder file cannot be made or read | 124 |

`node --test parity/scripts/tests/start.test.mjs` ran in the same worktree on every commit that has it: from "Run compare after capture from npm start" through "Resolve capture paths inside a run folder at a drive root" it printed `# tests 8`, `# pass 8`, `# fail 0`, and on the last commit `# tests 10`, `# pass 10`, `# fail 0`; each exited with 0.

### What the tests cover

The .NET tests added by this change cover, on generated images:
- the shared pixel difference: the same pixels saved as 24-bit and 32-bit PNG do not differ, a change of one channel by one step is a difference, images of different sizes have no pixel difference, and crops keep their pixels; the capture runner's existing ratio and visual-row tests pass on it unchanged;
- difference rectangles: a single changed pixel (an off-white pixel on white) is a region of one pixel; text redrawn in dark red instead of black is found; changes 18 px apart merge and a distant one stays apart; a region near only the corner of two merged regions joins them; 20,000 separate regions stay apart; the discrepancies' differing pixels add up to the row's count; discrepancies are ordered top to bottom, then left to right;
- review crops: every crop contains its core; a changed value's crop reaches its label, and a value 190 px right of other text across a blank gap does not reach that text; a 20 pt line taller than the 11 rows around the core is cropped over its full height; a line beside a 200 px vertical edge is cropped over the line only; a label/value block at x 1000 of a 1280 px capture is cropped whole; for row spacings from 16 to 23 px, a block crop cuts no row, including a row that the 180 px scan cuts;
- row statuses and exit statuses: all rows passed → `clear`, exit 0, no crops; one changed pixel → one discrepancy with both crop files of the crop's size, exit 1; a recorded difference that disagrees with the pixels → `failed` naming both values, exit 2; size mismatch and missing-candidate rows, exit 1; a missing-capture row whose present file is gone → `failed`, exit 2; a row whose crops cannot be written (a file stands where the crop folder belongs) → `failed` with the `IOException`; a row of two discrepancies whose second crop cannot be written (a folder stands where that crop file belongs) → `failed`, and no crop file of the row is left; a report that cannot be printed (a console that throws on every write) → exit 3 with `report.json` and both crops kept; no `results.json`, a capture path that leaves the run folder, a missing `--run`, an empty `--run` and missing OCR language data → exit 3 with no report; a rerun replaces the `compare/` folder; a run folder at the drive root `Z:\` resolves `captures/build/common.png` to `Z:\captures\build\common.png`, and from `Z:\runs\a` the path `../ab/common.png` leaves the run folder;
- the printed status: for every `ReportStatus` value, the name the comparer prints is the value the contract writes, and the set of names equals the schema's `enum`;
- OCR: `--no-ocr` gives `disabled` everywhere; an engine error result is recorded as `error` with its message and gives exit 2; an engine that throws `NullReferenceException` is recorded as `error` on both sides and gives exit 2; empty text on both sides widens the crop once by 96×48 px and records the widened crop; real Tesseract reads `Special Attributes   45 BP` drawn in the app's font as `Special Attributes 45 BP` and a blank crop as `empty`; a 1 px vertical bar that reaches only the top or only the bottom of a 15 px crop stays in the prepared image and one that runs from top to bottom is removed; the text cleaning only trims lines and drops blank ones (`3 EF`, `2Y`, `439N`, `11,0258` and `Specal Atributes` stay as read);
- grouping: the same change on two captures is one group; two different changes at the same place with empty OCR text are two groups; equal pixels 30 px apart on a 1280 px capture are duplicates and 100 px apart are not; a discrepancy joins the first matching representative; 50,000 discrepancies with different hashes form 50,000 groups (the whole test class runs in well under a second);
- the report written by the comparer reads back with the strict contract reader, and the composition root resolves;
- capture `--run-folder-file`: a run that stops with a setup error after creating its folder (missing candidate) exits 3, the file holds the run folder's full path, and that folder holds `summary.json`; the option without a value is rejected.

The Node test `parity/scripts/tests/start.test.mjs` runs `start.mjs` against a stand-in for npm's CLI and shows: the comparer runs on the folder capture reported and the higher status wins (capture 2, compare 1 → 2); `--no-ocr` and `--tessdata data` reach the comparer and not capture; `--tessdata` without a value exits 3 before anything runs; a comparer that exits with 1 without a report exits 3; a comparer status of 134 exits 3; a comparer that exits with 0 beside a report with status `differences` exits 3; a capture setup error skips the comparer; a run folder file that capture left as a folder, so it cannot be read, exits 3 and skips the comparer; `TEMP`, `TMP` and `TMPDIR` pointing to a missing folder exit 3 after the build and before capture; a failed candidate build skips capture and compare.

## Live evidence

All live runs below used the code at the commit before this file, unless a run says otherwise, and were started from the repository root with `npm.cmd` in PowerShell. Around each command, `Get-FileHash -Algorithm SHA256 bin/ChummerGenSR4.exe` ran right before and right after it; the values are listed per run. `git status` showed no changed tracked file after the runs, and no `parity-start-*` folder of `npm start` was left in `%TEMP%`.

The overlay `out/overlays/street-magic/` holds one file, `settings/default.xml`: `bin/settings/default.xml` (UTF-16) with `<book>SM</book>` added to `<books>`, SHA-256 `324ea75dc7250afccf4e20e3a0d929da75e262ebdb009ec2c21dba0f8927a8e6`; the summaries of the overlay runs record it with `replaced: true`. Each `npm start` that got past its argument checks built the candidate `out/candidate/bin/ChummerGenSR4.exe` (SHA-256 `fa1682e22d7a30b3adf4d289b6d6aee0e9c6b0deb0806fbb6ff761f3411ecec6`) and printed the canonical hash before and after the build, both the pinned value.

### Canonical hash per run

`Get-FileHash` gave the pinned value `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before and after every command in this table. For the capture runs, the summary's `canonical` block also records that value for `sourceSha256Before`, `sourceSha256After`, `stagedSha256Before` and `stagedSha256After`.

| Command | Run | `Get-FileHash` before / after | Summary: source before / after, staged before / after |
|---|---|---|---|
| `npm.cmd start -- --help` | none | pinned / pinned | no run |
| `npm.cmd start -- --run-folder-file x` | none | pinned / pinned | no run |
| `npm.cmd start -- --tessdata` | none | pinned / pinned | no run |
| `npm.cmd start -- --case no-such-case` | none | pinned / pinned | no run |
| `npm.cmd run compare -- --help` | none | pinned / pinned | no run |
| `npm.cmd run compare -- --run ""` | none | pinned / pinned | no run |
| `npm.cmd run compare -- --run out/runs/20261001T014508Z-74a9c1f5` | `20261001T014508Z-74a9c1f5` (compare only) | pinned / pinned | pinned ×4 (recorded by that run's capture) |
| `npm.cmd start -- --settings-overlay out/overlays/street-magic` | `20261001T025232Z-0ff65821` | pinned / pinned | pinned ×4 |
| `npm.cmd start -- --settings-overlay out/overlays/street-magic --candidate-exe out/mutant/bin/ChummerGenSR4.exe` | `20261001T025922Z-5517e131` | pinned / pinned | pinned ×4 |
| `npm.cmd start -- --no-ocr` | `20261001T030537Z-3676d850` | pinned / pinned | pinned ×4 |
| `npm.cmd start -- --case Diego_v_alpha2_by_bessgeor --capture common` (comparer that does not build) | `20261001T030848Z-16959076` | pinned / pinned | pinned ×4 |

### Without the desktop

- `npm.cmd start -- --help`: printed the capture runner's usage (including `--run-folder-file`) and `npm start passes --no-ocr and --tessdata <dir> to the comparer; see npm run compare -- --help.`; exit 0; no build ran.
- `npm.cmd start -- --run-folder-file x`: printed `npm start passes --run-folder-file to capture itself; run npm run parity to use it.` and exited 3; no build ran.
- `npm.cmd start -- --tessdata`: printed `Option '--tessdata' needs a value.` and exited 3; no build ran.
- `npm.cmd start -- --case no-such-case`: built the candidate, then capture printed `ERROR: --case matches no case: no-such-case.` and exited 3; `npm start` printed `Capture ended with a setup error (exit 3); compare did not run.` and exited 3. No run folder was created.
- `npm.cmd run compare -- --help`: printed the usage and `Exit status: 0 every row passed, 1 differences reported, 2 analysis failures, 3 setup error.`; exit 0.
- `npm.cmd run compare -- --run ""`: printed `ERROR: Option '--run' needs a value.` and the usage; exit 3. The empty argument does not reach the comparer through `npm.cmd`. Run directly, `dotnet run --project parity/src/Parity.Compare -c Release -- --run ""` printed `ERROR: The path is empty. (Parameter 'path')` and exited 3.

### Execution coverage

In every capture summary below, each side's action indexes run contiguously from 0 (0–45 for build, 0–66 for career), each index appears once with one outcome, and no required action failed. In the in-repo run the career sides failed at startup, before their first action, so all 67 of their actions are `not-run`. The optional actions that did not run are the same on both sides of every completed case:

| Case | `optional-absent` (tab not shown for this character) | `skipped-optional` (the actions of that absent tab) |
|---|---|---|
| build | 7 `selectTab:Spells and Spirits`, 10 `selectTab:Complex Forms and Sprites`, 16 `selectTab:Critter Powers` | 8 `waitFor:Selected Combat Spells`, 9 `capture:spells-and-spirits`, 11 `waitFor:Selected Advanced Complex Forms`, 12 `capture:complex-forms-and-sprites`, 17 `waitFor:Critter Powers`, 18 `capture:critter-powers` |
| career | 10 `selectTab:Complex Forms and Sprites`, 16 `selectTab:Critter Powers`, 22 `selectTab:Submersion` | 11 `waitFor:Selected Advanced Complex Forms`, 12 `capture:complex-forms-and-sprites`, 17 `waitFor:Critter Powers`, 18 `capture:critter-powers`, 23 `waitFor:Initiate Grade:`, 24 `capture:submersion` |

The runs are listed in run ID order.

### A difference between the canonical executable and the unchanged candidate: run `20261001T014508Z-74a9c1f5`

This run was captured by an earlier `npm start -- --settings-overlay out/overlays/street-magic` of this change, which exited with 1. The code that captured it is the same as at the commit before this file: `git diff` between the two shows no change under `Chummer/`, `parity/src/Parity.Capture/` or `parity/src/Parity.Imaging/`. Only the comparer and `start.mjs` changed since, so the comparer was run on it again alone with the current code.

Execution (capture): build 37/3/6 on each side (performed/optional-absent/skipped-optional; 72.8 s and 72.7 s), career 58/3/6 on each side (103.5 s and 104.9 s); no failure, no `not-run`.

Visual (capture): 33 rows, 32 pass; career `karma-and-nuyen` failed with `visual-difference` 0.000053.

Compare (`npm.cmd run compare -- --run out/runs/20261001T014508Z-74a9c1f5`, current code): `OCR: eng`; status `differences`, exit 1; totals rows 33, passed 32, analyzed 1, size mismatches 0, missing 0, failed 0, discrepancies 1, groups 1, OCR errors 0. The discrepancy has 46 differing pixels, core (1014,133) 12×18 at the top of the right panel's vertical scroll bar, crop (1002,126) 209×25 showing the scroll bar and the line `Stun Condition Track: 10`, image hash `a36dcc24b5a0f19a…`, OCR `_"|| Stun Condttion Track: 10` (canonical) and `—|| Stun Condttion Track: 10` (candidate).

The candidate here is `out/candidate/bin/ChummerGenSR4.exe` (`fa1682e2…`), built from the unchanged source. Two other runs with the same command, the same candidate, the same overlay and the same capture code, `20261001T020839Z-3de9d6b0` (summary: 33 visual passes, 0 failures) and `20261001T025232Z-0ff65821` below, captured every row identically on both sides. The cause of this one difference is not established; the record shows only that the pixels differ at the top of the scroll bar in one capture of one run. Capture-side nondeterminism is listed under Unverified.

### Current source as candidate, with the overlay: run `20261001T025232Z-0ff65821`

`npm.cmd start -- --settings-overlay out/overlays/street-magic`; `npm start` printed `Capture exit 0, compare exit 0: exit 0.`

| Case / side | Status | performed | optional-absent | skipped-optional | failed | not-run |
|---|---|---|---|---|---|---|
| build / canonical | completed, 72.7 s | 37 | 3 | 6 | 0 | 0 |
| build / candidate | completed, 73.1 s | 37 | 3 | 6 | 0 | 0 |
| career / canonical | completed, 104.2 s | 58 | 3 | 6 | 0 | 0 |
| career / candidate | completed, 105.3 s | 58 | 3 | 6 | 0 | 0 |

Visual (capture): 33 rows, 33 pass, every difference 0.

Compare: `OCR: eng`; status `clear`, exit 0; totals rows 33, passed 33, analyzed 0, size mismatches 0, missing 0, failed 0, discrepancies 0, groups 0, OCR errors 0; no crop files.

A later run of the same command with the same code on the committed fixtures, `20261001T065337Z-194d8997`, printed `Capture exit 0, compare exit 0: exit 0.`: execution had no failed or not-run action on any side (build 37/3/6 and career 58/3/6 performed/optional-absent/skipped-optional on each side), visual had 33 rows, 33 pass, every difference 0, and compare was `clear` with 33 rows passed, 0 discrepancies and 0 OCR errors, with the canonical hash `9ff30099…` before and after.

### Candidate with a deliberate visible change: run `20261001T025922Z-5517e131`

`npm.cmd start -- --settings-overlay out/overlays/street-magic --candidate-exe out/mutant/bin/ChummerGenSR4.exe`

The changed candidate was built from a scratch copy of `Chummer/` under the ignored `out/mutant/src/`, with MSBuild in Release and its output and intermediate paths under `out/mutant/`. It is not committed. A byte comparison of every file of `Chummer/` (outside `bin/` and `obj/`) with the copy finds two differing files, and `git diff --no-index --numstat` shows one changed line in each:
- `frmCreate.cs`: the Special Attributes value in the build summary is formatted with two spaces before the unit instead of one;
- `frmCareer.cs`: the status bar's nuyen amount is formatted as `{0:###,###,##0} ¥` instead of `{0:###,###,##0¥}`.

Its SHA-256 is `2dc1f6176b965c5b07d610069582ba36e94046415e0b9b3594d53377c0068961`, as the run's summary records for the candidate. `npm start` still built `out/candidate/` first; capture used the changed candidate.

`npm start` printed `Capture exit 1, compare exit 1: exit 1.`

Execution (capture): build 37/3/6 on each side (73.1 s and 73.0 s), career 58/3/6 on each side (103.6 s and 104.9 s); no failure, no `not-run`.

Visual (capture): 33 rows, 1 pass, 32 fail with `visual-difference`. The passing row is build `right-other-info`, the one build capture whose right panel shows another tab instead of the build summary. The 12 other build rows differ by 0.000175 and all 20 career rows by 0.000145.

Compare: `OCR: eng`; status `differences`, exit 1; totals rows 33, passed 1, analyzed 32, size mismatches 0, missing 0, failed 0, discrepancies 32, groups 2, OCR errors 0. `compare/crops/` holds 64 files, a canonical and a candidate crop per discrepancy.

| Group representative | Members | Core | Differing pixels each | Image hash |
|---|---|---|---|---|
| `build-Diego_v_alpha2_by_bessgeor/common#1` | 12 (every failing build row) | (1185,153) 17×10 | 152 | `15f64e2f74654850…` |
| `career-Шпала - карьера/common#1` | 20 (every career row) | (235,657) 15×19 | 126 | `54e21361fb6c810d…` |

- Each failing row has exactly one discrepancy, and its differing pixels equal the row's count (152 × 870,400⁻¹ rounds to 0.000175; 126 to 0.000145).
- The build discrepancies have identical cores and hashes. Eleven crops are (1047,104) 170×220: the build summary's label/value block from `Metatype 40 BP` to `Active Skills 138 BP`, whole rows only. On the Skills tab the text left of the summary panel joins the line, so that crop is the single line (1008,150) 206×17. They form one group regardless.
- The career crop is (43,655) 219×23, the status bar line with `Essence: 6.00` and `Nuyen: 11,025 ¥`, and contains its whole core.
- The crops show the change: the candidate's build crop shows `Special Attributes  40 BP` with the wider gap, and its career crop shows `Nuyen: 11,025 ¥`.
- OCR read text on both sides of every crop. Block crops: 10 lines each, for example `Special Attrbutes 40 BP` (canonical) and `Special Attributes 40 BP` (candidate) on the changed line, with other misreadings such as `Posttive Qualties` and `Skl Groups 108P`. Skills crop: `[ | Scecial Atbutes  40BP` (canonical) and `[l | Special Atbutes 40 BP` (candidate). Career: `12| Essence: 6.00 | Nuyen: 11,025 |` (canonical) and `12| Essence: 6.00 | Nuyen: 11,025¥|` (candidate). The text is recorded as OCR read it; grouping and detection did not depend on it. The image that the comparer prepares for OCR from the Skills crop still holds every `i` and `t` of `Special Attributes`; the threshold thickens them and Tesseract drops some of them when reading.

### In-repo settings, OCR off: run `20261001T030537Z-3676d850`

`npm.cmd start -- --no-ocr`; `npm start` printed `Capture exit 2, compare exit 0: exit 2.`

Execution (capture): build completed on both sides (37/3/6, 72.6 s each). Career **failed at startup** on both sides after 16.6 s, `not-run` 67: `startup: InvalidOperationException: The character did not open within 10 s: the largest window is 'Microsoft .NET Framework' and has no status bar.` This is the known failure of the career fixture without Street Magic (see `AGENTS.md`). The summary has no overlay.

Visual (capture): 13 rows (build only), 13 pass, difference 0. The career case has no rows because its captures were lost to the execution failure.

Compare: ran after capture's status 2 with `--no-ocr` (the command line `npm start` printed ends with `--no-ocr`); printed `OCR: disabled`, and the report has `ocr.enabled: false`; status `clear`, exit 0; 13 rows, all passed. The capture run's execution failures stay in its `summary.json` and decide `npm start`'s status 2.

### A comparer that does not build: run `20261001T030848Z-16959076`

`npm.cmd start -- --case Diego_v_alpha2_by_bessgeor --capture common`. For this run only, the line `#error Deliberate build failure for the live check` was appended to `parity/src/Parity.Compare/Program.cs` in the working tree; it was removed right after the run with `git checkout`, and `git status` was clean again.

Capture completed on both sides (build, 45.9 s and 46.1 s; 25 performed, 3 optional-absent, 6 skipped-optional, 12 filtered by `--capture`, 0 failed, 0 not-run; indexes 0–45), 1 row, `PASS build-Diego_v_alpha2_by_bessgeor/common: 0 (within-threshold)`, exit 0. `npm run compare` then failed to build (`error CS1029: #error: 'Deliberate build failure for the live check'`, `The build failed. Fix the build errors and run again.`) and exited 1. `npm start` printed `Compare exited with 1 but wrote no …\out\runs\20261001T030848Z-16959076\compare\report.json; it did not analyze the run.` and `Capture exit 0, compare exit 3: exit 3.`, and exited 3. The run folder has no `compare/` folder.

## Unverified

- Capture-side nondeterminism: run `20261001T014508Z-74a9c1f5` shows that the canonical executable and a candidate built from the unchanged source can produce differing captures (46 pixels at the top of a scroll bar), and the comparer then reports a discrepancy for it like any other. Its cause is unknown, its frequency is unmeasured (one of the three overlay runs with that candidate and this capture code, one capture out of 33 in that run), and nothing in the capture or the comparer tells such a discrepancy apart from a change in the program.
- Live analysis failures: no live run produced a `failed` row, an OCR `error`, a size mismatch or a missing capture. These statuses are covered by fixture tests only.
- Removing a partly written `compare/` folder when replacing it, grouping or writing the report fails: no test triggers this path and no live run hit it.
- Removing a row's crops when one of them cannot be written, and keeping the report when printing fails: covered by fixture tests only.
- `npm start` with a temporary folder that cannot be created or a run folder file that cannot be read, and the handler that turns any other unexpected error of the script into exit 3: covered by the Node test with a stand-in for npm, or not at all for the handler; no live run hit them.
- A run folder at a drive root: covered by a fixture test on paths only; no live run used one.
- An OCR failure while preparing a crop's image: the tests cover a throwing engine through a substituted engine, not a real Tesseract or GDI+ failure.
- A comparer that crashes with an unhandled exception: the mapping of a status outside 0–2 to 3 is covered by the Node test with a stand-in status, not by a live crash.
- Live duplicates at shifted positions: every live duplicate sat at the identical position. The position tolerance is covered by fixture tests only.
- Live single-pixel and dark-to-dark color changes: the live changes were text reflows and a scroll bar redraw. These cases are covered by fixture tests on generated images only.
- Crop shaping on a value far from its label, on a text line taller than 11 rows, and on a block cut by the scan: covered by fixture tests only.
- Grouping speed on a live run with many discrepancies: covered by the 50,000-discrepancy fixture test only.
- OCR quality beyond these crops: OCR misread letters and `¥` and cannot show spacing changes; it is a reading aid, and its accuracy on other text is unmeasured.
- Other hosts: Tesseract's native libraries were loaded only on this Windows 10 x64 host.
- Other displays and scaling: the crop rules use no positions in the window, but their pixel sizes were measured only at 150 % scaling. Foreground activation while other applications are in use and the shared `HKCU\Software\Chummer` key are as unverified as for capture; this change does not affect them.
