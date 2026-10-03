# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The code of the branch is final at commit `d58dbc163ee04245140e17d47f203aeb143b23b0`, whose trees are `Chummer` `7f689d96dd8c0725c0c546aa606b3752e09603bd`, `Core` `541ba8d76da65003d6ed7ffec7a0cf9fdaaead92`, `parity` `9199379e8042a215884fe30719df4a8bc7134c7f` and `workflow` `12cc6866967ed142a72f1add6cdb8d312f9e7cb2`; the commits after it (this record and the archive) change only `openspec/`. The checks and the live run below used these four trees.

The candidate of the live run was built by the workflow from the files of `Chummer/` and `Core/` of that commit: `ChummerGenSR4.exe` SHA-256 `9b03684e0324847e46d19416d0eb1edefc3697be42d4672086dedcd8690d3e98`, `ChummerGenSR4.Core.dll` SHA-256 `deff1711ee85f2484c9ab1cfccb54f9875197797c9d8a0d18b2a6ae20f853a6a`, compiled source identity `4ce048ed5a40f21b8b57ab19b391a6675d53b05f5a223b5a104555f74560c19a` (`out/candidate/source-fingerprint.txt`).

## Checks

On the final code:

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 15 passed, 0 failed (15 items)` (with the change in progress) |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 345`, `# pass 345`, `# fail 0` |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:    13, Skipped:     0, Total:    13` (`Parity.Hosted.Tests.dll`) and `Passed!  - Failed:     0, Passed:   247, Skipped:     0, Total:   247` (`Parity.Tests.dll`) |
| `npm run contracts:check` | `Generated contracts are up to date (14 files).` |
| `npm run contracts:test` | `# tests 9`, `# pass 9`, `# fail 0` |

The workflow and contract checks ran on the code before two review fixes (a `readonly` modifier on `ItemFinder`'s field and the hosted test host's guard, below); neither touches `workflow/`, `contracts/` or what those checks read.

## Fixture-tested scope (builds, metadata, git and unit tests, no desktop)

Every build went through `parity/scripts/build-candidate.mjs` (`npm run build:candidate`), which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time and printed `Core -> …\ChummerGenSR4.Core.dll` and `Chummer -> …\ChummerGenSR4.exe` with no error after each of the steps below.

- Item searches (task 1.1), commit `f018ec98`: the searches were cut by a script that copies the line range from the summary of `FindGear` to the end of `FindMartialArtManeuver` (671 lines) of `Chummer/clsCommon.cs`. `git diff --stat --histogram d03d848b f018ec98` prints `Chummer/ItemFinder.cs | 694 +++` and `Chummer/clsCommon.cs | 679 +---` (3 insertions, 676 deletions). `ItemFinder.cs` is the 671 lines between a frame of 21 lines (`using` lines, namespace, class with the protected `_objCharacter` field and the constructor that sets it) and 3 closing lines. `clsCommon.cs` loses those 671 lines, the blank line after them, its private field, the blank line after it and its constructor's body, and changes the class line (`: ItemFinder`) and both constructors (`: base(objCharacter)` and `: base(null)`); `FindNode` and `FindCharacterCommlinks` stay in `CommonFunctions`.
- Host (task 1.2), commit `9d9640f6`: `IApplicationHost.ProductVersion` and `SaveImage`; `WinFormsApplicationHost` returns `Application.ProductVersion` and writes an image with the same `MemoryStream`, `Image.FromStream(stream, true)` and `Image.Save(path)` calls the character made; the two test hosts implement them. `npm run parity:test` passed.
- View model (task 1.3), commit `cf72ff0f`: `CharacterViewModel` holds `Character`, `PrintWindow` and `Print`, which is the former `Character.Print` with `PrintToStream` called on its character and the preview window given a list holding this view model. `frmCreate` and `frmCareer` take a view model, set `_objCharacter` to its character, print through it (two calls each), refresh its `PrintWindow` (one each) and clear it with their other fields when they close; `frmMain` passes `new CharacterViewModel(objCharacter)` at its four constructions; `frmViewer` holds view models, prints their characters and clears their `PrintWindow`. A search of `Chummer/` (designer files aside) for `PrintWindow|\.Characters\b|frmViewer` prints only the view model, `frmCareer`, `frmCreate`, `frmViewer` and `frmPrintMultiple`, which creates a preview window without characters as before; `Character` has no `Print` and no `PrintWindow`.
- In place (task 1.4), commit `0221a5cb`: the commit changes `clsCharacter.cs` by its two `using` lines, the saved version (`ApplicationHost.Current.ProductVersion`), the game edition error (`ApplicationHost.Current.ShowError` with the same two strings, inside the same `try`), the mugshot (`ApplicationHost.Current.StartupPath` for the folder and `ApplicationHost.Current.SaveImage` for the decode and save), the three gear searches (`ItemFinder` instead of `CommonFunctions`), and the five quality creations of the old quality conversion (an `UnshownTreeNode` and the new private `AddGrantedWeapon` instead of a `TreeNode` and two lists). On `Core/Character.cs` of the final code this search printed only the five `UnshownTreeNode` declarations:

  ```powershell
  Select-String Core/Character.cs -Pattern '\bApplication\.|MessageBox|\bImage\b|\bTreeNode\b|\bfrm[A-Z]|CommonFunctions|Forms|Drawing' | Where-Object { $_.Line -notmatch '^\s*//' }
  ```

- Move (task 1.5), commit `39331dfd`: `git show -M90% --name-status --format= 39331dfd` prints `R100 Chummer/clsCharacter.cs Core/Character.cs`, `R100 Chummer/clsExpenses.cs Core/Expenses.cs`, `R100 Chummer/ItemFinder.cs Core/ItemFinder.cs` and `R100 Chummer/StackedFocus.cs Core/StackedFocus.cs`, and the hosted test project's changes that the move requires (its stand-in `Character` removed, because it now conflicts with the library's; its host folder given a copy of `bin/settings/default.xml`, which the character options read; selection dialogs that fail any question, which the character's improvement manager holds). `git log --follow --format='%h %s' -- Core/Character.cs` lists the move, the in-place commit, the view model commit and then the earlier commits of `Chummer/clsCharacter.cs`. `git ls-files --eol` prints `i/crlf` for the four moved files, `Chummer/CharacterViewModel.cs` and `Core/UnshownTreeNode.cs`.
- Types (task 1.5): the type definitions of the live run's candidate were compared with those of a build of the source before this change (the parent branch's `Chummer/` and `Core/` taken with `git archive` into a scratch folder and built with `node parity/scripts/build-candidate.mjs --source <scratch>/src --output <scratch>/build --log <scratch>/build.log`; `ChummerGenSR4.exe` `36800fe1…`, `ChummerGenSR4.Core.dll` `1d774eeb…`). The names were read from the assemblies' metadata with `System.Reflection.Metadata` (as `exe` or `lib` plus namespace and name, nested types as `Outer+Inner`, leaving out `<Module>` and the compiler's types whose names hold `<`) and compared with `Compare-Object`. The baseline has 206 types (135 in the executable, 71 in the library) and the candidate 209 (117 and 92). The comparison printed exactly 41 lines: `Character`, `ExpenseLogEntry`, `ExpenseType`, `ExpenseUndo`, `KarmaExpenseType`, `NuyenExpenseType`, `StackedFocus` and the twelve delegates (`AdeptTabEnabledChangedHandler`, `BlackMarketEnabledChangedHandler`, `CharacterNameChangedHandler`, `CritterTabEnabledChangedHandler`, `InfirmChangedHandler`, `InitiationTabEnabledChangedHandler`, `MAGEnabledChangedHandler`, `MagicianTabEnabledChangedHandler`, `RESEnabledChangedHandler`, `TechnomancerTabEnabledChangedHandler`, `UncouthChangedHandler`, `UneducatedChangedHandler`, outside any namespace) gone from the executable and added to the library; `ItemFinder` and `UnshownTreeNode` added to the library; `CharacterViewModel` added to the executable. No name is defined in both assemblies.
- Never-shown node without a host (task 1.6), commit `d58dbc16`: `UnshownTreeNodeTests` (4 tests): a new node has empty text, no tag, no grey text, no expansions and no children; a node keeps its text, tag, grey text, two children in order and two expansions, and the children keep their own values; `NewNode` returns an empty `UnshownTreeNode` that is not added; adding a test node of another kind or `null` throws an `InvalidCastException` and adds nothing. With the other tests: 247 of 247 pass (243 before this change).
- The character with a host (task 1.6): `Parity.Hosted.Tests` registers its host once for the process, now with a copy of `bin/settings/default.xml`, small `skills.xml` (no skills), `metatypes.xml` (a human with a movement) and `qualities.xml` (a quality that grants a weapon) beside the former data files, the two strings of the game edition error in its language file, the product version `0.0.0.512`, and error messages and written images that it records only while a test asks it to and otherwise fails the test, as every other question does. `CharacterTests` (6 tests) uses the library's `Character`:
  - a saved character's file holds `appversion` `512`, and loading it again returns `true` with the same name and alias and shows no error;
  - a file whose game edition is `SR5` makes `Load` return `false` after exactly one error with the two strings of the language file;
  - a character with a mugshot prints it through the host's image writer: the written bytes are the mugshot's, the file is a `.img` in the `mugshots` folder of the host's folder, which exists, and the printout holds that file's `file://` URL and the base64 mugshot; a character without a mugshot writes no image and prints an empty URL;
  - a saved file whose quality is rewritten in the old format (`Test Claws Quality [5]`) loads with that quality, created from the data file, and with the weapon it grants, whose identifier the quality keeps;
  - `ItemFinder` finds a piece of gear and the gear plugged into it by their identifiers and returns `null` for an unknown one.

  The existing weapon and vehicle extension tests now pass the library's `Character`. 13 of 13 pass.

  Mutation checks: removing `objWeapons.Add(objWeapon);` from `AddGrantedWeapon` made the old quality test fail and the other 12 pass; changing the mugshot folder name in the image writer's path from `mugshots` to `mugshot` made the mugshot test fail and the other 12 pass. Both changes were undone and are in no commit, and the 13 tests passed again.
- Not executed by any test: `CharacterViewModel` (it opens `frmViewer`, which the test projects do not compile), the two app host members (they call Windows Forms and drawing), the changed constructors of `frmCreate` and `frmCareer` and the four constructions in `frmMain` outside the live run, and the inherited searches of `CommonFunctions` (its other members need the app; the build shows that every call still binds).

## Live evidence

The canonical side of every case came from the shared canonical capture cache (each case's capture log names the cache entry and the run that stored it); the candidate side ran live in every case. This change touches only the app and the library, which only the candidate runs, and not how canonical sides are captured. The settings overlay held `settings/default.xml` with the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). No agent job ran, because no discrepancy cluster was produced.

`Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before the run, after the deliberate stop and after the resumed run, and every build and capture runner call printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` as `Canonical SHA-256 before` and `after`.

### Whole suite with diagnosis, repair and widening, stopped and resumed

Command: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --fix-changes`, with the local profile choosing Codex for the hypothesis, grade and repair jobs. Thread `wf-20261003T201208Z-704bfb08`, all 13 cases.

Stop and resume: after the first case had been captured and compared, the process tree of the run was killed (`taskkill /PID <pid> /T /F`) while the second case (`career-Шпала - карьера`, run folder `20261003T201412Z-e7795b6a`) was being captured; that run folder was left incomplete and is not evidence. `npm.cmd start -- --resume wf-20261003T201208Z-704bfb08` printed `Resuming thread wf-20261003T201208Z-704bfb08.` and `Taking over the desktop lane from process 30148, which is no longer running.`, did not build again or capture the first case again, and captured the second case anew in run folder `20261003T201505Z-250b7380`.

The resumed thread ended with `Thread wf-20261003T201208Z-704bfb08 finished: exit 0.`: `Triage: 0 discrepancies in 0 clusters (0 new), 0 other findings`, `Diagnosis: 0 clusters`, `Repair: 0 clusters`, `Widening: 0 attempts, 0 promoted, 0 rejected; no accepted branch` and `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 28.6 min`. The inventory step printed `Inventory: 69 classes (9 active), controls observed 996/1379, interactions exercised 4/857, tuples observed 211/250, unresolved 6`.

Execution, per case (capture status; coverage; where the canonical side came from):

| Case | Run folder | Capture | Coverage | Canonical side |
|---|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261003T201212Z-ab555a0c` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| career-Шпала - карьера | `20261003T201505Z-250b7380` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-facemage_Sam | `20261003T201740Z-266abbaf` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| career-facemage_Sam_career | `20261003T201939Z-9ec0736e` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-rigger | `20261003T202204Z-9596f5c3` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| career-rigger_career | `20261003T202358Z-44b80ce2` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-hacker4boegspriet | `20261003T202615Z-04b5409a` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-technotest | `20261003T202820Z-1309c372` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| career-technotest - career | `20261003T203007Z-15e0a533` | 0 | valid, contiguous, 0 failures, 8 optional absent | cache |
| career-test_adept | `20261003T203232Z-d9b9a216` | 0 | valid, contiguous, 0 failures, 8 optional absent | cache |
| build-spirit | `20261003T203440Z-1f302444` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| build-Skull Carver - precareer | `20261003T203626Z-e770d8ce` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| career-Skull Carver - career | `20261003T203820Z-419a0a75` | 0 | valid, contiguous, 0 failures, 8 optional absent | cache |

Execution failures: none.

Visual, per case (compare report and completeness; 0 analysis-failed, 0 filtered and 0 unaccounted in every case):

| Case | Compare | Rows passed / failed | Planned / reported / optional absent / execution lost |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-Шпала - карьера | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |
| build-facemage_Sam | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| career-facemage_Sam_career | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |
| build-rigger | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| career-rigger_career | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |
| build-hacker4boegspriet | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| build-technotest | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-technotest - career | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |
| career-test_adept | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |
| build-spirit | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| build-Skull Carver - precareer | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-Skull Carver - career | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |

All 13 cases are within the threshold in every row of every planned capture, with no discrepancy, in one thread. Every case opens its character from its saved file through the main window, which now creates the character window from a view model, with the library's `Character`, its `Load` and the values it computes.

## Findings

- A review of the branch found that the existing requirement on the character's items still kept `StackedFocus` in the app; the change now modifies that requirement. It also found that the hosted test host, once it recorded error messages and written images for the character tests, no longer failed the other tests on an unexpected error; it now records them only while a test asks it to.

## Archive

Recorded in the archive commit below.

## Unverified

- The workflow's repair and widening never ran on a cluster, because the run produced none, and no regression was provoked on purpose. No hypothesis or challenge job, no check capture and no quota wait was observed on this source.
- No case prints a character, opens a file of another game edition, has a mugshot printed or loads a save file with qualities in the old format, so the print preview of the view model, the closing of the preview window, the error message and the mugshot writer of the app's host ran nowhere live, and no file that the character saved during the live run was inspected for its version. The saved version, the error, the mugshot path and the old quality conversion ran only in the hosted tests, with a recording host and small data files; the app host's `ProductVersion` and `SaveImage` and the view model's `Print` are covered by the build and by reading the diff only.
- The unit tests run the library on .NET (the test projects' runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths they exercise use no framework-specific behaviour.
- The Debug configuration and Visual Studio's form designer were not tried.
