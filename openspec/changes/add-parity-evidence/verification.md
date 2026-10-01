# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), one 1920×1080 display at 150 % scaling, .NET SDK 10.0.401, Node 22.17.0. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Fixture-tested scope

These checks use no desktop and no live app. They ran on the commit before this file, "Park the pointer on the title bar so hover effects never depend on where it was left".

| Command | Result |
|---|---|
| `npm run openspec:validate` | `✓ change/add-parity-evidence`, `✓ spec/development-process`, `✓ spec/parity-contracts`, `✓ spec/visual-parity-capture`, `✓ spec/visual-parity-compare`, `Totals: 5 passed, 0 failed (5 items)` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 7`, `# pass 7`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 174, Skipped: 0, Total: 174` |
| `npm run parity:scripts:test` | `# tests 10`, `# pass 10`, `# fail 0` |

### Each commit on its own

Each commit of this change, from the proposal to the commit before this file, was checked out in a separate detached worktree and tested there with `dotnet test parity/Parity.slnx` and `node --test parity/scripts/tests/start.test.mjs`. Every `dotnet test` printed `Passed!` with `Failed: 0`, and every Node run printed `# tests 10`, `# pass 10`, `# fail 0`.

| Commit | Tests passed |
|---|---|
| Propose add-parity-evidence | 124 |
| Add the execution coverage and capture timing contracts and record each side's source in the summary | 126 |
| Audit execution coverage after each run and fail the run when it is invalid | 138 |
| Time UI operations with a decorator around the driver and write timing.json | 148 |
| Reuse canonical sides from a capture cache keyed by every input that decides their pixels | 160 |
| Account for every planned capture in the compare report | 170 |
| Add archetype fixtures and document the sourcebook overlay, the canonical cache and the new run files | 170 |
| Wait for the Submersion Grade label on the Submersion tab | 170 |
| Keep the commit ID out of the parity tools' assemblies so cache keys change only with their code | 171 |
| Describe how the cache key treats the runner's build | 171 |
| Build the parity tools without git queries so no commit ID reaches their assemblies | 171 |
| Clear the technomancer fixtures' link to another character file and test that no fixture links one | 172 |
| Park the pointer on the title bar so hover effects never depend on where it was left | 174 |

### What the tests cover

- Contracts: `parity-execution-coverage` and `parity-capture-timing` examples, and the extended summary and compare report examples, round-trip through the generated zod schemas and the C# readers and writers.
- Coverage audit (`CoverageAuditorTests`): a complete side with an absent optional tab is valid and lists the absence and its skipped actions apart from failures; a missing record, a repeated index and a record naming another action are `action-gap`; a failed action and a startup failure are `failure`; a performed capture without a file is `capture-without-file`; a file for a capture that did not perform and a file for an unplanned capture are `file-without-capture`; a cached side is audited and counted like a live one; coverage round-trips through the contract. `CaptureRunTests` shows that invalid coverage gives status 2 even when every visual row passed, and that execution failures win over visual results.
- Timing (`TimingTests`, scripted driver and a stepping clock): every operation of a side is measured in order with its target; a throwing call is recorded as failed and the action outcomes do not change; a failed launch is measured and rethrown; per-operation count, failures, total, nearest-rank median and 80th percentile, and maximum; measuring outside a side fails; timing round-trips through the contract.
- Canonical cache (`CanonicalCaptureCacheTests`): the key is stable and changes with every input; the environment lists screens, DPI, OS, cultures and the runner's assemblies; the runner's assemblies embed no commit ID; a miss runs live and stores, and a hit restores captures and records without launching; a capture with a changed hash, an unreadable entry and a missing capture file fail the restore as setup errors; a failed side is not stored; an existing entry is never replaced; a cache folder inside the repository (outside `out/`) is rejected; the option is parsed; the summary records sources and the cache block.
- Completeness (`CompletenessTests`): every reported capture is complete; a performed capture without a row is `unaccounted` and gives `analysis-failures`; a capture lost to an execution failure is `execution-lost` and leaves the status alone; filtered and optional-absent captures are accounted for; an optional tab absent on one side only without a row is `unaccounted`; a failed row is `analysis-failed`; a row that no case planned is `unaccounted`; a run without `coverage.json`, with an unreadable one, or with one of another run is a setup error with no report.
- Fixtures (`CaseFileLoaderTests`): the repository case file loads all 13 cases in order with their declared modes, and the folder holds 13 fixtures; no fixture names a linked character file in a `file` or `relative` element. With `technotest.chum` restored from the commit before the fix, that test failed and printed `technotest.chum links C:\Placeholder\Diego_v_alpha2_by_bessgeor.chum` and `technotest.chum links ../C:/Placeholder/Diego_v_alpha2_by_bessgeor.chum`.
- Pointer (`PointerParkerTests`, `SideExecutorTests`): the parking spot is the middle of the visible bounds horizontally and half the caption height below their top, also on a screen left of the primary one; a pointer moved before a capture fails that capture with the reason `pointer: scripted pointer move`, and the actions after it do not run.

### The runner's assemblies across a commit

In a detached worktree at the commit before this file, `dotnet build parity/src/Parity.Capture -c Release` produced `Parity.Capture.dll` `2A3DE18AAA409AFE…`, `Parity.Cases.dll` `1E845B9EB5C959C1…` and `Parity.Imaging.dll` `B28E80F5CBE97F2B…` (SHA-256 prefixes). After an empty commit in that worktree, `dotnet build … -c Release --no-incremental` produced the same three hashes, so a commit that changes no code keeps the cache keys. The worktree and its commit were removed afterwards.

## Live evidence

All runs were started from the repository root with `npm.cmd` in PowerShell, each with `--settings-overlay out/overlays/fixture-books`. That overlay holds one file, `settings/default.xml`: `bin/settings/default.xml` (UTF-16) with the books `AR`, `AT`, `AU`, `DG`, `GH`, `RC`, `RW`, `SA`, `SDN`, `SG`, `SM`, `TOD`, `UCL`, `UN`, `WA` and `WAR` added to `<books>`, SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`; every summary records it with `replaced: true`. Every run built the candidate `out/candidate/bin/ChummerGenSR4.exe`, SHA-256 `0651a9efc4e75fe3dba3e6eb471d0b4ddf8fc79f57e49f2bdeb7c416535f56f8`.

### Canonical hash per run

`Get-FileHash -Algorithm SHA256 bin/ChummerGenSR4.exe` ran right before and right after every command below and printed the pinned value `9ff30099…` each time. Every summary records the pinned value for `sourceSha256Before`, `sourceSha256After`, `stagedSha256Before` and `stagedSha256After`.

| # | Run | Commit | Arguments after `--settings-overlay out/overlays/fixture-books` | Exit (capture, compare) | Wall time |
|---|---|---|---|---|---|
| 1 | `20261001T070935Z-97241689` | Build the parity tools without git queries… | `--canonical-cache out/canonical-cache-masked` | 2 (2, 0) | 36 min 34 s |
| 2 | `20261001T074918Z-0c4177f0` | Clear the technomancer fixtures' link… | `--case build-technotest --case "career-technotest - career"` | 0 (0, 0) | — |
| 3 | `20261001T075454Z-aec97540` | Clear the technomancer fixtures' link… | `--canonical-cache out/canonical-cache-b` | 0 (0, 0) | 37 min 44 s |
| 4 | `20261001T083606Z-e694fb72` | Clear the technomancer fixtures' link… | `--canonical-cache out/canonical-cache-b` | 1 (1, 1) | 19 min 11 s |
| 5 | `20261001T090029Z-8acbcb70` | Park the pointer on the title bar… | `--case build-Diego_v_alpha2_by_bessgeor` | 0 (0, 0) | — |
| 6 | `20261001T090318Z-16624233` | Park the pointer on the title bar… | `--canonical-cache out/canonical-cache-c` | 2 (2, 1) | 36 min 34 s |
| 7 | `20261001T094320Z-a9818a26` | Park the pointer on the title bar… | `--canonical-cache out/canonical-cache-c` | 0 (0, 0) | 20 min 6 s |
| 8 | `20261001T100824Z-681985a4` | Park the pointer on the title bar… | `--canonical-cache out/canonical-cache-d` | 0 (0, 0) | 37 min 43 s |
| 9 | `20261001T104826Z-931e3d84` | Park the pointer on the title bar… | `--canonical-cache out/canonical-cache-d` | 0 (0, 0) | 18 min 53 s |

Each cache folder was new and empty before the first run that used it. Runs 8 and 9 are the evidence for the finished change; runs 1 to 7 record the two defects found on the way and their fixes.

### Run 1: technomancer fixtures that link another character file (execution failure)

Both technomancer cases failed on both executables at the Pets and Cohorts tab: build at action 35 and career at action 41, `waitFor:Add Pet`, `TimeoutException: Timed out after 5 s waiting for visible UI label 'Add Pet'.` The other 11 cases completed on both sides.

- Execution: coverage invalid with `failure:build-technotest/canonical`, `failure:build-technotest/candidate`, `failure:career-technotest - career/canonical` and `failure:career-technotest - career/candidate`; 26 sides, 1448 actions, 4 failed, 70 not run, 78 optional absent, 156 skipped optional; every side's indexes contiguous. The two failed canonical sides were not stored (`failed, so it is not stored in the cache`): 13 misses, 11 stores.
- Visual: 198 rows, 198 pass.
- Compare: `clear`, exit 0, 198 rows passed, 0 discrepancies, 0 OCR errors. Completeness complete: planned 250, reported 198, optional absent 39, execution lost 13 (the 4 build and 9 career captures after the failure, each `canonical not-run, candidate not-run`), unaccounted 0.

Cause: each technomancer fixture had a pet contact whose `file` named a character file outside the fixture, at a path that does not exist on this host. The app's pet control loads that file when the Pets and Cohorts tab creates it (`Chummer/PetControl.cs`), and the label never appeared. The fix clears the pet's `file` and `relative` elements (UTF-16, line endings and every other byte kept) and adds the fixture test above. Run 2, the two technomancer cases alone after the fix: coverage valid, 4 sides, 226 actions, 0 failed, 14 optional absent, 28 skipped optional; 32 rows, 32 pass; compare `clear`; completeness 39 planned, 32 reported, 7 optional absent.

### Run 3: the whole suite live after the fixture fix

Execution: coverage valid; 26 sides all `live`, 1448 actions, 0 failed, 0 not run, 78 optional absent, 156 skipped optional, 211 of 250 planned captures on both sides. Visual: 211 rows, 211 pass. Compare: `clear`, 0 discrepancies; completeness complete, 211 reported, 39 optional absent. Cache: 13 misses, 13 stored.

### Run 4: canonical sides from the cache, with the pointer moved (visual differences)

Run 4 repeated run 3's command. Every canonical side came from the cache (13 hits, each `cache` from run 3).

- Execution: coverage valid, the same counts as run 3, with 13 cached sides.
- Visual: 211 rows, 47 pass, 164 fail with `visual-difference`: every row of the 10 cases from `career-facemage_Sam_career` on; the first three cases passed.
- Compare: `differences`, exit 1; 164 rows analyzed, 169 discrepancies, 2 groups, 0 OCR errors; completeness complete (211 reported, 39 optional absent).
  - Group `career-facemage_Sam_career/common#1`, 164 members: core (1232,0) 47×22, 1034 differing pixels, the title bar's close button. The cached canonical crop shows it red (hovered); the live candidate crop shows it plain.
  - Group `career-facemage_Sam_career/notes#2`, 5 members (the notes capture of every career case from that point on): core (14,105) 1016×537, 5130 differing pixels, the border of the Notes text box, dark (hovered) on the candidate side.

Cause: the mouse pointer. During run 3 it rested on the close button, so both live sides of run 3 drew it hovered and the cache stored that. During run 4, between the third and the fourth case, it was moved; after the run it was at logical (763,627), over the window body and the Notes text box. Hover effects depend on the pointer position, which neither the key nor the runner controlled. The fix parks the pointer in the middle of the title bar before the startup delay, fails a capture whose pointer has moved, and raises the cache format to 2 so entries stored before it miss.

### Run 5: pointer left on the close button

Before the run, the pointer was moved to logical (1262,8), on the close button. After it, the pointer was at logical (640,11), the middle of the title bar. Execution: both sides completed, 37 performed, 3 optional absent, 6 skipped optional. Visual: 13 rows, 13 pass. Compare: `clear`. The close button's pixel at (1262,8) is white (255,255,255), not hovered, in `common`, `skills` and `character-info` on both sides.

### Run 6: a foreground loss and a capture taken before a tab header was drawn (execution failure and a visual difference)

The pointer was left at logical (763,627) before the run.

- Execution: coverage invalid, `failure:build-Diego_v_alpha2_by_bessgeor/canonical`. That side failed at startup after 3.3 s: `startup: window-activation: window 12916500 was not in the foreground after 10 attempts 200 ms apart (foreground: window 135666 'Claude' of class 'Chrome_WidgetWin_1' in process 11288 (claude)).` Another application's window held the foreground. All 46 of its actions are `not-run`, and it was not stored. Every other side completed: 1448 actions, 0 failed actions, 1 startup failure, 46 not run, 75 optional absent, 150 skipped optional. Cache: 13 misses, 12 stored.
- Visual: 198 rows, 197 pass; `career-technotest - career/submersion` failed with `visual-difference` 0.001792.
- Compare: `differences`, exit 1; 1 discrepancy, 1 group, 0 OCR errors: core (300,74) 71×22, 1560 differing pixels. In the candidate crop the selected `Submersion` tab header has no text; the canonical crop shows `Submersion`. Completeness complete: 198 reported, 36 optional absent, 16 execution lost (the Diego captures), 0 unaccounted.

The same capture was identical on both executables in runs 2, 3, 7, 8 and 9. Run 7 compared run 6's cached canonical side of this case with a new live candidate side, and they were identical. The missing header text is therefore a capture taken before the app finished drawing the tab, not a difference between the executables; see Unverified.

### Run 7: canonical sides from run 6's cache, with the pointer on the close button

The pointer was moved to logical (1262,8) before the run and was at (640,11) after it. Cache: 12 hits, each `cache` from run 6, and 1 miss, `build-Diego_v_alpha2_by_bessgeor`, whose run 6 side had failed; it ran live and was stored. Execution: coverage valid, 1448 actions, 0 failed, 0 not run, 78 optional absent, 156 skipped optional. Visual: 211 rows, 211 pass. Compare: `clear`, 0 discrepancies; completeness complete, 211 reported, 39 optional absent. Cached canonical sides captured under a pointer at (763,627) matched live candidate sides started with the pointer on the close button.

### Run 8: baseline, the whole suite live

The pointer was left at logical (763,627) before the run and was at (640,11) after it. `npm start` printed `Capture exit 0, compare exit 0: exit 0.`

Execution (`coverage.json`): `valid`, no invalid reasons. Totals: 13 cases, 26 sides (0 cached), 1448 actions, 0 failures, 0 startup failures, 78 optional absent, 156 skipped optional, 0 filtered, 0 not run, 250 planned captures, 211 captured pairs. On every side the indexes run contiguously from 0 (0–45 for build, 0–66 for career), each once and naming its planned action.

| Case | Canonical (live) | Candidate (live) | Performed | Optional absent | Skipped optional | Failed | Not run |
|---|---|---|---|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | 74.4 s | 74.7 s | 37 | 3 | 6 | 0 | 0 |
| career-Шпала - карьера | 105.4 s | 106.0 s | 58 | 3 | 6 | 0 | 0 |
| build-facemage_Sam | 83.6 s | 82.7 s | 40 | 2 | 4 | 0 | 0 |
| career-facemage_Sam_career | 103.6 s | 101.9 s | 58 | 3 | 6 | 0 | 0 |
| build-rigger | 79.4 s | 79.3 s | 40 | 2 | 4 | 0 | 0 |
| career-rigger_career | 94.5 s | 95.5 s | 58 | 3 | 6 | 0 | 0 |
| build-hacker4boegspriet | 79.4 s | 80.3 s | 37 | 3 | 6 | 0 | 0 |
| build-technotest | 70.9 s | 70.9 s | 37 | 3 | 6 | 0 | 0 |
| career-technotest - career | 90.5 s | 90.1 s | 55 | 4 | 8 | 0 | 0 |
| career-test_adept | 89.8 s | 89.4 s | 55 | 4 | 8 | 0 | 0 |
| build-spirit | 74.9 s | 74.2 s | 40 | 2 | 4 | 0 | 0 |
| build-Skull Carver - precareer | 80.1 s | 81.6 s | 37 | 3 | 6 | 0 | 0 |
| career-Skull Carver - career | 100.5 s | 101.7 s | 55 | 4 | 8 | 0 | 0 |

The counts are per side and equal on both sides. The optional tabs found absent, by action index, are the same on both sides of every case; each absent tab skips its label wait and its capture:

| Case | Optional tabs absent |
|---|---|
| build-Diego_v_alpha2_by_bessgeor | 7 Spells and Spirits, 10 Complex Forms and Sprites, 16 Critter Powers |
| career-Шпала - карьера | 10 Complex Forms and Sprites, 16 Critter Powers, 22 Submersion |
| build-facemage_Sam | 10 Complex Forms and Sprites, 16 Critter Powers |
| career-facemage_Sam_career | 10 Complex Forms and Sprites, 16 Critter Powers, 22 Submersion |
| build-rigger | 10 Complex Forms and Sprites, 16 Critter Powers |
| career-rigger_career | 10 Complex Forms and Sprites, 16 Critter Powers, 22 Submersion |
| build-hacker4boegspriet | 7 Spells and Spirits, 10 Complex Forms and Sprites, 16 Critter Powers |
| build-technotest | 7 Spells and Spirits, 13 Adept Powers, 16 Critter Powers |
| career-technotest - career | 7 Spells and Spirits, 13 Adept Powers, 16 Critter Powers, 19 Initiation |
| career-test_adept | 7 Spells and Spirits, 10 Complex Forms and Sprites, 16 Critter Powers, 22 Submersion |
| build-spirit | 10 Complex Forms and Sprites, 13 Adept Powers |
| build-Skull Carver - precareer | 7 Spells and Spirits, 10 Complex Forms and Sprites, 16 Critter Powers |
| career-Skull Carver - career | 7 Spells and Spirits, 10 Complex Forms and Sprites, 16 Critter Powers, 22 Submersion |

Every optional tab is captured with content in at least one case: Spells and Spirits in 6 cases, Complex Forms and Sprites in both technomancer cases, Adept Powers in 10, Critter Powers in the free spirit, Initiation in 5 career cases, and Submersion in the technomancer career.

Visual (`results.json`): 211 rows, 211 pass, every difference 0.

Compare (`compare/report.json`): `OCR: eng`; status `clear`, exit 0; rows 211, passed 211, analyzed 0, size mismatches 0, missing 0, failed 0, discrepancies 0, groups 0, OCR errors 0. Completeness: `complete`; planned 250, reported 211, analysis failed 0, filtered 0, optional absent 39, execution lost 0, unaccounted 0.

Cache: 13 misses, 13 stored.

Timing (`timing.json`): 26 sides; the samples add up to 2250.9 s (canonical 1125.0 s, candidate 1125.9 s) of a 37 min 43 s run, which also builds the candidate and the tools, stages the apps and runs the comparer.

| Operation | Count | Failed | Total | Median | 80th percentile | Maximum |
|---|---|---|---|---|---|---|
| launch | 26 | 0 | 200.4 s | 7571.8 ms | 8810.6 ms | 8910.3 ms |
| activate | 1292 | 0 | 13.7 s | 4.8 ms | 16.3 ms | 197.4 ms |
| selectTab | 474 | 78 | 64.8 s | 44.7 ms | 75.5 ms | 2169.2 ms |
| waitForLabel | 396 | 0 | 1077.6 s | 2180.7 ms | 2334.8 ms | 12288.6 ms |
| capture | 422 | 0 | 887.0 s | 1669.8 ms | 1801.6 ms | 10059.3 ms |
| close | 26 | 0 | 7.4 s | 278.5 ms | 326.0 ms | 345.8 ms |

The 78 failed tab selections are the 78 optional absences: the decorator records the throwing call, and the outcome stays `optional-absent`. The suite has no `wait` action, so no `wait` samples exist. Label waits and captures take 87 % of the measured time.

### Run 9: the canonical sides from run 8's cache

The pointer was moved to logical (1262,8), on the close button, before the run and was at (640,11) after it. `npm start` printed `Capture exit 0, compare exit 0: exit 0.`

- Cache: 13 hits, 0 misses, 0 stored; every canonical side in the summary has source `cache` from `20261001T100824Z-681985a4`, and the canonical executable was not launched.
- Execution: coverage valid; 26 sides, 13 of them cached, with the same per-side counts and indexes as run 8 (the cached sides carry run 8's records and durations); 0 failed, 0 not run.
- Visual: 211 rows, 211 pass.
- Compare: `clear`, 0 discrepancies, 0 OCR errors; completeness complete, 250 planned, 211 reported, 39 optional absent, 0 unaccounted.
- Timing: 13 sides (the candidate sides), 1123.3 s of samples; the run took 18 min 53 s instead of run 8's 37 min 43 s.

## Unverified

- Captures taken before the app finished drawing: in run 6 one candidate capture lacked the text of the selected tab header (1 of 198 rows; the same capture matched in the five other runs that took it). The runner waits for a label in the tab's content and for stable window bounds, not for the tab header to be painted. The cause is not confirmed, the frequency is unmeasured, and nothing tells such a discrepancy apart from a change in the program.
- Foreground loss: another application taking the foreground at a side's start failed that side in run 6, as designed. Nothing beyond the bounded activation retries protects a run from it.
- A pointer moved during a side: no live run moved the pointer after the runner parked it, so the `pointer:` failure is covered by the fixture test only. The parking spot was used live only on one display at 150 % scaling; screens with different scaling, a window on a secondary screen, and pen or touch input are untested.
- The cache key leaves out the app's registry key `HKCU\Software\Chummer` and anything else outside the runner's control besides the pointer. A change there that alters pixels would still hit.
- Cache entries across a commit: shown by the identical assembly hashes after an empty commit, not by a live run on a later commit. The hashes differ between build folders: the detached worktree built `Parity.Capture.dll` as `2A3DE18A…`, while run 8's cache key records `d58f335a…` for the same commit built in the repository, so an entry is expected to be reused only by a checkout at the same path; reuse from another folder was not tried.
- Cache failures live: a corrupted or unreadable entry, a missing cached file and two runs storing the same key at once were not hit live; the first three are covered by fixture tests, the last by none.
- Coverage and completeness states live: no live run produced `action-gap`, `capture-without-file`, `file-without-capture`, `analysis-failed` or `unaccounted`. They are covered by fixture tests only. `failure`, startup failures, `optional-absent` and `execution-lost` were produced live (runs 1 and 6).
- Timing overhead: the cost of the decorator itself was not measured.
- Fixture content: the reviewed fixtures carry neutral placeholders instead of some notes, links, one contact name and the face mage portrait. Captures of the originals were not compared with captures of the placeholders.
- Other hosts, OS versions, cultures and overlays: every run used this host, the culture `en-US` and the one overlay above.
