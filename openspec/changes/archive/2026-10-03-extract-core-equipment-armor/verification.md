# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The live runs and the checks below used the files of the commit whose trees are `Chummer` `d0ab68544fc23ccd9df76e9f66a5192e3e3370c3`, `Core` `19248f5b27e515dd0af518135365cac0a7c55dd9`, `parity` `eff6398d24b5863ff603b98ce6c426d5e38b4f9a` and `workflow` `73b3de341cb8d0b0516d841e337e29b553547896`. The later commits of the change (this record, the proposal's wording and the archive) change only `openspec/`.

The live runs used the candidate that the workflow built from the files of `Chummer/` and `Core/` in those trees. The build recorded the compiled source's identity, SHA-256 `ec28e9eb4b6a574951373b8ba7aa8a9633e834aaf3bbcadc6ceb12531c4e374c`, next to the candidate (`out/candidate/source-fingerprint.txt`); the workflow's own identity function (`compiledSourceIdentity`, a SHA-256 over the path and file hash of every compiled file) printed the same value on the committed files.

After the live runs the branch was rebased onto a base whose capture and workflow tools record the candidate's UI tree after each capture; its `parity` tree is `a295ca362633ff3f4293ce10944f80d41671e322` and its `workflow` tree `12cc6866967ed142a72f1add6cdb8d312f9e7cb2`, and `Chummer/` and `Core/` are unchanged. On that base `npm run openspec:validate` (14 passed, 0 failed), `workflow:typecheck`, `workflow:test`, `contracts:check` (14 files up to date), `contracts:test` and `parity:test` (234 passed) all exited 0. The captures of this record were made with the earlier tools, not these; no capture was repeated with them.

## Checks

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 13 passed, 0 failed (13 items)` (with the archived change) |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 312`, `# fail 0` |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:   226, Skipped:     0, Total:   226` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |

## Fixture-tested scope (builds, metadata, git and unit tests, no desktop)

Every build went through `parity/scripts/build-candidate.mjs` (`npm run build:candidate`), which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time and printed `Core -> …\ChummerGenSR4.Core.dll` and `Chummer -> …\ChummerGenSR4.exe` with no error after each of the steps below.

- Separate files (task 1.1), commit `5adaac6`: the files were cut by a script that copies line ranges of `Chummer/clsEquipment.cs` and checks the boundary lines first. `git diff --stat --histogram 4d768c0 5adaac6` prints `Chummer/clsEquipment.cs | 7960 -----` (deletions only) and adds `Chummer/Armor.cs` (2,059 lines), `Chummer/Cyberware.cs` (2,115 lines) and `Chummer/Gear.cs` (3,819 lines): the file's `using` lines, namespace and closing brace around the cut ranges. The 7,960 removed lines are those ranges plus the three blank lines that separated them from the next type.
- Interfaces (task 1.2), commit `8dd8086`: `ICharacter` with `Metatype`, `CHA`, `INT`, `LOG` and `WIL`; `ITreeNodeView` with `NewNode`, `Add` and `Expand`; `IEquipmentWeapon`; `IEquipmentHost` as `IApplicationHost.Equipment`; `TreeNodeView` with `Node` and the new members; `Weapon` implementing `IEquipmentWeapon`; `WinFormsEquipmentHost` registered by `WinFormsApplicationHost`; `AppArguments`; and the test doubles. The candidate built.
- In place (task 1.3), commit `38c2b41`: the candidate built. On the three files of the next commit (the same content), this search printed only the three XPath strings that name weapons (`"/chummer/weapons/weapon[...]"`):

  ```powershell
  Select-String Core/Gear.cs,Core/Armor.cs,Core/Cyberware.cs -Pattern '\bCharacter\b|TreeNode\b|\bWeapon\b|frm\w|ContextMenu|Color|objWeapons|objWeaponNodes|Forms|Drawing' | Where-Object { $_.Line -notmatch '^\s*//' }
  ```

  The matches it leaves out are documentation and comments. The commit changes the three files by the `using` lines, the character's type, the `Create` and `Copy` signatures and their documentation, the node creations (`new TreeNode()` to `NewNode()`, `Nodes.Add` to `Add`, `ForeColor = SystemColors.GrayText` to `ShowAsGrayText()`), the windows and weapon creations (to `ApplicationHost.Current.Equipment`), the weapon lists (to the weapon function, a function that keeps nothing where the lists were thrown away, `null` where they were `null`) and the mod node of `Armor.Create`; it adds `GrantedWeaponLists`, `ArmorModNodes` and `EquipmentTreeNodeCreation`, and moves a quality's weapon creation in `Chummer/TreeNodeCreation.cs` onto `WinFormsEquipmentHost.CreateGrantedWeapon`, the same function that the host's `CreateWeapon` calls.
- Move (task 1.4), commit `0f914d8`: `git show -M90% --name-status --format= 0f914d8` prints `R100 Chummer/Armor.cs Core/Armor.cs`, `R100 Chummer/Cyberware.cs Core/Cyberware.cs` and `R100 Chummer/Gear.cs Core/Gear.cs`, and nothing else; `git log --follow --format='%h %s' -- Core/Gear.cs` lists the move, the in-place commit and the separation. `git ls-files --eol` prints `i/crlf` for the three moved files, `Core/IEquipmentHost.cs`, `Core/IEquipmentWeapon.cs` and the new files of `Chummer/`; the moved files keep the BOM of `clsEquipment.cs`. The candidate built.
- Types (task 1.4): the type definitions of the candidate (`ChummerGenSR4.exe` SHA-256 `72757221253f5ff44261643a4b1d79492da3e417592eb4e9b0fbe799a70295d7`, `ChummerGenSR4.Core.dll` SHA-256 `25041d5b2bc40564e80ad232deaf2115dbc47844699252ff87cb084051fe5af3`) were compared with those of a build of the source before this change (the parent branch's `Chummer/` and `Core/` taken with `git archive` into a scratch folder and built with `node parity/scripts/build-candidate.mjs --source <scratch>/base-src --output <scratch>/base-build --log <scratch>/base-build.log`). The names were read from the assemblies' metadata with `System.Reflection.Metadata` (as `exe` or `lib` plus namespace and name, nested types as `Outer+Inner`, leaving out `<Module>` and the compiler's types whose names hold `<`) and compared with `Compare-Object`. The baseline has 199 types (147 in the executable, 52 in the library) and the candidate 206 (143 and 63). The comparison printed exactly: `Armor`, `ArmorMod`, `CapacityStyle`, `Commlink`, `Cyberware`, `Gear`, `Grade`, `GradeList` and `OperatingSystem` gone from the executable and added to the library; `IEquipmentHost` and `IEquipmentWeapon` added to the library; `AppArguments`, `ArmorModNodes`, `EquipmentTreeNodeCreation`, `GrantedWeaponLists` and `WinFormsEquipmentHost` added to the executable. No name is defined in both assemblies.
- Equipment without the application (task 1.5), commit `22c5948`: `EquipmentTests` (3 tests) run the moved gear with the test character (`Fakes/TestItemCharacter`, whose members a test does not set throw) and a recording tree node (`Fakes/TestTreeNode`), and no host registered: a gear with a plain child, a commlink and an operating system is copied into a node, which gets the copy's name and new identifier, one child node per child in order with its name and identifier, and an `Expand` per child, while the copies keep the children's types and the weapon function is never called; a commlink child's own child lands in the commlink's node; and a gear shows its name, category and children through `ICharacterGear`.
- The app's adapters (task 1.5): `AppAdaptersTests` compile `Chummer/TreeNodeView.cs`, `Chummer/GrantedWeaponLists.cs` and `Chummer/ArmorModNodes.cs` into the test project (7 of its 13 tests are new): a tree node view's new nodes are Windows Forms nodes in no tree, empty and without a colour, are added after the existing children, and an added foreign view throws an `InvalidCastException` without adding anything; `Expand` expands the node; the granted weapon lists get the node and then the weapon, a `null` list throws a `NullReferenceException` when a weapon is added, and a foreign node view or a weapon of another type throws an `InvalidCastException` (the node of the second is in the node list, as the former code added it first); the function of `ArmorModNodes.Create(menu)` creates a new node in no tree on every call, with the menu, wrapped in a `TreeNodeView`. `AppArgumentsTests` (4 tests) compile `Chummer/AppArguments.cs`, the check that `WinFormsEquipmentHost.CreateWeapon` makes of its character and node: an argument of the app's type comes back as the same instance; another type throws an `ArgumentException` whose parameter name, message (the need and the type) are those given; `null` throws the same with `null` in the message; a test character is refused where the app's `Character` is required. With the other tests: 226 of 226 pass (212 before this change).
- Not executed by any test: `WinFormsEquipmentHost` itself (it opens windows and creates the app's `Weapon` for the app's `Character`), the nine extension methods of `EquipmentTreeNodeCreation` (they name `Character` and `Weapon`, which the test project cannot compile; only what they call, the weapon lists' function and the mod node function, is tested), and every `Create` of the moved types, which read the language, the options and the data files through the host.

## Live evidence

Both executables ran live in every capture below (`canonical cache off (--live-canonical)`); no side came from the canonical cache. The settings overlay held `settings/default.xml` with the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). No agent job ran, because no run produced a discrepancy cluster.

`Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before and after each run, and every capture runner call printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` as `Canonical SHA-256 before` and `after`.

### Whole suite with diagnosis, repair and widening

Command: `npm.cmd start -- --settings-overlay <overlay> --fix-changes --live-canonical`. Thread `wf-20261002T205350Z-0ef79b13`, all 13 cases. Exit status 2: `Outcome: findings_remaining; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 36.3 min`. Triage found 0 discrepancy clusters and 32 other findings without pixel analysis (rows of the two failed cases); diagnosis, repair and widening ran on 0 clusters.

Execution, per case (capture status; coverage):

| Case | Run folder | Capture | Coverage |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261002T205354Z-fc3324ce` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Шпала - карьера | `20261002T205626Z-02a7b0dd` | 0 | valid, 6 optional absent |
| build-facemage_Sam | `20261002T205956Z-66d03913` | 0 | valid, 4 optional absent |
| career-facemage_Sam_career | `20261002T210246Z-86419b92` | 0 | valid, 6 optional absent |
| build-rigger | `20261002T210610Z-05dc67ab` | 0 | valid, 4 optional absent |
| career-rigger_career | `20261002T210849Z-12997f2d` | 0 | valid, 6 optional absent |
| build-hacker4boegspriet | `20261002T211201Z-1d0fd696` | 0 | valid, 6 optional absent |
| build-technotest | `20261002T211443Z-621a40b6` | 0 | valid, 6 optional absent |
| career-technotest - career | `20261002T211709Z-fa5ccb3a` | **2, execution failure** | **invalid**: candidate side stopped at action 42 (`capture:street-gear-pets-and-cohorts`), reason `pointer` (the pointer moved to 25,2 away from the title bar's park point); 9 captures execution-lost |
| career-test_adept | `20261002T211944Z-166708e7` | **2, execution failure** | **invalid**: canonical side stopped at `capture:common`, reason `pointer` (the pointer moved to 1919,0); all 23 captures execution-lost |
| build-spirit | `20261002T212124Z-0a453ebe` | 0 | valid, 4 optional absent |
| build-Skull Carver - precareer | `20261002T212356Z-f18ac99f` | 0 | valid, 6 optional absent |
| career-Skull Carver - career | `20261002T212642Z-1753ba71` | 0 | valid, 8 optional absent |

Execution failures: the two `pointer` failures above. They are failures of the run, not drawing differences: the desktop's pointer was moved while a side ran, and the rows of the two cases that were not captured are not evidence either way.

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
| career-technotest - career | 0, clear (of what was captured) | 10 / 0 | 23 / 10 / 4 / 9 |
| career-test_adept | 0, clear (nothing captured) | 0 / 0 | 23 / 0 / 0 / 23 |
| build-spirit | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| build-Skull Carver - precareer | 0, clear | 13 / 0 | 16 / 13 / 3 / 0 |
| career-Skull Carver - career | 0, clear | 19 / 0 | 23 / 19 / 4 / 0 |

Eleven cases are within the threshold in every row of every planned capture, with no discrepancy. In this thread the visual result of the other two is incomplete, because of the execution failures; no row of them differs. They are covered by the re-run below.

### Re-run of the two failed cases

The two failed cases were run again, together, with `--recapture`: `npm.cmd start -- --case "career-technotest - career,career-test_adept" --settings-overlay <overlay> --fix-changes --live-canonical --recapture`.

A first attempt (thread `wf-20261003T073646Z-ad9bc120`) failed on both sides of both cases before the first action: `startup: window-activation: window … was not in the foreground after 10 attempts 200 ms apart (foreground: window 524958 'New notification' of class 'Windows.UI.Core.CoreWindow' in process 11260 (ShellExperienceHost))`, `Coverage: INVALID … 134 not run` for each case, exit status 2, 23 of 23 captures execution-lost in each. An empty notification window of the Windows shell held the foreground; that is a state of the machine, and no visual result came from it.

The same command was started again once the foreground was clear (thread `wf-20261003T170933Z-8fa3635d`, exit status 0, `Outcome: verified_for_scope; 0 of 0 clusters fixed`, elapsed 6.6 min). Canonical SHA-256 before and after the build and each capture was `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; both sides ran live.

| Case | Run | Execution | Visual (passed / failed) | Planned / reported / optional absent |
|---|---|---|---|---|
| career-technotest - career | `20261003T170937Z-ec87b952` | capture 0, coverage valid (0 failed, 8 optional absent, 16 skipped optional, 0 not run) | compare clear, 19 / 0, 0 discrepancies | 23 / 19 / 4 |
| career-test_adept | `20261003T171253Z-613234c5` | capture 0, coverage valid (0 failed, 8 optional absent, 16 skipped optional, 0 not run) | compare clear, 19 / 0, 0 discrepancies | 23 / 19 / 4 |

Triage found 0 clusters; diagnosis, repair and widening ran on 0 clusters. All 13 cases are therefore within the threshold on this source with valid coverage, but across two threads: 11 cases in the whole-suite thread and these two in the re-run. The candidate source is the same in both (the compiled source identity above); no single run covers all 13.
## Archive

The archive is the last commit of the change. `npx openspec archive extract-core-equipment-armor --yes` printed `Specs updated successfully.` (`+ 1 added`, `~ 1 modified` in `openspec/specs/core-library/spec.md`) and `Change 'extract-core-equipment-armor' archived as '2026-10-03-extract-core-equipment-armor'.`; `npm run openspec:validate` then printed `Totals: 13 passed, 0 failed (13 items)`.

## Unverified

- No single run of this candidate covers all 13 cases with valid coverage: eleven come from the whole-suite thread and the two that lost captures to `pointer` execution failures there (`career-technotest - career`, `career-test_adept`) from the re-run above. The whole-suite thread itself ended `findings_remaining` because of those two execution failures.
- The workflow's repair and widening never ran on a cluster, because no run produced one, and no regression was provoked on purpose. No hypothesis or challenge job, no check capture, no quota wait and no kill and resume was observed on this source.
- No case creates, copies or buys equipment: the cases open saved characters, so no `Create` or `Copy` of armor, cyberware or gear, none of the nine extension methods, no variable-cost or weapon-category window and no weapon creation of `WinFormsEquipmentHost` ran live, and no test runs them either. Loading the equipment, its values, its tree nodes and its tabs ran in the captures of every case. The tree node view's new members, the weapon lists' function, the mod node function, the argument check of the host and gear copying are tested; the rest is covered by reading the diff of the in-place commit against the former code.
- The unit tests of the moved types cover only what runs without an application host (copying gear into a tree, the character view of gear); display names with a rating or extra, costs, availabilities, capacities, Essence and prints read the language or the options and are covered only by the live captures; no case prints a character.
- The unit tests run the library on .NET (the test project's runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths they exercise use no framework-specific behaviour.
- The Debug configuration and Visual Studio's form designer were not tried.
