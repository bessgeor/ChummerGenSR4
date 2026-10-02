# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The checks and the live evidence were collected on the final source, commit `642d511`: `git rev-parse HEAD:Chummer` prints `9bc396ee7e23a3ac4b5724a0fbf46a2d779d5079`, `HEAD:Core` prints `b59848cc0dc9357c08032c693bc23bdc2f3e58db`, `HEAD:parity` prints `404ce3b85b96dd897513ce65e920eccc504cc7a7` and `HEAD:workflow` prints `73b3de341cb8d0b0516d841e337e29b553547896`. The commit that records the evidence and the archive commit after it change only `openspec/`, which no build, test or capture reads.

## Checks

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 14 passed, 0 failed (14 items)` (before the archive; see Archive) |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 312`, `# pass 312`, `# fail 0` |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:   206, Skipped:     0, Total:   206` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |

## Fixture-tested scope (builds, metadata, git and unit tests, no desktop)

Every build went through `parity/scripts/build-candidate.mjs`, which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time.

- Stacked focus (task 1.1): the candidate built after `496a405`. Its diff removes from `Chummer/clsUnique.cs` the 223 lines of `StackedFocus` and the blank line after it, and adds `Chummer/StackedFocus.cs` with 230 lines: the same 223 lines (compared byte for byte by the script that made the commit) after the BOM, three `using` lines and a blank line, inside the namespace's three lines.
- Interfaces (task 1.2): after `97b4036` (`ICharacter` with `ICharacterCyberware` and `ICharacterGear`, `ITreeNodeView`, `CharacterBuildMethod` in its own file, the implementations on `Character`, `Cyberware` and `Gear`, and `TreeNodeView`) the candidate built, printing `Core -> …\ChummerGenSR4.Core.dll` and `Chummer -> …\ChummerGenSR4.exe` with no error.
- In place (task 1.3): the candidate built after `7009fec`. The search on that commit's `Chummer/clsUnique.cs`:

  ```powershell
  Select-String -Path Chummer/clsUnique.cs -Pattern '\bTreeNode\b|\bWeapon\b|\bColor\b|SystemColors|(?<!I)\bCharacter\b|\bCyberware\b|\bGear\b|System\.Windows|System\.Drawing'
  ```

  printed no `using` line and no type name besides `ICharacterCyberware` and `ICharacterGear` in the three cyberlimb loops and the skillsoft loop, whose other matches are the member names `_objCharacter.Cyberware` and `_objCharacter.Gear`. Every other match is in a comment or documentation (`/// <param name="objNode">TreeNode to populate a TreeView.</param>`, `// More than one Weapon can be added`, `//TreeNode objNode = new TreeNode();`) or in a string (`"/chummer/weapons/weapon[...]"`).
- Move (task 1.4): `git show -M90% --name-status b750986` prints `R100 Chummer/CharacterBuildMethod.cs Core/CharacterBuildMethod.cs`, `R100 Chummer/ICharacter.cs Core/ICharacter.cs`, `R100 Chummer/ITreeNodeView.cs Core/ITreeNodeView.cs` and `R100 Chummer/clsUnique.cs Core/UniqueModels.cs`, and nothing else. The moved and added files are stored with CRLF (`git ls-files --eol` prints `i/crlf` for each of them and for `Chummer/StackedFocus.cs`, `Chummer/TreeNodeView.cs`, `Chummer/TreeNodeCreation.cs` and `Chummer/ContactColour.cs`), and `Core/UniqueModels.cs` keeps its BOM. The candidate built.
- Types (task 1.4): the type definitions of the executable and the library of the candidate were compared with those of a build of the source before this change (`51206d1`, its `Chummer/` and `Core/` taken with `git archive --format=zip` into a scratch folder), listed from the assemblies' metadata with this function (saved as `types.ps1`):

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
  node parity/scripts/build-candidate.mjs --source <scratch>/baseline-src --output <scratch>/baseline --log <scratch>/baseline.log
  node parity/scripts/build-candidate.mjs --output <scratch>/candidate --log <scratch>/candidate.log
  . ./types.ps1
  Compare-Object (((Get-Types <scratch>/baseline/bin/ChummerGenSR4.exe) + (Get-Types <scratch>/baseline/bin/ChummerGenSR4.Core.dll)) | Sort-Object) (((Get-Types <scratch>/candidate/bin/ChummerGenSR4.exe) + (Get-Types <scratch>/candidate/bin/ChummerGenSR4.Core.dll)) | Sort-Object)
  ```

  The baseline has 203 type definitions (175 in the executable, 28 in the library) and the candidate 211 (155 in the executable, 56 in the library). The comparison printed these differences and no other (`<=` baseline, `=>` candidate):
  - `Chummer.Character` `methods=274` to `276` (the getters of the explicit `ICharacter.Cyberware` and `ICharacter.Gear`), the same 126 fields; `Chummer.Gear` `methods=102` to `103` (the getter of `ICharacterGear.Children`), the same 44 fields;
  - new: `ICharacter` (20 methods), `ICharacterCyberware` (5), `ICharacterGear` (6), `ITreeNodeView` (5), `TreeNodeView` (6 methods, 1 field), `TreeNodeCreation` (9) with the compiler's closure class of the quality's weapon function (`TreeNodeCreation+<>c__DisplayClass0_0`), and `ContactColour` (2).

  Every moved type (`Attribute`, `QualityType`, `QualitySource`, `Quality`, `SkillGroup`, `Skill`, `SpiritType`, `Spirit`, `Spell`, `Focus`, `Metamagic`, `Power`, `TechProgram`, `TechProgramOption`, `MartialArt`, `MartialArtAdvantage`, `MartialArtManeuver`, `ContactType`, `Contact`, `CritterPower`, `InitiationGrade`, `CalendarWeek`, `MentorSpirit`), `CharacterBuildMethod` and the four interfaces are in the library's list and not in the executable's; `StackedFocus` is in the executable's only. The moved types print the same method and field counts as before (the contact's colour property and field were replaced one for one). The only type names defined in both assemblies of the candidate are the compiler's `<Module>` and `<PrivateImplementationDetails>`. The library's assembly references are `mscorlib`, `System.Xml` and `System.Core`.
- Items without the application (task 1.5): `UniqueModelsTests` in `parity/tests/Parity.Tests` (9 tests, part of the 206) run moved items with a test character (`Fakes/TestItemCharacter`, whose members a test does not set throw) and test cyberware (`Fakes/TestCyberware`), and no host registered: a new contact has no colour, saves `0` as its colour and loads it as the ARGB value 0; a contact with the colour `0xFF336699` saves `-13408615` and loads the same value; a contact whose save data has no colour loads with none; a cyberlimb in a limb slot makes `BOD`, `AGI` and `STR` report modifiers and not `LOG`; a cyberlimb without a limb slot and bodyware in a slot make `BOD` report none; and an attribute adds up the minimum and maximum modifiers of its enabled improvements times their rating (3 and 5), leaving out a disabled one and another attribute's. Run once with the contact saving `_intColour.ToString()` instead of `(_intColour ?? 0).ToString()`, the test of the contact without a colour failed (1 of 206); with the committed code all pass.

## Live evidence

### Whole suite with diagnosis, repair and widening

Command: `npm.cmd start -- --settings-overlay <overlay> --fix-changes --live-canonical`, run from the worktree of the final source, with `settings/default.xml` of the overlay holding the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). `Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before the run, after the run and after the narrow re-run below, and every capture runner call printed the same hash as `Canonical SHA-256 before` and `after` (the staged copy too). The candidate built by the workflow had `ChummerGenSR4.exe` SHA-256 `0168050788a6af40548b20ff9c9a8cd4142f9d617cb646615d31c45767bd3c61` and `ChummerGenSR4.Core.dll` SHA-256 `238a1dde1824b7ebfbf10c935aba1497200f21131a90c62edcaa462c40ff0889`.

Thread `wf-20261002T173132Z-f06dc73d`, all 13 cases. The canonical cache was off (`canonical cache off (--live-canonical)`): both executables ran live in every case.

Kill and resume: during the canonical capture of the second case (run folder `20261002T173406Z-53247e9a`, left without a summary), the run's process tree was ended with `taskkill /PID <cmd> /T /F`, which terminated the workflow, the capture runner and both app processes. `npm.cmd start -- --resume wf-20261002T173132Z-f06dc73d` printed `Resuming thread wf-20261002T173132Z-f06dc73d.` and `Taking over the desktop lane from process 28936, which is no longer running.`, kept the first case's recorded capture and compare, and captured the second case again in `20261002T173556Z-04b4b9fc`.

Execution, per case (capture status; coverage; both sides live):

| Case | Run folder | Capture | Coverage |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261002T173137Z-5f3669d1` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Шпала - карьера | `20261002T173556Z-04b4b9fc` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-facemage_Sam | `20261002T173927Z-7ebc48c0` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-facemage_Sam_career | `20261002T174214Z-1a0967a3` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-rigger | `20261002T174539Z-9e85fdbb` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-rigger_career | `20261002T174819Z-7b1d4256` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-hacker4boegspriet | `20261002T175129Z-1696877e` | **2** | **invalid**: candidate action 4 (`selectTab:Martial Arts`) failed with `TimeoutException: Tab 'Martial Arts' was not selected within 5 s. MSAA state=3145728, native current index=1, expected index=2`, 41 candidate actions not run; canonical side complete; 3 optional absent |
| build-technotest | `20261002T175331Z-eb3ba370` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-technotest - career | `20261002T175553Z-13f95023` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| career-test_adept | `20261002T175855Z-92f54fa3` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| build-spirit | `20261002T180154Z-7260a919` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| build-Skull Carver - precareer | `20261002T180422Z-cfa13076` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Skull Carver - career | `20261002T180703Z-4334b453` | 0 | valid, contiguous, 0 failures, 8 optional absent |

Visual, per case (compare report and completeness; 0 analysis-failed, 0 filtered and 0 unaccounted in every case):

| Case | Compare | Rows passed / failed | Planned / reported / optional absent / execution lost |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-Шпала - карьера | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |
| build-facemage_Sam | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| career-facemage_Sam_career | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |
| build-rigger | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| career-rigger_career | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |
| build-hacker4boegspriet | **1, differences**: 5 discrepancies in 5 groups | 0 / 2 (`common` 0.000147, `skills` 0.000115) | 16 / 2 / 0 / 14 |
| build-technotest | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-technotest - career | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |
| career-test_adept | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |
| build-spirit | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| build-Skull Carver - precareer | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-Skull Carver - career | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |

The five discrepancies of `build-hacker4boegspriet` are all on the candidate's side of the two captures taken before the failed action: the menu bar shows the keyboard access-key underlines (`File`, `Edit`, `Tools`, `Special`, `Window`, `Help`, group 1 at 35,40 with 250x84 pixels in `common` and 250x2 in `skills`) and small underlines of 7x2 and 6x2 pixels in the contact list and the skill list (groups 2 and 3 of `common`, group 2 of `skills`). Windows draws these underlines once a window has received keyboard input, so they show the window's keyboard cue state, not its content.

Triage found 5 discrepancies in 5 clusters (`d-0421e052ad1d3d83`, `d-737902cd4f70b007`, `d-14ad2bf53120a927` from `common`, `d-5df860cb794f343d`, `d-a128c08784ccfc89` from `skills`, all of `build-hacker4boegspriet`) and 14 other findings, the execution-lost captures of that case. Diagnosis took a source snapshot of 391 files at `642d5110a2f1` and started a hypothesis job per cluster on Claude; each failed as `infra` with `claude exited with null without a result: spawn claude ENOENT`, because the Claude Code CLI is not installed on this machine, and the thread stopped with a setup error (`Thread wf-20261002T173132Z-f06dc73d stopped; resume it with: npm start -- --resume wf-20261002T173132Z-f06dc73d`). No challenge, check capture, repair or widening ran, the thread did not conclude, and no `outcome.json` was written; it was not resumed, since a resumed thread keeps the agent settings it started with and the CLI is still missing.

### Finding: nondeterministic failure of one case, re-run once

The failed case was re-run once on its own to classify it: `npm.cmd start -- --case build-hacker4boegspriet --settings-overlay <overlay> --live-canonical --no-diagnosis`, thread `wf-20261002T181121Z-7013faf6`, the same candidate (`ChummerGenSR4.exe` SHA-256 `0168050788a6af40548b20ff9c9a8cd4142f9d617cb646615d31c45767bd3c61`), both sides live.

- Execution: run folder `20261002T181124Z-6403956d`, capture status 0; coverage valid, contiguous, 92 actions, 0 failures, 0 not run, 6 optional absent, 12 skipped optional; the candidate performed 37 actions with 3 optional absent and 6 skipped optional.
- Visual: compare status 0, clear; 13 rows passed, 0 failed, 0 discrepancies in 0 groups; completeness 16 planned, 13 reported, 3 optional absent, 0 analysis-failed, 0 filtered, 0 execution-lost, 0 unaccounted.
- Thread: `Triage: 0 discrepancies in 0 clusters (0 new), 0 other findings`, `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 2.7 min`, exit 0.

The case's candidate captured every window without a difference when run again on the same build, so the failure of the full run is classified as nondeterministic: keyboard input reached the candidate's window during that capture (the access-key underlines), and the tab selection that followed timed out. It is recorded as a failure of that run, not as a pass. Since the case shows no difference on this build, no regression of the move was found, no fix change was archived and no benchmark item was added.

## Archive

The archive is the last commit of the change.

## Unverified

- The workflow's diagnosis, repair and widening did not run on a cluster: in the full run, diagnosis stopped with a setup error because the Claude Code CLI is not installed on this machine, and the full thread did not conclude. The clusters it had found came from the nondeterministic failure above; no regression was provoked on purpose.
- The full suite has no run in which all 13 cases completed: `build-hacker4boegspriet` completed only in the narrow re-run, and the other 12 only in the full run.
- No case creates an item: the cases open saved characters, so no `Create` method, no extension method of `TreeNodeCreation`, no `TreeNodeView` and no weapon function of a quality ran live, and the grey colour and tag of a new item's tree node are covered only by reading the code. No case changes a contact's colour, so `ContactColour.SetColour` and the colour window did not run live; loading and drawing contacts did, in the captures of the cases with contacts.
- The unit tests cover only what runs without an application host (a contact's save data, an attribute's modifiers); display names, prints, costs and the skillsoft rating of a skill read the language or the options and are covered only by the live captures of the cases' windows; no case prints a character.
- The unit tests run the library on .NET (the test project's runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths they exercise use no framework-specific behaviour.
- No quota wait was observed: no model job got a response.
- The Debug configuration and Visual Studio's form designer were not tried.
