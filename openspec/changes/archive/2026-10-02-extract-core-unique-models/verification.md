# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The checks were collected on the final source, commit `12bb9ab`: `git rev-parse HEAD:Chummer` prints `0101a3a3443989bae8476f7591f031db7fb21b25`, `HEAD:Core` prints `b59848cc0dc9357c08032c693bc23bdc2f3e58db`, `HEAD:parity` prints `15aa0d27872570cea5286cf3a60153efd53e3aee` and `HEAD:workflow` prints `73b3de341cb8d0b0516d841e337e29b553547896`. The live evidence was collected on a clean working tree whose `Chummer/`, `Core/` and `workflow/` files, and the capture tools in `parity/`, are those of this commit byte for byte (`HEAD:parity` also holds the tests, which no capture reads). The commit that records the evidence and the archive commit after it change only `openspec/`, which no build, test or capture reads.

## Checks

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 13 passed, 0 failed (13 items)` (after the archive; see Archive) |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 312`, `# pass 312`, `# fail 0` |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:   212, Skipped:     0, Total:   212` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |

## Fixture-tested scope (builds, metadata, git and unit tests, no desktop)

Every build went through `parity/scripts/build-candidate.mjs`, which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time.

- Stacked focus (task 1.1): the candidate built after `496a405`. Its diff removes from `Chummer/clsUnique.cs` the 223 lines of `StackedFocus` and the blank line after it, and adds `Chummer/StackedFocus.cs` with 230 lines: the same 223 lines (compared byte for byte by the script that made the commit) after the BOM, three `using` lines and a blank line, inside the namespace's three lines.
- Interfaces (task 1.2): after `97b4036` (`ICharacter` with `ICharacterCyberware` and `ICharacterGear`, `ITreeNodeView`, `CharacterBuildMethod` in its own file, the implementations on `Character`, `Cyberware` and `Gear`, and `TreeNodeView`) the candidate built, printing `Core -> …\ChummerGenSR4.Core.dll` and `Chummer -> …\ChummerGenSR4.exe` with no error.
- In place (task 1.3): the candidate built after `42de2c5`. The search on that commit's `Chummer/clsUnique.cs`:

  ```powershell
  Select-String -Path Chummer/clsUnique.cs -Pattern '\bTreeNode\b|\bWeapon\b|\bColor\b|SystemColors|(?<!I)\bCharacter\b|\bCyberware\b|\bGear\b|System\.Windows|System\.Drawing'
  ```

  printed no `using` line and no type name besides `ICharacterCyberware` and `ICharacterGear` in the three cyberlimb loops and the skillsoft loop, whose other matches are the member names `_objCharacter.Cyberware` and `_objCharacter.Gear`. Every other match is in a comment or documentation (`/// <param name="objNode">TreeNode to populate a TreeView.</param>`, `// More than one Weapon can be added`, `//TreeNode objNode = new TreeNode();`) or in a string (`"/chummer/weapons/weapon[...]"`). The same commit holds `Chummer/WeaponNodeFunction.cs`, which builds the quality's weapon function from a creation function, so that its grey node and lists run in the tests.
- Move (task 1.4): `git show -M90% --name-status c01b11f` prints `R100 Chummer/CharacterBuildMethod.cs Core/CharacterBuildMethod.cs`, `R100 Chummer/ICharacter.cs Core/ICharacter.cs`, `R100 Chummer/ITreeNodeView.cs Core/ITreeNodeView.cs` and `R100 Chummer/clsUnique.cs Core/UniqueModels.cs`, and nothing else. The moved and added files are stored with CRLF (`git ls-files --eol` prints `i/crlf` for each of them and for `Chummer/StackedFocus.cs`, `Chummer/TreeNodeView.cs`, `Chummer/TreeNodeCreation.cs`, `Chummer/ContactColour.cs` and `Chummer/WeaponNodeFunction.cs`), and `Core/UniqueModels.cs` keeps its BOM. The candidate built.
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

  The baseline has 203 type definitions (175 in the executable, 28 in the library) and the candidate 214 (158 in the executable, 56 in the library). The comparison printed these differences and no other (`<=` baseline, `=>` candidate):
  - `Chummer.Character` `methods=274` to `276` (the getters of the explicit `ICharacter.Cyberware` and `ICharacter.Gear`), the same 126 fields; `Chummer.Gear` `methods=102` to `103` (the getter of `ICharacterGear.Children`), the same 44 fields;
  - new: `ICharacter` (20 methods), `ICharacterCyberware` (5), `ICharacterGear` (6), `ITreeNodeView` (5), `TreeNodeView` (6 methods, 1 field), `TreeNodeCreation` (9) with the compiler's closure classes of the quality's weapon creation (`TreeNodeCreation+<>c` and `TreeNodeCreation+<>c__DisplayClass0_0`), `WeaponNodeFunction` (1) with its closure class (``WeaponNodeFunction+<>c__DisplayClass0_0`1``), and `ContactColour` (2).

  Every moved type (`Attribute`, `QualityType`, `QualitySource`, `Quality`, `SkillGroup`, `Skill`, `SpiritType`, `Spirit`, `Spell`, `Focus`, `Metamagic`, `Power`, `TechProgram`, `TechProgramOption`, `MartialArt`, `MartialArtAdvantage`, `MartialArtManeuver`, `ContactType`, `Contact`, `CritterPower`, `InitiationGrade`, `CalendarWeek`, `MentorSpirit`), `CharacterBuildMethod` and the four interfaces is in the library's list and not in the executable's (28 names, checked by a loop over both lists); `StackedFocus` is in the executable's only. The moved types print the same method and field counts as before (the contact's colour property and field were replaced one for one). The only type names defined in both assemblies of the candidate are the compiler's `<Module>` and `<PrivateImplementationDetails>`.
- Items without the application (task 1.5): `UniqueModelsTests` (9 tests) run moved items with a test character (`Fakes/TestItemCharacter`, whose members a test does not set throw) and test cyberware (`Fakes/TestCyberware`), and no host registered: a new contact has no colour, saves `0` as its colour and loads it as the ARGB value 0; a contact with the colour `0xFF336699` saves `-13408615` and loads the same value; a contact whose save data has no colour loads with none; a cyberlimb in a limb slot makes `BOD`, `AGI` and `STR` report modifiers and not `LOG`; a cyberlimb without a limb slot and bodyware in a slot make `BOD` report none; and an attribute adds up the minimum and maximum modifiers of its enabled improvements times their rating (3 and 5), leaving out a disabled one and another attribute's. Run once with the contact saving `_intColour.ToString()` instead of `(_intColour ?? 0).ToString()`, the test of the contact without a colour failed; with the committed code all pass.
- The app's adapters (task 1.5): `AppAdaptersTests` (6 tests) compile `Chummer/TreeNodeView.cs`, `Chummer/ContactColour.cs` and `Chummer/WeaponNodeFunction.cs` into the test project and run them with Windows Forms tree nodes and colours: a tree node view reads and sets the text and tag of its node and leaves the node's colour alone until asked, and then sets `SystemColors.GrayText`; a contact without a colour gives `Color.Empty`, a colour set on a contact comes back with the same ARGB value, and `Color.Empty` clears it to `null`; the weapon function creates each weapon from its XmlNode with a node whose colour is still empty when the creation runs, shows the node in `SystemColors.GrayText`, adds the weapon and the node to the caller's lists and returns the weapon's identifier, for two weapons in turn. With the grey call removed from `WeaponNodeFunction.Create`, the test of the weapon function failed (1 of 6); with the committed code all pass (212 of 212 with the others). The tests use a test weapon: the app's `Weapon.Create` and the nine `TreeNodeCreation.Create` extension wrappers are not executed by any test.

## Live evidence

The agents of the workflow ran under a local profile outside the repository that names Codex for the hypothesis, grade and repair jobs, because the Claude Code CLI, the default for them, is not installed on this machine (the first full run, below, failed on that); challenges use their default, Codex. The model was Codex's default at effort medium (high for repairs), with a 30-minute limit.

### Whole suite with diagnosis, repair and widening, on the final source

Command: `npm.cmd start -- --settings-overlay <overlay> --fix-changes --live-canonical`, run from the worktree of the final source, with `settings/default.xml` of the overlay holding the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). `Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before the run, after it and after the re-runs below, and every capture runner call printed the same hash as `Canonical SHA-256 before` and `after` (the staged copy too). The candidate built by the workflow had `ChummerGenSR4.exe` SHA-256 `48f7c88b5031f4bf0d2406976f929ca8d7728c267ab030dc9a806a3d0df84404` and `ChummerGenSR4.Core.dll` SHA-256 `238a1dde1824b7ebfbf10c935aba1497200f21131a90c62edcaa462c40ff0889`.

Thread `wf-20261002T182943Z-f4e5c671`, all 13 cases, exit 1, `Outcome: findings_remaining; 0 of 1 clusters fixed, 0 attempts, model time 1.5 min, elapsed 39.3 min`. The canonical cache was off (`canonical cache off (--live-canonical)`): both executables ran live in every case.

Execution, per case (capture status; coverage; both sides live):

| Case | Run folder | Capture | Coverage |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261002T182947Z-31ce4c0c` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Шпала - карьера | `20261002T183215Z-77d81377` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-facemage_Sam | `20261002T183545Z-11fa0b79` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-facemage_Sam_career | `20261002T183833Z-1dec0127` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-rigger | `20261002T184157Z-51ed0a6a` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-rigger_career | `20261002T184437Z-a3eeecb9` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-hacker4boegspriet | `20261002T184748Z-8495c89c` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-technotest | `20261002T185028Z-ef2041b0` | 1 (visual differences) | valid, contiguous, 0 failures, 6 optional absent |
| career-technotest - career | `20261002T185250Z-c6fbcd58` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| career-test_adept | `20261002T185553Z-6dd89e08` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| build-spirit | `20261002T185853Z-f4774fea` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| build-Skull Carver - precareer | `20261002T190121Z-e666bf51` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Skull Carver - career | `20261002T190402Z-120e0b8b` | 0 | valid, contiguous, 0 failures, 8 optional absent |

Execution failures: none. Visual, per case (compare report and completeness; 0 analysis-failed, 0 filtered, 0 execution-lost and 0 unaccounted in every case):

| Case | Compare | Rows passed / failed | Planned / reported / optional absent |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | 0, clear | 13 / 0 | 16 / 13 / 3 |
| career-Шпала - карьера | 0, clear | 20 / 0 | 23 / 20 / 3 |
| build-facemage_Sam | 0, clear | 14 / 0 | 16 / 14 / 2 |
| career-facemage_Sam_career | 0, clear | 20 / 0 | 23 / 20 / 3 |
| build-rigger | 0, clear | 14 / 0 | 16 / 14 / 2 |
| career-rigger_career | 0, clear | 20 / 0 | 23 / 20 / 3 |
| build-hacker4boegspriet | 0, clear | 13 / 0 | 16 / 13 / 3 |
| build-technotest | **1, differences**: 1 discrepancy in 1 group | 12 / 1 (`cyberware-and-bioware` 0.003233) | 16 / 13 / 3 |
| career-technotest - career | 0, clear | 19 / 0 | 23 / 19 / 4 |
| career-test_adept | 0, clear | 19 / 0 | 23 / 19 / 4 |
| build-spirit | 0, clear | 14 / 0 | 16 / 14 / 2 |
| build-Skull Carver - precareer | 0, clear | 13 / 0 | 16 / 13 / 3 |
| career-Skull Carver - career | 0, clear | 19 / 0 | 23 / 19 / 4 |

The one discrepancy (cluster `d-b2a159e2291160c9`, 2,814 differing pixels at 300,74 with 128x22 pixels) is in the tab strip of the Create window of `build-technotest`: the canonical crop shows the selected tab `Cyberware and Bioware`, the candidate's crop a blank header of the same size, with the tabs beside it aligned and unchanged. The other 12 rows of the case, taken in the same run, are within the threshold.

Loop: triage found 1 cluster and 0 other findings. Diagnosis took a source snapshot of 392 files of this source and ran one hypothesis job on Codex (record `wf-20261002T182943Z-f4e5c671/d-b2a159e2291160c9/hypothesis/1`, 1.5 min). It abstained: `Loop d-b2a159e2291160c9: abstained after 0 attempts`; the job's reason is that the crop shows a uniform grey rectangle over the tab header, that the source defines the tab's text in `Chummer/frmCreate.Designer.cs` and its translation in `bin/lang/en-us.xml`, that it found no source or data change that explains the rectangle, and that a single capture cannot tell a transient paint or capture artifact from an overlay. No challenge, check capture, repair or widening ran (`Repair: 0 clusters`, `Widening: 0 attempts, 0 promoted, 0 rejected; no accepted branch`), so no fix change was archived and no benchmark item was added. The loop did not resolve this cluster; it stands in the thread's outcome.

### Finding: the cluster did not reproduce, re-run on its own

Runs to classify the cluster, case `build-technotest` only, same candidate (`ChummerGenSR4.exe` SHA-256 `48f7c88b5031f4bf0d2406976f929ca8d7728c267ab030dc9a806a3d0df84404`), both sides live:

1. `npm.cmd start -- --case build-technotest --settings-overlay <overlay> --fix-changes --live-canonical`, thread `wf-20261002T191348Z-ee0b2965`, reused the recorded capture and compare of the full run (`capture build-technotest: reusing …20261002T185028Z-ef2041b0 from thread wf-20261002T182943Z-f4e5c671 (status 1)`), so it captured nothing new; its hypothesis job ran again on the same evidence and abstained again (`Outcome: findings_remaining`, exit 1). It is not an independent observation and is not counted as one.
2. The same command with `--recapture`, thread `wf-20261002T191536Z-d2d271b0`, run folder `20261002T191539Z-c73f6510`: capture status 0; coverage valid, contiguous, 92 actions, 0 failures, 0 not run, 6 optional absent, 12 skipped optional; compare status 0, clear; 13 rows passed, 0 failed, 0 discrepancies in 0 groups; completeness 16 planned, 13 reported, 3 optional absent, 0 analysis-failed, 0 filtered, 0 execution-lost, 0 unaccounted. `Triage: 0 discrepancies in 0 clusters`, `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 2.4 min`, exit 0.

The candidate drew the tab header on the second capture, so the blank header of the full run is classified as a transient paint of that window, not a result of the move; the evidence for the cause is the crop and the hypothesis job's abstention, and no code path that clears a tab's caption was found. It is recorded as a failure of the full run, not as a pass: the full run's outcome stays `findings_remaining`, and no single run on this candidate shows all 13 cases within the threshold.

### Earlier full run on the previous source, with kill and resume

A first whole-suite run (thread `wf-20261002T173132Z-f06dc73d`, `--live-canonical`, the same overlay and command, without a profile) was made on the source before `Chummer/WeaponNodeFunction.cs` was added: the weapon function was then a lambda inside `TreeNodeCreation`, and the candidate's `ChummerGenSR4.exe` had SHA-256 `0168050788a6af40548b20ff9c9a8cd4142f9d617cb646615d31c45767bd3c61`. It is kept as evidence of the kill and resume and of a second transient failure; it does not stand for the final source.

- Kill and resume: during the canonical capture of the second case (run folder `20261002T173406Z-53247e9a`, left without a summary), the run's process tree was ended with `taskkill /PID <cmd> /T /F`, which terminated the workflow, the capture runner and both app processes. `npm.cmd start -- --resume wf-20261002T173132Z-f06dc73d` printed `Resuming thread wf-20261002T173132Z-f06dc73d.` and `Taking over the desktop lane from process 28936, which is no longer running.`, kept the first case's recorded capture and compare, and captured the second case again.
- 12 of the 13 cases had capture status 0 with valid coverage and compare status 0, clear. `build-hacker4boegspriet` (run folder `20261002T175129Z-1696877e`) had capture status 2 with invalid coverage: candidate action 4 (`selectTab:Martial Arts`) failed with `TimeoutException: Tab 'Martial Arts' was not selected within 5 s. MSAA state=3145728, native current index=1, expected index=2`, 41 candidate actions not run; and its two captures taken before the failed action showed the keyboard access-key underlines on the candidate's menu bar and lists (5 discrepancies in 5 clusters), which Windows draws once a window has received keyboard input.
- The case's diagnosis failed as `infra` (`claude exited with null without a result: spawn claude ENOENT`), because the Claude Code CLI is not installed; the thread stopped with a setup error, did not conclude and wrote no `outcome.json`. A re-run of that case alone (thread `wf-20261002T181121Z-7013faf6`, run folder `20261002T181124Z-6403956d`) had capture status 0, 13 rows within the threshold, and `Outcome: verified_for_scope`. The case also passed in the final source's full run above (`20261002T184748Z-8495c89c`).

## Archive

The archive is the last commit of the change. `npx openspec archive extract-core-unique-models --yes` printed `Specs updated successfully.` (`+ 1 added`, `~ 1 modified` in `openspec/specs/core-library/spec.md`) and `Change 'extract-core-unique-models' archived as '2026-10-02-extract-core-unique-models'.`; `npm run openspec:validate` then printed `Totals: 13 passed, 0 failed (13 items)`.

## Unverified

- The workflow's repair and widening never ran on a cluster: the only cluster of the final source's full run abstained at diagnosis, and no regression was provoked on purpose. No challenge job ran, no check capture ran, and no quota wait was observed.
- The hypothesis jobs ran on Codex, because the Claude Code CLI (their default provider) is not installed on this machine; the Claude adapter did not run live.
- No single run of the final candidate has all 13 cases within the threshold: the full run had 12 and the re-run of `build-technotest` the 13th, and the earlier full run on the previous source had the same shape with `build-hacker4boegspriet`. Both failures are classified as transient from one re-run each; their causes (a blank tab header; keyboard cues and a tab-selection timeout) are inferred from the captures, not shown.
- No case creates an item: the cases open saved characters, so no `Create` method, none of the nine `TreeNodeCreation.Create` wrappers and no weapon function of a quality ran live. The adapters `TreeNodeView`, `ContactColour` and `WeaponNodeFunction` are tested with tree nodes, colours and a test weapon, but the quality's own assignment of text, tag and grey text in `Quality.Create` (which reads the options and the language) and the app's `Weapon.Create` run in no test and no live case; they are covered by reading the code against the former block.
- No case changes a contact's colour, so the colour window did not run live; `GetColour` and `SetColour` are tested, and loading and drawing contacts ran in the captures of the cases with contacts.
- The unit tests of the moved items cover only what runs without an application host (a contact's save data, an attribute's modifiers); display names, prints, costs and the skillsoft rating of a skill read the language or the options and are covered only by the live captures of the cases' windows; no case prints a character.
- The unit tests run the library on .NET (the test project's runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths they exercise use no framework-specific behaviour.
- The Debug configuration and Visual Studio's form designer were not tried.
