# Verification

All runs on Windows 10 (build 19045, 1920x1080), .NET Framework 4.8.1, Visual Studio 2019 Build Tools MSBuild 16.11, .NET SDK 10.0.401, Node.js 22.17.0.

The live evidence was collected on a source whose `Chummer/`, `Core/` and `parity/` trees are those of the final commit (`git rev-parse HEAD:Chummer` prints `5bfd95f517f48d25122a1bd6c5bfb0e13d408a23`, `HEAD:Core` prints `548cc7175f3134fe472c21f635ffb5cd89847b2f` and `HEAD:parity` prints `5cd2e37aaa7e9ce9e5d4c224d3cb944a37acae2a`), so the app, its build and the capture and compare tools are those of the evidence. Its `workflow/` tree differed from the final one only in how the prompts of model jobs get their list of source folders (`workflow/src/diagnosis/` and `workflow/src/evals/`), a doc comment in `workflow/src/repair/attempt-host.ts` and the tests of these; no model job ran in the live run. The commits after the live run change only these workflow files, the change folder and `openspec/specs/`, which no build or capture reads.

## Checks

Run on the final source:

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 13 passed, 0 failed (13 items)` |
| `npm run workflow:typecheck` | no output, exit 0 |
| `npm run workflow:test` | `# tests 312`, `# pass 312`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 186` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# pass 8`, `# fail 0` |

## Fixture-tested scope (builds, metadata and git, no desktop)

Every build went through `parity/scripts/build-candidate.mjs`, which printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` each time. The baseline is a build of the source before this change (`82896ec`) into a folder under `out/`. Types were listed with a reader of the ECMA-335 metadata (`System.Reflection.Metadata`): every type definition with its declaring type and the number of its methods and fields, and every assembly reference.

- Library and host (task 1.1): the candidate build printed `Core -> …\out\candidate\bin\ChummerGenSR4.Core.dll` and `Chummer -> …\out\candidate\bin\ChummerGenSR4.exe`, with no warning. A copy of the 294 files git lists under `Chummer/` and `Core/`, outside the repository, built with `--source <copy> --output <folder>`: exit 0, `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` in `<folder>/bin/`, the library's restore files (`Core.csproj.nuget.*`, `project.assets.json`) in `<folder>/obj/Core/` beside the app's in `<folder>/obj/`, and still 294 files in the copy. The same copy without `Core/`: `error CS0246: The type or namespace name 'IMainForm' could not be found` (and `'IApplicationHost'`), `MSBuild failed with exit code 1.`, exit 1.
- Host registration (task 1.1): `ApplicationHostTests` in `parity/tests/Parity.Tests`, which references the library, passed. In one test, because the host is process-wide state, it reads `ApplicationHost.Current` before any registration (an `InvalidOperationException` naming `ApplicationHost.Current`), reads `LanguageManager.Instance` (a `TypeInitializationException` whose inner `InvalidOperationException` names `ApplicationHost.Current`), registers `null` (an `ArgumentNullException`), registers a host that records its calls (none was made, so the language manager's handling of a missing language file did not run), and registers a second host (an `InvalidOperationException` saying one is already registered, with the first still current).
- Workflow (task 1.2): `npm run workflow:test` passed 312 of 312. New tests: an accepted source or a widened source without `Core/` is a setup error naming it, in the widened source and in the accepted branch's commit, and a folder to commit that the widened source lacks is a setup error; the hypothesis prompt names only the compiled folders that the snapshot holds, so a snapshot with `Chummer/` alone is described as before. Earlier new tests: a snapshot copies `Core/` and an edit under `Core/` changes the compiled identity; a patch of `Core/XmlManager.cs` applies to a widened source holding both folders, and the accepted branch's source commit holds the snapshot's `Core/` and the fix commit changes only `Core/XmlManager.cs`. Extended tests: the guard passes `Core/XmlManager.cs` and refuses `CoreExtra/a.cs` and `bin/data/skills.xml` as `outside Chummer/ and Core/`; a plan may name `Core/XmlManager.cs`; the hypothesis and repair prompts start with `PROMPT_VERSION=hypothesis-v2` and `PROMPT_VERSION=repair-v3` and name `Chummer/ and Core/` as the C# source; the certificate, eval run and priors tests carry the new versions.
- Moves (tasks 1.3 and 1.5): `git show -M90% --name-status` of the move commits prints `R091 Chummer/clsListItems.cs Core/ListItems.cs`, and `R096 Chummer/clsLanguageManager.cs Core/LanguageManager.cs`, `R096 Chummer/clsOptions.cs Core/Options.cs`, `R097 Chummer/clsXmlManager.cs Core/XmlManager.cs`. Each move commit only drops the `using System.Windows.Forms;` line of each file, and the files keep their BOM and CRLF line endings in the index. The files this change adds (`Core/*.cs`, `Core/Core.csproj`, `Chummer/Sorters.cs`, `Chummer/ControlTranslator.cs`, `Chummer/WinFormsApplicationHost.cs`) are stored with CRLF too: `git ls-files --eol` prints `i/crlf` for each of them. `git log --follow Core/LanguageManager.cs` and `Core/ListItems.cs` list the commits of the former files. Over the whole branch, `git diff -M90%` against the base pairs only `Options.cs` and `XmlManager.cs`, because the preparation commits removed the control translation from `clsLanguageManager.cs` and the sorters from `clsListItems.cs` before their moves.
- Preparation (task 1.4): the candidate built after routing the Windows Forms calls through the host and after moving the grade lists. Before the move, a search of `clsLanguageManager.cs`, `clsXmlManager.cs` and `clsOptions.cs` for `MessageBox`, `Application.`, `Form`, `UserControl`, `frmMain`, `TreeNode`, `ListView` and `DialogResult` found only their `using System.Windows.Forms;` lines, comments and `IMainForm`; after the grade-list commit none names `GradeList`. A first attempt to move the three files before the grade lists moved failed to compile (`Options.cs(98,17): error CS0246: The type or namespace name 'GradeList' could not be found`); the move was undone before it was committed, and the grade lists were moved first.
- Types (task 1.5): the final candidate's `ChummerGenSR4.Core.dll` references `mscorlib` and `System.Xml` only; `ChummerGenSR4.exe` references `mscorlib`, `System`, `System.Core`, `System.Drawing`, `System.Windows.Forms`, `System.Windows.Forms.DataVisualization`, `System.Xml` and `ChummerGenSR4.Core`. The library defines `MRUChangedHandler`, `ApplicationHost`, `IApplicationHost`, `IMainForm`, `LanguageManager` (with `LanguageString`), `ListItem`, `SortListItem`, `ClipboardContentType`, `SourcebookInfo`, `GlobalOptions`, `CharacterOptions` and `XmlManager` (with `XmlReference`). No type name is defined in both assemblies except the compiler's `<Module>` and `<PrivateImplementationDetails>`. Against the baseline's 189 types, the two assemblies differ only in:
  - new: `ControlTranslator` and `WinFormsApplicationHost` in the executable; `ApplicationHost`, `IApplicationHost` and `IMainForm` in the library;
  - `GradeList`: one method more (its static constructor) and two fields more (the grade lists);
  - `GlobalOptions`: two fields fewer (the grade lists), the same 40 methods;
  - `LanguageManager`: three methods fewer (`UpdateControls`, `UpdateUserControl`, `UpdateForm`) and one field fewer (`_blnDebug`), which `ControlTranslator` now has; its two compiler-generated closure classes are numbered `20` instead of `24`.
  Every other type has the same name and the same numbers of methods and fields.

## Live evidence

### Whole suite, canonical live, with a deliberate kill and resume

Command: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --fix-changes --live-canonical`, with `settings/default.xml` of the overlay holding the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). `--live-canonical` turns the canonical capture cache off, so the canonical executable ran live in every case beside the candidate: no side of this run came from the cache. `Get-FileHash bin/ChummerGenSR4.exe` printed `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` before the run and after the resumed run ended, and every capture runner call printed the same hash as `Canonical SHA-256 before` and `after`. The candidate built by the workflow had `ChummerGenSR4.exe` SHA-256 `2792c22b74de51b76765d05ea94fa8579d8d209a694f3e57d99e34645f8a9f36` and `ChummerGenSR4.Core.dll` SHA-256 `7eff1c2a4b32319f0500d6fd596a9fc415aa346adadec8471f51cce486513e1b`.

Thread `wf-20261002T132427Z-a23c6965`, all 13 cases, exit 0, `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 39.8 min` (the elapsed time of the resumed session).

- Kill: while the candidate of `career-facemage_Sam_career` was being captured (run folder `20261002T133314Z-c460851e`, whose canonical side had completed, no result), the workflow's process tree was ended with `taskkill /T /F`. The three earlier cases were complete.
- Resume: `npm start -- --resume wf-20261002T132427Z-a23c6965` printed `Resuming thread wf-20261002T132427Z-a23c6965.` and `Taking over the desktop lane from process 33388, which is no longer running.`; the case ran again from the start in `20261002T133536Z-80c52ff6` and the remaining cases followed. The three completed cases were kept, not captured again.
- No model job ran, since there was no discrepancy to diagnose, so no quota wait occurred.

Execution, per case (capture status; coverage; the canonical side ran live in each):

| Case | Run folder | Capture | Coverage |
|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | `20261002T132431Z-8aa824f1` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Шпала - карьера | `20261002T132658Z-8e13d677` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-facemage_Sam | `20261002T133027Z-5d110d4c` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-facemage_Sam_career | `20261002T133536Z-80c52ff6` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-rigger | `20261002T133900Z-e4b19b8a` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| career-rigger_career | `20261002T134139Z-06706061` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-hacker4boegspriet | `20261002T134448Z-760190fb` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| build-technotest | `20261002T134728Z-488634a8` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-technotest - career | `20261002T134948Z-9a35376f` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| career-test_adept | `20261002T135249Z-08525d1f` | 0 | valid, contiguous, 0 failures, 8 optional absent |
| build-spirit | `20261002T135547Z-379b7fed` | 0 | valid, contiguous, 0 failures, 4 optional absent |
| build-Skull Carver - precareer | `20261002T135814Z-1244bedb` | 0 | valid, contiguous, 0 failures, 6 optional absent |
| career-Skull Carver - career | `20261002T140054Z-ca8881b8` | 0 | valid, contiguous, 0 failures, 8 optional absent |

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

Triage found 0 discrepancies in 0 clusters and 0 other findings, so diagnosis, repair and widening had nothing to do (`Diagnosis: 0 clusters`, `Repair: 0 clusters`, `Widening: 0 attempts, 0 promoted, 0 rejected; no accepted branch`). The moves caused no regression in the captured windows, so no fix change was archived and no benchmark item was added.

## Unverified

- The workflow's diagnosis, repair and widening did not run on a cluster in this change: the live run found no discrepancy, and no regression was provoked on purpose. Their handling of `Core/` (snapshot, compiled identity, guard, plans, widened source, accepted branch), the refusal of a source without `Core/` and the new prompt texts are covered by unit tests only; no model saw the new prompts, and the loop's outcome on a regression in the library is unproven.
- A quota wait was not observed live: no model job ran.
- The message boxes the host shows (a missing default language file, a language file that cannot be loaded, a missing settings file, the language file check) are not opened by any case; they are covered by reading the code, which passes the same texts, buttons and icons to `MessageBox.Show`.
- The control translation is seen only in English, where captions come from `lang/en-us.xml` through the controls' tags; no case runs another language or `/debug`.
- The grade lists are now filled when `GradeList` is first used rather than at startup. The cases whose files hold cyberware or bioware grades (for example `build-hacker4boegspriet`, `build-rigger` and the Skull Carver cases) open characters whose windows match, but no case checks the moment the lists are filled.
- The host test runs the library on .NET (the test project's runtime), not on .NET Framework 4.8.1 where the app runs it; the code paths it exercises use no framework-specific behaviour.
- Opening a linked character from a contact, spirit or pet through `IMainForm`: no case does it.
- The Debug configuration and Visual Studio's form designer were not tried.
