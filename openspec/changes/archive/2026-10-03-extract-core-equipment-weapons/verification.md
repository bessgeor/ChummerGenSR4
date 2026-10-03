# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The code of the branch is final at commit `a7ae15e21c05e1a77b385d5ca8d72710d149ae89`, whose trees are `Chummer` `d5867cf35a8b09b0ec654684a481e3137275f16d`, `Core` `2735443c19fd5a1831e8b67739c7d7f3dbf58308`, `parity` `38d2431bcc607148c1846297de6f7d033bd8e3ab` and `workflow` `12cc6866967ed142a72f1add6cdb8d312f9e7cb2`; the commits after it (this record and the archive) change only `openspec/`. The checks below and the second live run used that commit. The first live run, over the whole suite, used an earlier source whose `Chummer` tree is the final one and whose `Core` tree is `560e88ee125110dc49737f2aff03f30ad1c40d7e`. The branch history was rewritten after that run, so that `Core` tree is no commit of the branch; it differs from the final one in three files only: `IEquipmentWeapon.cs` (the member `VehicleMounted`, which `Weapon` already had), `Vehicle.cs` (the vehicle marks its gear's weapons through that member; the type of one loop variable) and `ITreeNodeView.cs` (a documentation comment). None of these can change what a capture shows, because no case buys a vehicle's gear, and `npm run build:candidate` builds the same `ChummerGenSR4.exe`, SHA-256 `998897ac16582bb740aa4255f4f0ce1e6d809dd9239297e6c0cb102c0069bf85`, from both. That is an argument, not a capture: the other eleven cases were not captured against the final library (`ChummerGenSR4.Core.dll` `85762cc5…`), and task 2.1 is worded accordingly. The second live run covers the final library on the two cases with a vehicle.

The candidate of the second live run was built by the workflow from the files of `Chummer/` and `Core/` of that commit: `ChummerGenSR4.exe` SHA-256 `998897ac16582bb740aa4255f4f0ce1e6d809dd9239297e6c0cb102c0069bf85`, `ChummerGenSR4.Core.dll` SHA-256 `85762cc5d4d84213c3cc8b881e95dda96d0583ea617f4ebcf3ce4b34fc844279`, compiled source identity `ac6aecdc7acbb62bf23245843e74c6d63df0c395e07c3406c058a68bfe0b65d5` (`out/candidate/source-fingerprint.txt`).

## Checks

On the final code (the commit before this record):

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 15 passed, 0 failed (15 items)` (with the change in progress) |
| `npm run workflow:typecheck` | `tsc -p workflow` with no further output, exit 0 |
| `npm run workflow:test` | `# tests 345`, `# pass 345`, `# fail 0` (see Findings for an earlier failure of one test) |
| `npm run parity:test` | `Passed!  - Failed:     0, Passed:     7, Skipped:     0, Total:     7` (`Parity.Hosted.Tests.dll`) and `Passed!  - Failed:     0, Passed:   243, Skipped:     0, Total:   243` (`Parity.Tests.dll`) |
| `npm run contracts:check` | `Generated contracts are up to date (14 files).` |
| `npm run contracts:test` | `# tests 9`, `# pass 9`, `# fail 0` |

## Fixture-tested scope (builds, metadata, git and unit tests, no desktop)

Every build went through `parity/scripts/build-candidate.mjs` (`npm run build:candidate`), which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time and printed `Core -> …\ChummerGenSR4.Core.dll` and `Chummer -> …\ChummerGenSR4.exe` with no error after each of the steps below.

- Separate files (task 1.1): the files were cut by a script that copies line ranges of `Chummer/clsEquipment.cs` and checks the boundary lines first. `git diff --stat --histogram 25b6dad6 10aaa9e6` prints `Chummer/clsEquipment.cs | 7989 -----` (deletions only) and adds `Chummer/Weapon.cs` (4,639 lines), `Chummer/Lifestyle.cs` (700 lines) and `Chummer/Vehicle.cs` (2,683 lines): the cut ranges between the first 11 lines of `clsEquipment.cs` (its `using` lines, namespace and opening brace) and its closing brace. The 7,989 removed lines are those ranges plus the three blank lines that separated them from the next type; `clsEquipment.cs` keeps `Equipment`.
- Interfaces (task 1.2), commit `3753dc16`: `ICharacter` with `IgnoreRules`, `BOD`, `STR`, `FindGear`, `FindGearByWeaponID` and `FindVehicleGear`; `ITreeNodeView` with `Children`; `IEquipmentWeapon` with `VehicleMounted`, which `Weapon` already has as a public property; `Character` implementing the three searches explicitly with `CommonFunctions` on its gear and vehicle lists; `TreeNodeView.Children`; the test doubles. The candidate built and `npm run parity:test` passed.
- In place (task 1.3), commit `c8edbcd2`: the candidate built. On the four files of the next commit (the same content), this search printed nothing:

  ```powershell
  Select-String Core/Weapon.cs,Core/Lifestyle.cs,Core/Vehicle.cs,Core/Equipment.cs -Pattern '\bCharacter\b|TreeNode\b|ContextMenu|CommonFunctions|\bfrm[A-Z]|Color|Forms|Drawing' | Where-Object { $_.Line -notmatch '^\s*//' }
  ```

  The commit changes the four files by the `using` lines, the character's type, the `Create` signatures and their documentation, the node creations (`new TreeNode()` to the node functions, `Nodes.Add` to `Add`, the vehicle's search of `Nodes` to `Children`, `ForeColor = SystemColors.GrayText` to `ShowAsGrayText()`, the context menu statements removed), the searches (`CommonFunctions` with the character's lists to the character's `FindGear`, `FindGearByWeaponID` and `FindVehicleGear`, the unused found vehicle removed), the vehicle gear's weapon lists (to a function that keeps the weapon and drops its node, and the vehicle's marking of each kept weapon as mounted through `IEquipmentWeapon`) and the vehicle mod's number window (to `ApplicationHost.Current.Equipment.SelectNumber`). It renames `ArmorModNodes` to `ContextMenuNodes` and adds the six former `Create` signatures to `EquipmentTreeNodeCreation`. Every app call of these `Create` methods passes a Windows Forms `TreeNode` variable as the node (none passes a `null` literal), so each binds to its extension method.
- Move (task 1.4), commit `dd565d20`: `git show -M90% --name-status --format= dd565d20` prints `R100 Chummer/clsEquipment.cs Core/Equipment.cs`, `R100 Chummer/Lifestyle.cs Core/Lifestyle.cs`, `R100 Chummer/Vehicle.cs Core/Vehicle.cs` and `R100 Chummer/Weapon.cs Core/Weapon.cs`, and nothing else; `git log --follow --format='%h %s' -- Core/Weapon.cs` lists the move, the in-place commit, the separation and then the earlier commits of `Chummer/clsEquipment.cs`. `git ls-files --eol` prints `i/crlf` for the four moved files and `Chummer/ContextMenuNodes.cs`; the moved files keep the BOM of `clsEquipment.cs`. The candidate built.
- Types (task 1.4): the type definitions of a candidate (`ChummerGenSR4.exe` SHA-256 `998897ac16582bb740aa4255f4f0ce1e6d809dd9239297e6c0cb102c0069bf85`, `ChummerGenSR4.Core.dll` SHA-256 `19418d68da09650e1f44e3f5764cba6f9d21c8ece8997a05757954549f276c87`, built from the `Core` tree `560e88ee…` of the first live run) were compared with those of a build of the source before this change (the parent branch's `Chummer/` and `Core/` taken with `git archive` into a scratch folder and built with `node parity/scripts/build-candidate.mjs --source <scratch>/base-src --output <scratch>/base-build --log <scratch>/base-build.log`). The names were read from the assemblies' metadata with `System.Reflection.Metadata` (as `exe` or `lib` plus namespace and name, nested types as `Outer+Inner`, leaving out `<Module>` and the compiler's types whose names hold `<`) and compared with `Compare-Object`. The baseline has 206 types (143 in the executable, 63 in the library) and the candidate 206 (135 and 71). The comparison printed exactly: `Equipment`, `Weapon`, `WeaponAccessory`, `WeaponMod`, `LifestyleType`, `Lifestyle`, `VehicleMod` and `Vehicle` gone from the executable and added to the library, and `ArmorModNodes` gone from the executable and `ContextMenuNodes` added to it. No name is defined in both assemblies. The listing was not made again on the final library (`85762cc5…`): `git diff --stat 560e88ee125110dc49737f2aff03f30ad1c40d7e 2735443c19fd5a1831e8b67739c7d7f3dbf58308`, the `Core` tree of that build against the final one, lists `IEquipmentWeapon.cs` (5 lines added, a member), `ITreeNodeView.cs` (a documentation comment) and `Vehicle.cs` (the type of one loop variable), and a search of that diff for added or removed lines with `class`, `interface`, `enum` or `struct` printed nothing. `Chummer/` is the same tree in both.
- Weapons and vehicles without the application (task 1.5), commit `71f19710`: `WeaponsAndVehiclesTests` (6 tests) run the moved types with the test character (`Fakes/TestItemCharacter`, whose members a test does not set throw, now with gear its searches find and a recorded list of the searches) and no host registered: a weapon's total armor penetration includes the bonus of loaded ammunition found among the character's gear (`-2` with `-1` gives `-3`) with only the character's gear searched; ammunition found only in a vehicle's gear (`-2` with `-4` gives `-6`) after both searches; and its own value (`+1`) when neither finds it; a vehicle's maximum armor is twice its body for a car, three times for a drone, and 20 when the character ignores the rules.
- The app's adapters (task 1.5): `AppAdaptersTests` (3 of its tests are new, one renamed) show that a tree node view's children are its Windows Forms node's children in order as tree node views of the same nodes with their tags, none for a node without children; that a node added to a child found through them becomes a child of that Windows Forms node and not of the parent; and that the node function of `ContextMenuNodes.Create` without a menu creates a node in no tree without one (the test with a menu is the former armor mod test, renamed). With the other tests: 243 of 243 pass (234 before this change).
- Creating weapons and vehicles with a host (task 1.6), commit `9958e855`: `Parity.Hosted.Tests` is a second test project because the host is registered once for a process and `ApplicationHostTests` needs it unregistered. It registers a host in a module initialiser whose folder (in the temporary folder, removed at exit) holds a `lang/en-us.xml`, a `data/books.xml` and small `weapons.xml`, `vehicles.xml` and `gear.xml`; every question the host would put to a user (messages, number and category windows, improvement dialogs) throws, and the language option of the current user must be `en-us` or the registration throws. The app's `Character` is stood in for by a class that derives from the test character, so that the app's `EquipmentTreeNodeCreation.cs` is compiled into the test project unchanged. The 7 tests run without parallelism, because `XmlManager`'s list is not locked:
  - a weapon with an underbarrel weapon, an accessory and a mod is created into a recording node: the node functions are called for the weapon, the accessory and the mod in that order, their nodes are the node's children in that order with their display names and the identifiers of the items as tags, the node is expanded twice (after the accessory and after the mod), the node has no node of its own made through `NewNode` and no child is grey; created with `blnCreateChildren` false, no node function is called and nothing is added;
  - a vehicle with three mods (two weapon mounts and a spoiler), two pieces of gear (one granting a weapon) and three weapons (one with an accessory and a mod of the vehicle's data) is created: the mod, gear, weapon, accessory and weapon mod node functions are called in the order `mod mod mod gear gear weapon accessory weapon-mod weapon weapon`, the vehicle's node has the mods' and then the gear's nodes as children (the mods' grey, the gear's not) and is expanded five times, the first weapon goes under the first mount, the second under the second mount and the third, which finds no free mount, under the first mount again (each mount expanded once per weapon under it), the mounts' `Weapons` lists hold the same weapons by identifier, every weapon is marked as vehicle mounted, and the first weapon's node has the accessory's and the mod's nodes as children; the weapon that the second gear grants (created by the test host as a test weapon, not as the library's `Weapon`) is marked as vehicle mounted; with `blnCreateChildren` false nothing is created;
  - the app's extension methods, called with a Windows Forms `TreeNode` and five or three context menus: the weapon's underbarrel, accessory and mod nodes have the weapon, accessory and mod menu, and the vehicle's mod nodes the vehicle menu, its gear nodes the gear menu, the weapons under the mounts the weapon menu and a weapon's accessory and mod nodes the accessory and mod menu (the node's own menu stays none).
  
  A mutation check: replacing `funcNewWeaponAccessoryNode()` by `funcNewWeaponModNode()` in `Vehicle.Create` made 2 of the 7 tests fail (the vehicle test and the extension method test) and the other 5 pass; the change was undone and is in no commit. A second mutation, `==` replaced by `!=` in the mount lookup of the first weapon loop of `Vehicle.Create` (`objModNode.Tag.ToString() == objMod.InternalId`), made the same 2 tests fail and the other 5 pass; it too was undone, and the 7 tests passed again.
- Not executed by any test: `Character`'s three searches (it is the app's class, which the test projects do not compile; they call the `CommonFunctions` methods that the weapons called before), the extension methods of `WeaponAccessory`, `WeaponMod`, `Lifestyle` and `VehicleMod` (they only wrap the node, and give no menu), the `Create` of lifestyles, vehicle mods' variable-cost window, the weapon's other `Create` branches (the data files of the tests hold few of the elements the real ones do), and `WinFormsEquipmentHost.CreateWeapon`.

## Live evidence

The canonical side of every case came from the shared canonical capture cache (each case's capture log names the cache entry and the run that stored it); the candidate side ran live in every case. This change touches only the app and the library, which only the candidate runs, and not how canonical sides are captured. The settings overlay held `settings/default.xml` with the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). No agent job ran in either run, because neither produced a discrepancy cluster.

`Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before and after each run (for the first run also after the deliberate stop), and every build and capture runner call printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` as `Canonical SHA-256 before` and `after`.

### Two cases with a vehicle, on the final source

Command: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --fix-changes --case build-rigger,career-rigger_career`, with the local profile choosing Codex for the hypothesis, grade and repair jobs. Thread `wf-20261003T193116Z-10dc2a19`, exit status 0, `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 4.6 min`; `Triage: 0 discrepancies in 0 clusters (0 new), 0 other findings`, `Diagnosis: 0 clusters`, `Repair: 0 clusters`, `Widening: 0 attempts, 0 promoted, 0 rejected; no accepted branch`.

Execution (capture status; coverage; where the canonical side came from):

| Case | Run folder | Capture | Coverage | Canonical side |
|---|---|---|---|---|
| build-rigger | `20261003T193120Z-68621d2f` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| career-rigger_career | `20261003T193330Z-13f4b756` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |

Visual (compare report and completeness; 0 analysis-failed, 0 filtered and 0 unaccounted in both):

| Case | Compare | Rows passed / failed | Planned / reported / optional absent / execution lost |
|---|---|---|---|
| build-rigger | 0, clear | 14 / 0 | 16 / 14 / 2 / 0 |
| career-rigger_career | 0, clear | 20 / 0 | 23 / 20 / 3 / 0 |

The same two cases had the same outcome in the first run (below).
### Whole suite with diagnosis, repair and widening, stopped and resumed (earlier source)

This run used an earlier source (the branch history was rewritten after it): its `Chummer` tree `d5867cf35a8b09b0ec654684a481e3137275f16d` is the final one, its `Core` tree `560e88ee125110dc49737f2aff03f30ad1c40d7e` is not (the final one is `2735443c19fd5a1831e8b67739c7d7f3dbf58308`, which adds `IEquipmentWeapon.VehicleMounted`, the vehicle's marking of its gear's weapons through it, and a documentation comment of `ITreeNodeView.Add`), so the executable of this run is the final one and its library is not. The run below it covers the final library.

Command: `npm.cmd start -- --settings-overlay <overlay> --fix-changes`, with the local profile choosing Codex for the hypothesis, grade and repair jobs. Thread `wf-20261003T174818Z-c2513782`, all 13 cases.

Stop and resume: after the first case had been captured and compared, the process tree of the run was killed (`taskkill /PID <pid> /T /F`) while the second case (`career-Шпала - карьера`, run folder `20261003T175009Z-715cfef3`) was being captured; that run folder was left incomplete and is not evidence. `npm.cmd start -- --resume wf-20261003T174818Z-c2513782` printed `Resuming thread wf-20261003T174818Z-c2513782.` and `Taking over the desktop lane from process 26500, which is no longer running.`, did not build again or capture the first case again, and captured the second case anew in run folder `20261003T175211Z-f757f384`.

The resumed thread ended with exit status 0: `Triage: 0 discrepancies in 0 clusters (0 new), 0 other findings`, `Diagnosis: 0 clusters`, `Repair: 0 clusters`, `Widening: 0 attempts, 0 promoted, 0 rejected; no accepted branch` and `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 30.2 min`. The inventory step printed `Inventory: 69 classes (9 active), controls observed 996/1379, interactions exercised 4/857, tuples observed 211/250, unresolved 6`.

Execution, per case (capture status; coverage; where the canonical side came from):

| Case | Run folder | Capture | Coverage | Canonical side |
|---|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261003T174822Z-5fbbdc68` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| career-Шпала - карьера | `20261003T175211Z-f757f384` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-facemage_Sam | `20261003T175458Z-fd56b0d4` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| career-facemage_Sam_career | `20261003T175700Z-5dc1bdc9` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-rigger | `20261003T175928Z-10bdc793` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| career-rigger_career | `20261003T180137Z-a6a59038` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-hacker4boegspriet | `20261003T180354Z-cb9d6119` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| build-technotest | `20261003T180549Z-66a0ca85` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| career-technotest - career | `20261003T180746Z-f256d0d7` | 0 | valid, contiguous, 0 failures, 8 optional absent | cache |
| career-test_adept | `20261003T181013Z-7bcc0bf0` | 0 | valid, contiguous, 0 failures, 8 optional absent | cache |
| build-spirit | `20261003T181222Z-067f737d` | 0 | valid, contiguous, 0 failures, 4 optional absent | cache |
| build-Skull Carver - precareer | `20261003T181409Z-f41bdc18` | 0 | valid, contiguous, 0 failures, 6 optional absent | cache |
| career-Skull Carver - career | `20261003T181605Z-717fd354` | 0 | valid, contiguous, 0 failures, 8 optional absent | cache |

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

All 13 cases are within the threshold in every row of every planned capture, with no discrepancy, in one thread.


## Findings

- `npm run workflow:test` failed one of its 345 tests in 2 of 11 runs on this branch before the final code and passed all of them in the other 9; on the final code it passed in its one run (345 of 345). The output of the first failed run was not kept. The test was run six more times in a row with each output kept (`out/d5b/wtest-<n>.log`, not committed); run 5 failed with:

  ```text
  not ok 263 - a build still running at the deadline is stopped and rejects the attempt; a stopped run stays a setup error
    duration_ms: 170820.0767
    location: '…\workflow\tests\repair-service.test.ts:1:8938'
    failureType: 'testCodeFailure'
    error: 'false == true'
    stack: TestContext.<anonymous> (…\workflow\tests\repair-service.test.ts:149:3)
  ```

  Line 149 asserts that the rejected attempt's reason says the build was `still running at the deadline`; the line before it, which asserts the stage `deadline`, passed. The test gives the attempt a deadline of 0.003 minutes (0.18 seconds), and the repair service rejects an attempt at that stage with either that reason or `the deadline passed before the build could start` (`workflow/src/repair/repair-service.ts`, lines 242 and 254); the 170-second duration of the failed test shows a busy machine, on which the deadline can pass before the build starts. That this is the cause is inferred from the code, not observed: the reason the failing run got was not printed. This change does not touch `workflow/`, its tests or what they read; the failure is a timing race of the test and is left as a finding.
- The first version of this change had no test that created a weapon or a vehicle, and the live cases create none; a review found that the node functions, the mount lookup through `Children` and the context menus of the extension methods ran nowhere. `Parity.Hosted.Tests` was added for that (task 1.6). It also showed that `Vehicle.Create` cast every weapon that a host creates for its gear to the library's `Weapon`; it now marks them through `IEquipmentWeapon`.

## Archive

The archive is the last commit of the change. `npx openspec archive extract-core-equipment-weapons --yes` printed `Specs updated successfully.` (`+ 1 added`, `~ 2 modified` in `openspec/specs/core-library/spec.md`) and `Change 'extract-core-equipment-weapons' archived as '2026-10-03-extract-core-equipment-weapons'.`; `npm run openspec:validate` then printed `Totals: 14 passed, 0 failed (14 items)`.

## Unverified

- The workflow's repair and widening never ran on a cluster, because neither run produced one, and no regression was provoked on purpose. No hypothesis or challenge job, no check capture and no quota wait was observed on this source.
- No case creates or buys a weapon, accessory, mod, lifestyle or vehicle: the cases open saved characters, so no `Create` of the moved types, none of the extension methods and no vehicle mod's variable-cost window ran live. Loading the equipment, its values, its tree nodes and its tabs, and the ammunition searches of loaded weapons, ran in the captures of every case that has them. The `Create` of weapons and vehicles and the extension methods of both ran only in the unit tests, on small data files and with a stand-in for the app's `Character` and recording or Windows Forms tree nodes, not with the real data files, the app's `Character` or a tree in a window; the extension methods of accessories, mods, lifestyles and vehicle mods and the `Create` of lifestyles and vehicle mods with a variable cost ran nowhere (their code is covered by the build and by reading the diff of the in-place commit against the former code).
- `Character`'s three searches are covered only by the live captures of characters whose weapons have ammunition loaded, and by review; the fixtures were not inspected for which cases load ammunition from a vehicle.
- The unit tests run the library on .NET (the test projects' runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths they exercise use no framework-specific behaviour.
- The type listing of the final library was not made again (see Fixture-tested scope).
- The Debug configuration and Visual Studio's form designer were not tried.