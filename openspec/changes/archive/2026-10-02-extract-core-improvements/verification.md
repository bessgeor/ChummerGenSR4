# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The checks and the live evidence were collected on the final source: its `Chummer/`, `Core/`, `parity/` and `workflow/` trees are those of the last commit before this record (`git rev-parse HEAD:Chummer` prints `621ef1d5b55df50338bdc1e709e0d1998f5157a6`, `HEAD:Core` prints `cd8231ab75222f6518051fef70f0c9a7b0e19852`, `HEAD:parity` prints `b453af98718e60b25ea90541c5e481ba086e5855` and `HEAD:workflow` prints `73b3de341cb8d0b0516d841e337e29b553547896`). The commit that records the evidence and the archive commit after it change only `openspec/`, which no build, test or capture reads.

## Checks

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 14 passed, 0 failed (14 items)` (before the archive; see Archive) |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 312`, `# pass 312`, `# fail 0` |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:   197, Skipped:     0, Total:   197` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |

## Fixture-tested scope (builds, metadata, git and unit tests, no desktop)

Every build went through `parity/scripts/build-candidate.mjs`, which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time.

- Interfaces (task 1.1): after adding `IImprovementCharacter` with its three views, `IImprovementDialogs` with `MentorSpiritSelection`, `WinFormsImprovementDialogs`, the implementations on `Character`, `Attribute`, `Skill` and `Weapon` and `Character.ConvertAdapsinGrades`, `npm run build:candidate` printed `Core -> …\ChummerGenSR4.Core.dll` and `Chummer -> …\ChummerGenSR4.exe` with no error.
- In place (task 1.2): the candidate built after the manager was routed through the interfaces. The search, on the in-place commit of `Chummer/clsImprovement.cs` (`8b71c3c`):

  ```powershell
  git show 8b71c3c:Chummer/clsImprovement.cs | Select-String -Pattern 'frm[A-Za-z]+|DialogResult|Opacity|MessageBox|\bCharacter\b|\bSkill\b|\bWeapon\b|Cyberware|GradeList|System\.Windows'
  git show 8b71c3c:Chummer/clsImprovement.cs | Select-String -Pattern 'WinForms'
  ```

  The first printed no form name, no `DialogResult`, `Opacity`, `MessageBox` or `GradeList`, and no `System.Windows` besides line 4, `using System.Windows.Forms;`; its other matches are enumeration members and strings (`Skill = 0`, `Cyberware = 3`, `"Exotic Melee Weapon"`, `ImprovementType.CyberwareEssCost`) and words in comments and documentation. The second printed only the constructor's `new WinFormsImprovementDialogs()`.
- Move (task 1.3): `git show -M90% --name-status` of the move commit prints `R097 Chummer/clsImprovement.cs Core/Improvement.cs`, `R100 Chummer/IImprovementDialogs.cs Core/IImprovementDialogs.cs` and `R100 Chummer/IImprovementCharacter.cs Core/IImprovementCharacter.cs`, beside the modified `Core/IApplicationHost.cs`, `Chummer/WinFormsApplicationHost.cs` and the host test. Besides the renames, `Core/Improvement.cs` changes only in its `using System.Windows.Forms;` line and the constructor that now takes `ApplicationHost.Current.ImprovementDialogs`. The moved and added files are stored with CRLF (`git ls-files --eol` prints `i/crlf` for `Core/Improvement.cs`, `Core/IImprovementCharacter.cs`, `Core/IImprovementDialogs.cs` and `Chummer/WinFormsImprovementDialogs.cs`), and `Core/Improvement.cs` keeps its BOM. The candidate built.
- Culture of expression results (task 1.4): the commit after the move gives `Core/Improvement.cs` a `using System.Globalization;` line, a static `en-US` culture, and `Convert.ToDecimal(Convert.ToString(nav.Evaluate(xprValue), _objCultureInfo), _objCultureInfo)` in place of `Convert.ToDecimal(nav.Evaluate(xprValue).ToString(), GlobalOptions.Instance.CultureInfo)`; it also adds one sentence to the documentation of `IImprovementDialogs`. It is the one deliberate change of behaviour: the result of an expression was formatted in the culture of the thread and read as `en-US`, so where the decimal separator is a comma `1,5` was read as 15. The capture machine uses `en-US`, where both give the same value.
- Types (task 1.3): the type definitions of the executable and the library of the candidate were compared with those of a build of the source before this change (`330eeca`, its `Chummer/` and `Core/` taken with `git archive` into a folder under `out/`), listed from the assemblies' metadata with this function (saved as `types.ps1`):

  ```powershell
  function Get-Types($path) {
    $pe = [System.Reflection.PortableExecutable.PEReader]::new([IO.File]::OpenRead($path))
    $md = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)
    foreach ($h in $md.TypeDefinitions) {
      $t = $md.GetTypeDefinition($h); $name = $md.GetString($t.Name)
      for ($d = $t.GetDeclaringType(); -not $d.IsNil; $d = $outer.GetDeclaringType()) { $outer = $md.GetTypeDefinition($d); $name = $md.GetString($outer.Name) + '+' + $name }
      "{0}.{1} methods={2} fields={3}" -f $md.GetString($t.Namespace), $name, $t.GetMethods().Count, $t.GetFields().Count
    }
  }
  ```

  ```powershell
  git archive 330eeca Chummer Core | tar -x -C out/d3r/baseline-src
  node parity/scripts/build-candidate.mjs --source out/d3r/baseline-src --output out/d3r/baseline --log out/d3r/baseline.log
  node parity/scripts/build-candidate.mjs --output out/d3r/candidate --log out/d3r/candidate.log
  . out/d3r/types.ps1
  $base = (Get-Types out/d3r/baseline/bin/ChummerGenSR4.exe) + (Get-Types out/d3r/baseline/bin/ChummerGenSR4.Core.dll)
  $exe = Get-Types out/d3r/candidate/bin/ChummerGenSR4.exe; $core = Get-Types out/d3r/candidate/bin/ChummerGenSR4.Core.dll
  Compare-Object ($base | Sort-Object) (($exe + $core) | Sort-Object)
  ```

  The baseline has 196 type definitions and the candidate 203 (175 in the executable, 28 in the library). The comparison printed these differences and no other (`<=` baseline, `=>` candidate):
  - `Chummer.Character` `methods=270` to `274` (the three explicit interface members and `ConvertAdapsinGrades`), the same 126 fields; `Chummer.IApplicationHost` `methods=6` to `7` (the getter of `ImprovementDialogs`); `Chummer.WinFormsApplicationHost` `methods=7 fields=1` to `methods=8 fields=2`; `Chummer.ImprovementManager` `methods=13 fields=5` to `methods=15 fields=7` (the second constructor and the static constructor, the dialogs and the culture);
  - new: `IImprovementCharacter` (32 methods), `IImprovementAttribute`, `IImprovementSkill`, `IImprovementWeapon`, `IImprovementDialogs` (11), `MentorSpiritSelection` and `WinFormsImprovementDialogs`.

  `Improvement`, `Improvement+ImprovementType` (90 fields) and `Improvement+ImprovementSource` (29 fields) print equal on both sides, and a filter of the candidate's executable for `Improvement` finds only `frmCreateImprovement` (which the baseline also has) and `WinFormsImprovementDialogs`, while the library's list holds `Improvement`, both enumerations and `ImprovementManager`. The only type names defined in both assemblies of the candidate are the compiler's `<Module>` and `<PrivateImplementationDetails>`. The library's assembly references are `mscorlib`, `System.Xml` and `System.Core`.
- Manager without the application (task 1.5): `ImprovementManagerTests` in `parity/tests/Parity.Tests` (11 tests, part of the 197) run the moved manager through its second constructor with a test character, test skills and attributes and test dialogs (in `Fakes/`) that record their calls, and no host registered: a selected text becomes a `Text` improvement with `SelectedValue` set and the friendly name defaulting to the source name; a selection cancelled after `MAG` and the Adept tab were enabled returns `false` and leaves no improvement and both flags off; removing one of two sources that enable `MAG` keeps it, removing the second disables it; a forced skill reaches the dialog with the bonus's skill group filter and gives a `Skill` improvement of value 2; removing the last Adapsin improvement converts the grades once (the test character counts only enabled Adapsin improvements, as the app's character does); `ValueOf` adds plain values, takes the highest of a unique name and leaves out disabled improvements and other types; `Rating + BOD` with rating 3 and `BOD` 4 gives 7 and `Rating div 2` gives 1, which read the attributes and format and parse the decimal result; `Rating div 2` also gives 1 on a thread whose culture is `ru-RU` and on one whose culture is `de-DE`; and a manager without dialogs is refused with an `ArgumentNullException`. Run once with the expression result formatted as before (`nav.Evaluate(xprValue).ToString()`) the two culture tests failed (2 of 11), and with the fix they pass (11 of 11); run once with `GlobalOptions.Instance.CultureInfo` in the parse the two value tests failed with a `TypeInitializationException` from `GlobalOptions`, because no host is registered.

## Live evidence

### Whole suite with diagnosis, repair and widening

Command: `npm.cmd start -- --settings-overlay <overlay> --fix-changes --live-canonical`, run from a checkout of the final source, with `settings/default.xml` of the overlay holding the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). `Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before the run and after it, and every capture runner call printed the same hash as `Canonical SHA-256 before` and `after` (the staged copy too). The candidate built by the workflow had `ChummerGenSR4.exe` SHA-256 `ee918813f97df45d06caf5b381c574d300806ec5a3fc1f75a8215ff11c3bfddf` and `ChummerGenSR4.Core.dll` SHA-256 `d04c3e674eb8caf05cca50fd0016f03cfb46b3ea64371e44418eaa100be50c2`.

Thread `wf-20261002T161848Z-b86a6655`, all 13 cases, exit 0, `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 37.7 min`.

The canonical cache was off (`canonical cache off (--live-canonical)`): both executables ran live in every case. No model job ran, since there was no discrepancy to diagnose, so no quota wait occurred.

Execution, per case (capture status; coverage; both sides live):

| Case | Run folder | Capture | Coverage |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261002T161853Z-79149360` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Шпала - карьера | `20261002T162122Z-db20beda` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-facemage_Sam | `20261002T162453Z-a29936f6` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-facemage_Sam_career | `20261002T162740Z-f1e5b37c` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-rigger | `20261002T163104Z-8d3c42af` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-rigger_career | `20261002T163344Z-78bf2270` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-hacker4boegspriet | `20261002T163655Z-19134096` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-technotest | `20261002T163936Z-cb24c032` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-technotest - career | `20261002T164157Z-35456c14` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| career-test_adept | `20261002T164459Z-2507c1c0` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| build-spirit | `20261002T164757Z-2850834e` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| build-Skull Carver - precareer | `20261002T165026Z-61cc9487` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Skull Carver - career | `20261002T165307Z-644eb790` | 0 | valid, contiguous, 0 failures, 8 optional absent |

Visual, per case (compare status 0, `clear`, 0 discrepancies in 0 groups for every case; completeness `complete` with 0 analysis-failed, 0 filtered, 0 execution-lost, 0 unaccounted):

| Case | Rows passed / failed | Planned / reported / optional absent |
|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | 13 / 0 | 16 / 13 / 3 |
| career-Шпала - карьера | 20 / 0 | 23 / 20 / 3 |
| build-facemage_Sam | 14 / 0 | 16 / 14 / 2 |
| career-facemage_Sam_career | 20 / 0 | 23 / 20 / 3 |
| build-rigger | 14 / 0 | 16 / 14 / 2 |
| career-rigger_career | 20 / 0 | 23 / 20 / 3 |
| build-hacker4boegspriet | 13 / 0 | 16 / 13 / 3 |
| build-technotest | 13 / 0 | 16 / 13 / 3 |
| career-technotest - career | 19 / 0 | 23 / 19 / 4 |
| career-test_adept | 19 / 0 | 23 / 19 / 4 |
| build-spirit | 14 / 0 | 16 / 14 / 2 |
| build-Skull Carver - precareer | 13 / 0 | 16 / 13 / 3 |
| career-Skull Carver - career | 19 / 0 | 23 / 19 / 4 |

Triage found 0 discrepancies in 0 clusters and 0 other findings, so diagnosis, repair and widening had nothing to do (`Diagnosis: 0 clusters`, `Repair: 0 clusters`, `Widening: 0 attempts, 0 promoted, 0 rejected; no accepted branch`). The move caused no regression in the captured windows, so no fix change was archived and no benchmark item was added.

### Deviation: no deliberate kill and resume

The run was to be ended once on purpose and resumed. The command that ends its process tree (`taskkill /T /F` on the workflow's process) was refused by the safety check of the shell the run was driven from, so no other way of ending it (Ctrl+C, stopping the process by its identifier) was tried, the run went through uninterrupted and was not resumed. The workflow's code is unchanged by this change (`HEAD:workflow` equals the tree of the change before it), so its resume behaviour is the one observed live there; it was not observed again here.

## Archive

The archive is the last commit of the change. `npx openspec archive extract-core-improvements --yes` printed `Specs updated successfully.` (`+ 1 added`, `~ 1 modified` in `openspec/specs/core-library/spec.md`) and `Change 'extract-core-improvements' archived as '2026-10-02-extract-core-improvements'.`; `npm run openspec:validate` then printed `Totals: 13 passed, 0 failed (13 items)`.

## Unverified

- No case opens a selection window: the cases open saved characters, whose improvements are read from the file, so `WinFormsImprovementDialogs` and the windows it configures (texts, forced values such as opacity 0, attribute list order, the side window's cancel check) did not run live. They are covered by reading the code against the former blocks and, on the manager's side, by the unit tests with test dialogs.
- No case adds or removes an item with a bonus, so the manager's creation and removal of improvements and the Adapsin grade conversion on the app's `Character` (`ConvertAdapsinGrades`, which only the test character stands in for) did not run live; the attribute arithmetic of `ValueToInt` is covered only through the unit tests' attributes, not through the app's `GetAttribute`.
- A deliberate kill and resume was not performed (see the deviation above), and no quota wait was observed: no model job ran.
- The workflow's diagnosis, repair and widening did not run on a cluster: the live run found no discrepancy, and no regression was provoked on purpose.
- The formatting of expression results in `en-US` changes a value only where the decimal separator is a comma, and the capture machine uses `en-US`: the change is shown only by the unit tests (on `ru-RU` and `de-DE` threads), not by the live run, and not by the app on a machine with such a culture.
- The unit tests run the library on .NET (the test project's runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths they exercise use no framework-specific behaviour.
- The Debug configuration and Visual Studio's form designer were not tried.
