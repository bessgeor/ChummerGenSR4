# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1 installed (release 533325), Visual Studio 2019 Build Tools MSBuild 16.11 (no .NET Framework 4.8.1 Developer Pack), .NET SDK 10.0.401, Node.js 22.17.0.

The live evidence was collected on the branch as of commit `c43e303de5d5225d983e0b8b6f6e78c63916b0ce` (the commit that records the benchmark item), the last commit that changes `Chummer/`, `parity/` or `workflow/`. The commits after it add `docs/rider-mcp.md`, this file and the archive; they change only `docs/` and the change folder and `openspec/specs/`, which no build or capture reads, so the evidence is not affected by them. The run itself started on a checkout holding the documentation commit as well; its `Chummer/`, `parity/` and `workflow/` trees are those of `c43e303`.

## Checks

Run on the final source:

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 12 passed, 0 failed (12 items)` |
| `npm run workflow:typecheck` | no output, exit 0 |
| `npm run workflow:test` | `# tests 307`, `# pass 307`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 185` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# pass 8`, `# fail 0` |
| `npm run eval -- benchmark check` | `Benchmark: 1 items replay from git.` |

## Fixture-tested scope (builds and metadata, no desktop)

Every build went through `parity/scripts/build-candidate.mjs`, which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time. Assembly metadata was compared with a reader of the PE and ECMA-335 metadata (`System.Reflection.Metadata`) that lists PE flags, assembly attributes, assembly references, every type with its methods and fields, and every manifest resource with its length and the SHA-256 of its bytes.

- Baseline (task 1.1): the old project at the base of this change, built into a folder under `out/`, has the same metadata as `bin/ChummerGenSR4.exe` except the `DebuggableAttribute` flags: 284 types, 78 resources with identical bytes, the same references and attributes.
- Service removal (task 1.1): built with exit 0, `0 Warning(s)`. Against the baseline, the only differences are the removed types (82 in `Chummer.OmaeService` and `Chummer.TranslationService`, `frmOmae`, `frmOmaeAccount`, `frmOmaeCompress`, `frmOmaeUpload`, `frmOmaeUploadData`, `frmOmaeUploadLanguage`, `frmOmaeUploadSheet`, `OmaeRecord`, `OmaeHelper`, `OmaeMode` and the three Omae event handler delegates), the eight resources `Chummer.frmOmae*.resources` and `Chummer.OmaeRecord.resources`, the references `System.ServiceModel`, `System.Runtime.Serialization`, `WindowsBase` and `System.Xml.Linq` (only the removed code used them), and the members of `frmMain` (no `mnuToolsOmae`, `mnuToolsOmae_Click`, `OmaeWindow`), `frmUpdate` (a private `Decompress`) and `GlobalOptions` (no Omae properties).
- SDK project (task 1.2): restore and build with exit 0, `0 Warning(s)`. Against the removal build, the only differences are `TargetFrameworkAttribute` (`.NETFramework,Version=v4.8.1`) and the `DebuggableAttribute` flags, which now equal the canonical executable's. Types, members, references and all 70 resources with their bytes are identical. PE: `I386`, `ILOnly` (AnyCPU, no 32-bit flags), `WindowsGui`. The output folder holds `ChummerGenSR4.exe`, `ChummerGenSR4.exe.config` (`sku=".NETFramework,Version=v4.8.1"`, no `system.serviceModel`), `ChummerGenSR4.pdb` and `settings/Darkness_in_the_heart_of_texas.xml`; the old Release build wrote no `.pdb`.
- `dotnet msbuild Chummer/Chummer.csproj -getProperty:TargetPath -getProperty:PlatformTarget -getProperty:Prefer32Bit -p:Configuration=Release` (evaluation only): `TargetPath` `<repository>\bin\ChummerGenSR4.exe`, `PlatformTarget` `AnyCPU`, `Prefer32Bit` `false`. Without the explicit `PlatformTarget` the SDK evaluates it to `x86`.
- A file `Chummer/obj/Stale.cs` holding text that is not C#: the candidate build exited 0, so it was not compiled.
- A copy of `Chummer/` outside the repository, built with `--source <copy> --output <folder>`: exit 0, executable in `<folder>/bin/`, nothing written into the copy or the repository. The reference assembly package comes from the user's NuGet cache; this check did not look at the cache, which is where a first restore on a clean machine writes.
- The same copy with the reference assembly package at version `99.0.0`: `error NU1102`, `MSBuild failed with exit code 1.`, exit 1, no executable.

## Rider's MCP server with two projects (task 1.4)

Measured with Rider 2026.2.1 on scratch copies of `Chummer/` and the solution outside every checkout; the full account is `docs/rider-mcp.md`.

- One endpoint per Rider process: Streamable HTTP at `http://127.0.0.1:<port>/stream` (the first process got port 64482, a second one 64483); `/mcp` answered 404. It lists 80 tools, among them `rename_refactoring`, `move_type_to_namespace`, `safe_delete`, `extract_method`, `extract_interface`, `extract_base_class`, `change_api_signature`, `reorganize_namespaces` (each with `preview`), `apply_patch`, `build_solution_start` and `get_file_problems`. No tool moves a type to another file or project.
- Two solutions opened in one process share its endpoint; the `rootFolder` argument selects the project. Concurrent refactorings in the two projects both applied, each only in its own copy: `rename_refactoring` about 0.7 s each; `move_type_to_namespace` of `Improvement` (19 files, 1053 call sites) 1.97 s and 2.08 s, 2.17 s of wall time for both.
- Two processes (separate configuration and system directories through `RIDER_PROPERTIES`) have two endpoints and serve only their own project; concurrent `move_type_to_namespace` of `XmlManager` (49 files, 406 call sites) took 0.68 s and 4.16 s.
- Memory (working sets): one process with one solution about 3.9 GB (frontend 2.4, backend 1.5); the same process with two solutions about 5.9 GB; a second process with one solution about 4.8 GB. An extra checkout costs about 1.7 GB in one process and about 4.8 GB as a process.
- A copy refactored through the server (`move_type_to_namespace`) built with `build-candidate.mjs --source <copy>`: exit 0.
- Rider's own configuration files (trusted solutions) were edited for the measurement and restored from backups afterwards; no Rider process was left running.

## Live evidence

Command: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --fix-changes --recapture`, with `settings/default.xml` of the overlay holding the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`), the canonical capture cache from `PARITY_CANONICAL_CACHE` (a folder outside the repository shared by the worktrees) and `PARITY_WORKFLOW_PROFILE` naming a profile that sets only `agents.executables.claude`. `--recapture` captures every case again even where a step is recorded. Every canonical side came from the cache (entries stored by earlier runs of the same inputs), so these runs show the candidate executable running live and the canonical capture as stored; the canonical executable ran live only in diagnosis check captures of earlier runs. `Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before and after the run, and every capture runner call printed the same hash as `Canonical SHA-256 before` and `after`. The candidate executable had SHA-256 `a0735018011b68a9d549d20541767b42e391b888a85afd66ef527d2db9e06352` and its `ChummerGenSR4.exe.config` `fcaad158e7d910bc217ebca1b3876eea91fa3e03af68aa8adbff3a6e1dd08f6c`.

### Whole suite, with a deliberate kill and resume

Thread `wf-20261002T113527Z-de4d69d4`, all 13 cases, exit 0, `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 19.8 min` (the elapsed time of the resumed session).

- Kill: while `career-facemage_Sam_career` was being captured (run folder `20261002T113954Z-475f5b84`, no result), the process tree was ended with `taskkill /T /F`. The three earlier cases were complete.
- Resume: `npm start -- --resume wf-20261002T113527Z-de4d69d4` printed `Resuming thread wf-20261002T113527Z-de4d69d4.`, `capture career-facemage_Sam_career: capturing again (--recapture).` and `Taking over the desktop lane from process 8452, which is no longer running.`; the case ran again in `20261002T114054Z-2954ecda` and the remaining cases followed. The three completed cases were kept, not captured again.
- No quota wait occurred, since no model job ran: there were no discrepancies to diagnose. A quota wait was not observed.

Execution, per case (capture status; coverage; every canonical side from the cache):

| Case | Run folder | Capture | Coverage |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261002T113532Z-3d259a54` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Шпала - карьера | `20261002T113647Z-370ae5e9` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-facemage_Sam | `20261002T113832Z-da5c2724` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-facemage_Sam_career | `20261002T114054Z-2954ecda` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-rigger | `20261002T114237Z-f470c967` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-rigger_career | `20261002T114357Z-1979bfd6` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-hacker4boegspriet | `20261002T114532Z-0f7892ad` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-technotest | `20261002T114652Z-899d93c5` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-technotest - career | `20261002T114803Z-b9bf0959` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| career-test_adept | `20261002T114933Z-aa8e1338` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| build-spirit | `20261002T115103Z-729541dd` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| build-Skull Carver - precareer | `20261002T115217Z-bd0d026b` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Skull Carver - career | `20261002T115337Z-0722f06a` | 0 | valid, contiguous, 0 failures, 8 optional absent |

Visual, per case (compare status 0, `clear`, 0 discrepancies in 0 groups for every case; completeness with 0 analysis-failed, 0 filtered, 0 execution-lost, 0 unaccounted):

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

Triage found 0 discrepancies in 0 clusters, so diagnosis, repair and widening had nothing to do on this run (`Diagnosis: 0 clusters`, `Repair: 0 clusters`, `Widening: 0 attempts`).

An earlier thread (`wf-20261002T113238Z-0106edf6`) on the same source, without `--recapture`, reused every capture and compare step recorded by earlier runs and ended `verified_for_scope` in 0.1 min. It is not counted as evidence of a run; it shows that the capture key (candidate executable, staged app, fixtures, settings) of this source equals the key of those earlier runs.

### The regression found in this change and how it was resolved

The first conversion to an SDK-style project, without the accessibility switches, was run over the whole suite (thread `wf-20261002T092001Z-a66d027d`, 12.1 min, exit 2):

- 11 cases: capture 0, coverage valid, compare 0, every row within the threshold.
- build-facemage_Sam (`20261002T092209Z-f188aae8`): capture 1, coverage valid; 13 passed, 1 failed (`right-other-info`, 0.000163 of the pixels); compare 1, 1 discrepancy in 1 group, completeness 16 planned, 14 reported, 2 optional absent. The candidate draws a dotted focus rectangle around the selected "Other Info" tab; the canonical capture has none. Cluster `d-2e08f56e132cf5a2`: the hypothesis job abstained (`focus or timing during the automated run`), so `Loop d-2e08f56e132cf5a2: abstained after 0 attempts`.
- build-Skull Carver - precareer (`20261002T093023Z-b6fb3757`): capture 2, coverage INVALID, candidate action 0 failed with `pointer: the pointer moved … during the side` (passed when run again: `20261002T093746Z-49edfe44`, capture 0, valid, 13 passed).
- `Outcome: findings_remaining; 0 of 1 clusters fixed`.

A second thread (`wf-20261002T093646Z-57d7ea3a`, `--recapture --case "build-facemage_Sam,build-Skull Carver - precareer"`, exit 1) reproduced the rectangle (`20261002T093649Z-f1630340`: capture 1, valid, 13 passed, 1 failed). The hypothesis (a focus cue on `tabInfo`) predicted the rectangle on facemage and rigger; its check capture `20261002T093956Z-cbbd1673` (status 0, valid; canonical side live) runs only the actions up to the predicted captures, and both matched, so the cluster ended `refuted`.

**Deviation from the rule that the loop resolves each regression.** The loop did not resolve this one: the hypothesis abstained and then was refuted, so no repair ran, and no fix change was archived in `fixes/openspec/changes/archive/`. The cause is in what the check does: the rectangle appears only after the full action sequence of the case, which a check capture, filtered to the actions before the predicted captures, never runs. The fix, the five switches in `Chummer/app.config`, was written by hand after the repeated runs below. The benchmark item `workflow/evals/benchmark/d-2e08f56e132cf5a2-a255fb3c41b4.json` (`kind: fix`, mechanism `rendering`, the regression naming the commit that converted the project) records that accepted fix; `benchmark add` graded the cluster's three earlier answers: mechanism right 1, abstained 2, symbol and file right 0.

Repeated full runs of the case with `npm.cmd run parity -- --case build-facemage_Sam --settings-overlay out/overlays/fixture-books --canonical-cache <cache>` (canonical from the cache), alternating the executables:

| Candidate | Runs | Rectangle |
|---|---|---|
| SDK project, no switches | `20261002T094558Z-a8b62a63` pass, `20261002T094734Z-aacdaf50` FAIL, `20261002T094957Z-98cf63bd` pass, `20261002T095221Z-b3c387ba` FAIL | 2 of 4 (4 of 6 with the two workflow runs) |
| Old project at the base of this change | `20261002T094832Z-7ea56572`, `20261002T095055Z-3aef2e29`, `20261002T095319Z-f05b13d1` | 0 of 3 |
| SDK project, switches 1 to 5 in the `.config` | `20261002T095529Z-265fe9e2`, `20261002T095703Z-c88267c2`, `20261002T095829Z-e8208ee1`, `20261002T095955Z-7d94732a` | 0 of 4 |

Every one of these runs had capture coverage valid with 0 failures. With only levels 1 to 3 set, the candidate exited at startup (`20261002T095456Z-166629bb`, `20261002T095459Z-e9048483`, `20261002T095502Z-c20db9c1`: capture 2, `Process … exited with code -532462766 before showing a window`); the Application event log showed `System.NotSupportedException at System.AccessibilityImprovements.ValidateLevels()` from `ToolStrip..ctor` in `frmMain.InitializeComponent`. The installed `System.Windows.Forms` defines `AccessibilityImprovements.Level1` to `Level5`. A configuration with levels 1 to 4 failed the whole suite the same way (thread `wf-20261002T100303Z-ea7a83ac`, exit 2: every one of the 13 candidate sides exited at startup with that `NotSupportedException`, capture 2, coverage INVALID, 250 planned captures execution-lost); the check that had approved it took a process still running after six seconds for a started app, while the Windows error dialog held the process. Five levels start.

### Earlier whole-suite run with the five switches

Thread `wf-20261002T100613Z-219e15cf`, 24.5 min, exit 2: 9 cases clean; `career-Шпала - карьера` had one failed row (`character-info`, the selected tab's caption not painted; cluster `d-decdfb78d6068d99`, hypothesis a capture before the repaint, check `confirmed` for non-recurrence, both repair attempts `no_plan`, `Loop d-decdfb78d6068d99: repair_rejected after 2 attempts`); three cases had capture status 2 from outside the app (the pointer moved during a side twice, and a `BlueSoleil Warning` window took the foreground). The four affected cases passed when run again once to classify them (thread `wf-20261002T103258Z-63f3d186`, `verified_for_scope`). The caption was a repaint race of the capture that did not recur in this change's whole-suite run above.

## Archive

`npx openspec archive modernize-chummer-build --yes` printed `Specs updated successfully.` and `Change 'modernize-chummer-build' archived as '2026-10-02-modernize-chummer-build'.`; the new `openspec/specs/chummer-build/spec.md` got its purpose, and `npm run openspec:validate` then printed `Totals: 12 passed, 0 failed (12 items)`.

## Unverified

- The regression of the SDK conversion was not resolved by the loop and has no archived fix change (see the deviation above); the hand-written fix is covered by the whole-suite run and the repeated facemage runs, and by the benchmark item.
- A quota wait was not observed live: no model job ran in the whole-suite run.
- The `Tools` menu without the Omae item: no case opens the menu, so no capture shows it; covered only by the build metadata (no `mnuToolsOmae`).
- The update window's decompression of downloaded data files after moving `Decompress` into `frmUpdate`: the method body is unchanged and compiles, but no run downloads an update.
- The Debug configuration (`ChummerGenSR4_Debug`): not built.
- A build with the `dotnet` CLI instead of Visual Studio's MSBuild: not supported and not tried.
- A machine without .NET Framework 4.8.1: not tried; the app is expected to refuse to start there.
- A first restore on a machine with an empty NuGet cache: the restore of the reference assembly package was not observed writing to the cache.
- The canonical side of the case captures came from the cache in every run; the canonical executable did not run live in the whole-suite run.
- Whether the rendering differences of the accessibility improvements extend beyond the focus rectangle: the switches turn all of them off, so the suite cannot show the others.
- Behaviour of the .NET Framework that is keyed on the target framework and does not show in a screenshot: the target moved from 4.0 Client to 4.8.1, and only the accessibility improvements were switched back. Other quirks that new targets turn on, for example Ctrl+A selecting all text in multiline text boxes (`Switch.System.Windows.Forms.DoNotSupportSelectAllShortcutInMultilineTextBox`) and the path handling changes of 4.6.2 (`Switch.System.IO.UseLegacyPathHandling`, `Switch.System.IO.BlockLongPaths`), were not examined or pinned, and no capture would show them.
- Diagnosis, repair and widening did not run live on the final source: the whole-suite run had no discrepancies, so task 2.1's loop steps held vacuously. Widening and repair were not exercised in this change; the loop's behaviour on the regression and on the repaint race is recorded above from earlier runs.
- The Rider measurements are one machine, one Rider version and one run each; the tools outside the refactorings were listed, not exercised, and the measurements used copies, not worktrees of this repository.
