# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, .NET SDK 10.0.401, Node.js 22.17.0. The checks were made on the final source of this change. The desktop runs under Live evidence were made on the capture runner with the interfaces behind the action checks and their unit tests; the one source change after them is the message of the failure in `CharacterSaver` when the saved file stays open past its wait (with its test), which leaves the success path of the save as it was. The commits after that only add `verification.md` and archive the change. The app and the class library are not changed by this change at any point.

## Checks

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 16 passed, 0 failed (16 items)` before the archive and SEE-ARCHIVE after it |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 404`, `# pass 404`, `# fail 0` |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:   318, Skipped:     0, Total:   318` (`Parity.Tests`) and `Passed: 13` (`Parity.Hosted.Tests`) |
| `npm run contracts:check` | `Generated contracts are up to date (14 files).` |
| `npm run contracts:test` | `# pass 9`, `# fail 0` |

## Fixture-tested scope (unit tests, no desktop)

- Contracts and case loading (task 1.1): `parity-cases.schema.json` adds `setValue`, `click`, `selectItem`, `contextMenu` and `saveReload` with the fields `control`, `value` and `item`, and `parity-capture-timing.schema.json` their operations; the example gains a scenario using all five and round-trips through the generated zod schema (`contracts:test`) and the generated C# types (`ContractRoundTripTests`). `CaseFileLoaderTests`: the five actions map to their records with their descriptions (`setValue:txtCharacterName=`, `click:cmdAddGear`, `selectItem:lstGear=Commlink`, `contextMenu:treGear=Add as Plugin`, `saveReload`), all required; ten cases of a missing or extra field fail with the location and the field (`'setValue' requires 'value'`, `'click' does not take 'item'`, `'saveReload' does not take 'optional'`, `'capture' does not take 'control'` and others). `TimingTests`: every timing operation has a report order. The sealed diagnosis and discovery contexts keep the new fields (`context.test.ts`: a scenario with all five actions seals and reads back).
- Active window and calls (task 2.1): `ActiveWindowTests` on a fake window graph: an enabled main window is active even when it owns a window; a disabled main window gives its topmost owned window; a dialog disabled by its own dialog is followed to that one; a disabled window that shows no owned window yet gives none, and so does a cycle. `DialogSafeCallerTests`: a call that returns is done and reports that it returned; its exception is rethrown unchanged; a call that opens a window is done while it runs, reports that it did not return, and is kept while the window is open; a call that neither returns nor opens a window times out with the action's description; a window that is none does not count as a change; a kept call is awaited once the window it started from is active again and its failure is raised once, and one that does not return within 10 s after that fails.
- Actions in the side (task 2.2): `SideExecutorTests`: the new actions reach the session in order and are performed; a failed one fails with its reason and the rest of the side is `not-run`.
- The checks of each action (task 2.2), `ControlActionsTests` on fake controls behind `IControlAccess`: `setValue` focuses, sets, leaves with Tab and lets the app settle; a value the control already holds fails without touching it (`already holds '5'`); a value a control clamps fails with what it holds (`holds '99' after it was set to '150'`); a call that opens a dialog is not followed by Tab; an unknown control fails with the finder's message. `click` presses and settles, and a control that can be neither invoked nor toggled fails without settling; a press that throws fails with its own message. `selectItem` selects; an item selected already fails without selecting, one not selected afterwards fails, a missing one fails with the finder's message. `contextMenu` invokes the item and leaves the menu; a menu without the item, or with the item but no way to invoke it, is closed and the failure names the menu's items (or says it has none). A `tooltips_class32` window and a `WindowsForms10.tooltips_class32.app.*` window are tooltips, a WinForms window is not (`ActiveWindowTests`).
- Save and reload (task 2.3): `StagingTests`: a case with `saveReload` gets `characters/<case>/canonical/<file>` and `characters/<case>/candidate/<file>`, both copies of the fixture, while another case keeps one shared copy. `CharacterSaverTests` with a fake save command and real files: a write after the command is waited for and the app awaited once; no write within the time fails with `did not write character.chum` and the app is not awaited; a file still open after the write is waited for until it is closed, with a time of its own (a slow message round trip does not use it up); one open past that time fails with a message that names the file and the wait. `SaveReloaderTests`: the character is saved and the app asked to close; an open dialog fails before anything is saved or closed and names the dialog; an app that does not exit fails and names its active window.
- Proofs (task 3.1), `inventory-manifest.test.ts`: a `setValue` on a text box that the capture before it showed (with a `waitFor` between) proves its `TextChanged` binding, with the case, the capture, the action and its index, and leaves `Leave` unexercised; a `click` that follows another action proves nothing, one that follows a capture through a `wait` proves `Click`; an action without a capture before it, on a control the capture did not show, after `contextMenu` or after `saveReload` proves nothing; a control that two classes of the capture declare proves nothing; a `saveReload` between two captures leaves a page change with a `selectTab` without a tab proof. The tab proof tests of the inventory pass unchanged.
- Rich scenario file (task 3.2): `CaseFileLoaderTests` loads `parity/cases/rich-scenarios.json` against its fixtures: the six cases, the suite's startup delay and settle time, the two saving cases, all four acting action types, and a capture before every `setValue`, `click` and `selectItem` with only `wait` and `waitFor` between.

## Live evidence

All live runs used the sourcebook overlay `--settings-overlay out/overlays/fixture-books` (a copy of `bin/settings/default.xml` with the books `AGENTS.md` lists). The SHA-256 of `bin/ChummerGenSR4.exe` was `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before and after every run: each capture run printed it before and after (every value in the logs is this one), and `Get-FileHash` printed it before the first run and after the last. Every run used the candidate with SHA-256 `97550ebb27bb60356d9d458f9f8f41ab51d838a653be870a8ca01285efbee8e4`, built from this change's `Chummer/` and `Core/`, which it does not change. The capture runner's assemblies are new, so every canonical side of the runs below missed the shared cache and ran live (`canonical side live` for every case); each completed side was stored.

### Rich scenarios (task 4.1)

`npm start -- --case-file parity/cases/rich-scenarios.json --settings-overlay out/overlays/fixture-books --canonical-cache <shared cache outside the repository> --no-diagnosis` started thread `wf-20261004T040326Z-58f389bc`: `Thread wf-20261004T040326Z-58f389bc finished: exit 1.`, 4.8 min.

Execution, per case (each line `capture <status> ... coverage valid (contiguous, 0 failures, 0 optional absent); canonical side live`):

| Case | Run | Actions per side | Capture status | Coverage |
|---|---|---|---|---|
| `build-Diego_v_alpha2_by_bessgeor@edit-name` | `20261004T040329Z-21ff8e5b` | 5 | 0 | valid, 2 of 2 captures on both sides |
| `build-Diego_v_alpha2_by_bessgeor@raise-body` | `20261004T040405Z-e757fbea` | 3 | 0 | valid, 2 of 2 |
| `build-Diego_v_alpha2_by_bessgeor@add-gear` | `20261004T040440Z-8e6ccabd` | 14 | 1 | valid, 5 of 5 |
| `build-Diego_v_alpha2_by_bessgeor@plugin-menu` | `20261004T040528Z-3f470baf` | 11 | 1 | valid, 3 of 3 |
| `build-Diego_v_alpha2_by_bessgeor@save-reload` | `20261004T040616Z-77a006a6` | 8 | 0 | valid, 2 of 2 |
| `career-facemage_Sam_career@save-reload` | `20261004T040714Z-c60084e1` | 8 | 0 | valid, 2 of 2 |

Every action of both sides was performed: no failure, no optional absence, nothing skipped, filtered or not run. The timing samples show each new operation measured without failure: `setValue` 2 per run (medians 2.2 to 2.6 s), `click` 4 in `add-gear` (median 538 ms) and 2 in `plugin-menu`, `selectItem` 4 (median 526 ms) and 2, `contextMenu` 2 (median 2.5 s) and `saveReload` 2 per saving case (medians 9.0 s and 10.3 s, the second process's startup delay included).

What the actions did, as the captures show: the name box holds `Diego Parity` after `setValue`; `nudBOD` changed from 4 to 5; `click:cmdAddGear` opened the Select Gear dialog, which `select-gear`, `commlinks` and `commlink-selected` captured, with the category list showing `Commlink` and the gear list reduced to commlinks after `selectItem:cboCategory=Commlink`, and the details filled after `selectItem:lstGear=Hermes Ikon`; `click:cmdOK` closed it; the gear item's context menu opened with the context menu key and its `Add as Plugin` opened the dialog again (`select-plugin`), which `click:cmdCancel` closed; after `saveReload` a new process opened the saved file, and `reloaded` shows the name typed before the save (`Diego Saved`, and `Sam Saved` in career mode).

Visual results, apart from execution: 16 rows; 12 within the threshold; 4 failing, all with reason `visual-difference` and different sizes: the Select Gear dialog is 646x440 on the canonical side and 648x446 on the candidate side (`add-gear/select-gear`, `add-gear/commlinks`, `add-gear/commlink-selected`, `plugin-menu/select-plugin`). Every main-window capture, after the dialogs closed and after the reloads included, is within the threshold.

Comparer: every case `Completeness: complete` (planned 16 in total, reported 16, analysis failed 0, filtered 0, optional absent 0, execution lost 0, unaccounted 0); `edit-name`, `raise-body` and both `save-reload` cases `clear (exit 0)`, `add-gear` and `plugin-menu` `differences (exit 1)` with 0 discrepancies in 0 groups, since rows of different sizes get no pixel analysis. Triage: `0 discrepancies in 0 clusters (0 new), 4 other findings` (the four size mismatches). Outcome: `findings_remaining; 0 of 0 clusters fixed`. The exit status 1 is the visual differences.

### Interaction inventory of the rich scenarios

The same thread's inventory ran on the recorded trees: `Inventory: 69 classes (10 active), controls observed 312/1419, interactions exercised 9/873, tuples observed 16/16, unresolved 0`. The exercised bindings and their proofs:

| Binding | Proof (scenario / capture -> action) |
|---|---|
| `frmCreate.txtCharacterName.TextChanged` | `edit-name/character-info -> setValue:txtCharacterName=Diego Parity`; `save-reload/character-info -> setValue:txtCharacterName=Diego Saved` |
| `frmCareer.txtCharacterName.TextChanged` | `save-reload/character-info -> setValue:txtCharacterName=Sam Saved` |
| `frmCreate.nudBOD.ValueChanged` | `raise-body/common -> setValue:nudBOD=5` |
| `frmCreate.cmdAddGear.Click` | `add-gear/gear -> click:cmdAddGear` |
| `frmCreate.treGear.AfterSelect` | `plugin-menu/gear -> selectItem:treGear=Hermes Ikon` |
| `frmSelectGear.cboCategory.SelectedIndexChanged` | `add-gear/select-gear -> selectItem:cboCategory=Commlink` |
| `frmSelectGear.lstGear.SelectedIndexChanged` | `add-gear/commlinks -> selectItem:lstGear=Hermes Ikon` |
| `frmSelectGear.cmdOK.Click` | `add-gear/commlink-selected -> click:cmdOK` |
| `frmSelectGear.cmdCancel.Click` | `plugin-menu/select-plugin -> click:cmdCancel` |

`frmSelectGear`, which the scope declares active, has 29 of its 40 controls observed from the dialog captures' trees. Before it was declared active, the inventory of the same recorded trees read 9 active classes, 283 of 1379 controls observed and 5 of 857 interactions exercised: the five bindings of the character forms above.

### Failures of the actions on the real app

A case file outside the repository (`out/probes/e3/cases.json`, not part of the change) made each failure happen on both executables. `npm run parity -- --case-file out/probes/e3/cases.json --settings-overlay out/overlays/fixture-books --canonical-cache <shared cache>` ran six cases: run `20261004T035759Z-d6bb4f6d`, exit 2, `Coverage: INVALID; 12 sides, 52 actions, 12 failed`, every side failing at the probed action and no side not run; two further single-case runs with `--case`, `20261004T040203Z-c63f71a6` and `20261004T040244Z-c80c4b80`, also exit 2 with 2 failed sides each. The failure of each side, identical on the canonical and the candidate side:

| Probe | Failed action | Reason printed |
|---|---|---|
| `setValue` of the value the control already holds | `setValue:txtCharacterName=Probe Name` (second time) | `'txtCharacterName' already holds 'Probe Name', so setting it would change nothing.` |
| `setValue` beyond a numeric up-down's maximum | `setValue:nudBOD=999` | `'nudBOD' holds '6' after it was set to '999'.` |
| `setValue` on a control that does not exist | `setValue:nudNoSuchControl=5` | `No enabled control 'nudNoSuchControl' is on screen in window 'Chummer - [...Create New Character (Default Settings)]' after 5 s.` |
| `selectItem` of an item that is selected | `selectItem:treGear=Hermes Ikon` (second time) | `'Hermes Ikon' is already selected in 'treGear', so selecting it would change nothing.` |
| `contextMenu` without the item | `contextMenu:treGear=No Such Item` | `The context menu of 'treGear' has no item 'No Such Item' that can be invoked; it has 'Add as Plugin', 'Name Gear', 'Notes'.` |
| `click` on a label | `click:lblGearSource` | `'lblGearSource' can be neither invoked nor toggled.` |
| `saveReload` with a dialog open | `saveReload` after `click:cmdAddGear` | `The dialog 'Select Gear' is open; the character is saved from the character form.` |

The first probe file also held a `click` on `lblNuyen`, which is not on screen on the Gear tab, so that side failed with the finder's `No enabled control 'lblNuyen' is on screen` instead; the `click` row above is from the rerun with `lblGearSource`. That Escape closed the menu in the missing-item case is not observed: the side ends at the failure.

### Character suite with the changed runner

The capture runner resolves the active window for activation, `selectTab`, `waitFor`, captures and trees in every case, so the existing suite ran once on the final runner: `npm start -- --settings-overlay out/overlays/fixture-books --canonical-cache <shared cache outside the repository> --no-diagnosis`.

The run, thread `wf-20261004T041145Z-1403f881` (13 cases), did not finish. Two cases completed, both sides live (`0 hits, 1 misses, 1 stored` each):

| Case | Run | Execution | Visual |
|---|---|---|---|
| `build-Diego_v_alpha2_by_bessgeor` | `20261004T041148Z-a8aaef66` | status 0, coverage valid (92 actions, 0 failed, 13 of 16 planned captures on both sides, 3 optional absent) | 13 of 13 rows passed; comparer `clear (exit 0)`, `Completeness: complete` |
| `career-Шпала - карьера` | `20261004T041449Z-8d785bc1` | status 0, coverage valid (134 actions, 0 failed, 20 of 23 captures, 3 optional absent) | 20 of 20 rows passed; comparer `clear (exit 0)`, `Completeness: complete` |

The third case, `build-facemage_Sam`, failed as a setup error: `System.IO.IOException: There is not enough space on the disk.` while staging the candidate (run `20261004T041904Z-4aa7992b`, exit 3). The disk had room again later; resuming the thread then failed every case at startup with `window-activation: window ... was not in the foreground after 10 attempts 200 ms apart (foreground: none)` (run `20261004T070022Z-64e0ebe6` and the next ones), because the workstation was locked (the logon screen was showing); a single rich-scenarios case run on its own failed the same way (`20261004T074327Z-3ccb1b62`, exit 2). These are execution failures, not results: the remaining 11 cases have no run on the changed runner and are listed under Unverified. The two completed runs used the runner as of the commit that added the new unit tests; the commit after them only changes the message of the failure when the saved file stays open (the success path of `CharacterSaver` is the same), so the saving cases of the rich scenarios are not affected by it.

### Development runs (`npm run parity`, both sides live)

These runs found what the final code fixes; each failure is recorded as it happened.

- `20261004T015640Z-b2703d0a`, exit 3: `edit-name` and both `save-reload` cases completed on both sides; `raise-body` failed on both sides at `setValue:nudBOD=5` with `'nudBOD' has no editable value` (a numeric up-down shows only its two buttons in UI Automation's control view; its edit box is now taken from its child windows); `add-gear` performed the dialog actions and failed at `waitFor:Selected Gear` after `click:cmdOK` (the tree had scrolled its root out of view; the scenario now waits for `Add Gear`); `plugin-menu` failed with `No context menu of 'treGear' opened within 5 s`; the run then ended as a setup error: `The timing has no report order for the operation SetValue` (now ordered and tested).
- `20261004T020325Z-50060ae3`, exit 2: `raise-body` and `add-gear` complete on both sides; `plugin-menu` still failed, the app's top-level elements in UI Automation being only a `SysShadow` pane and the main window.
- `20261004T020609Z-a2738f20`, exit 2: the same failure with the context menu key instead of a posted `WM_CONTEXTMENU`.
- `20261004T020724Z-9264c1ad`, exit 1: with the menu found in the process's window list, `plugin-menu` completed on both sides (coverage valid); `select-plugin` differed in size as above.
- `20261004T022857Z-e1c292cc`, exit 1, with the app awaited by a message round trip, nested dialogs followed and calls awaited once their dialog had closed: all six cases completed on both sides, coverage valid, 98 actions, 16 of 16 captures; the same 4 dialog rows differed in size, 12 rows within the threshold.

## Unverified

- A deliberate kill and resume of a thread on the final source: none was made. Thread `wf-20261004T041145Z-1403f881` was resumed once, after a setup error (disk full), and that resume failed every case at startup because the workstation was locked, so a resumed run is not observed to finish either.
- The acceptance of the changed runner rests on the two suite cases above and the six rich scenarios; the other 11 suite cases have no run on it, and the change does not claim them.
- The character suite on the changed runner: 2 of 13 cases ran (see above); the other 11 cases have no run, so that the active-window resolution leaves their captures unchanged is shown for those two cases only.

- Nested dialogs (a message box over a dialog) and a `contextMenu` on a dialog's control: the owned-window walk is unit-tested only; no scenario opens a second dialog over the first.
- A save that writes nothing, a save whose file stays open, and an app that asks a question instead of exiting after a save: unit-tested with a fake save command and a fake process only; no live probe made them happen, since the app writes its file and exits in every case tried. That Escape closes a context menu that lacks the item is not observed either, since the side ends at the failure.
- The UI Automation implementations behind the action interfaces (UiaControlAccess, UiaValueBox, UiaSelectableItem, UiaContextMenu) and the Ctrl+S save command are exercised only by the live runs; the unit tests use fakes.
- A kept call that fails after its dialog closes: unit-tested in `DialogSafeCallerTests` only; in the live runs every kept call returned.
- The dialog size difference between the canonical and the candidate executable was not diagnosed: the runs ended after triage (`--no-diagnosis`), and the comparer does not analyze rows of different sizes, so it is a triage finding without a cluster.
- No discovery thread used the rich scenario file or proposed the new actions; discovery plans keep their four action types.
- No quota wait occurred: these runs started no model job.
