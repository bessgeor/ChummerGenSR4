# Proposal

## Why

Everything in the Chummer app lives in one Windows Forms executable, including the classes that have nothing to do with windows: the data file loader (`XmlManager`), the global and character options, the language manager and the list items the drop-downs show. They reach into Windows Forms only for a few things (the executable's folder, message boxes, the main window and the translation of controls), yet that is enough to make them unusable without the user interface. A class library without Windows Forms, holding these classes with their history, and a few small interfaces through which it reaches the application, gives the app's model code a home that does not depend on the user interface.

## What Changes

- Add `Core/Core.csproj`: an SDK-style net481 class library `ChummerGenSR4.Core` in the `Chummer` namespace that references only `mscorlib`, `System`, `System.Core` and `System.Xml`, so no Windows Forms or drawing type can be used in it. The app references it, and `ChummerGenSR4.Core.dll` is built beside the executable.
- Add the interfaces through which the library reaches the application: `IApplicationHost` (the executable's folder, message boxes, quitting, and the translation of forms and user controls), registered once in `ApplicationHost.Current` when the app starts, and `IMainForm` (opening a character), which the main window implements. The app's Windows Forms implementations are `WinFormsApplicationHost` and `ControlTranslator`; the latter holds the control translation that `LanguageManager` did itself, unchanged.
- Move `XmlManager`, `GlobalOptions`, `CharacterOptions`, `SourcebookInfo`, `ClipboardContentType`, `MRUChangedHandler`, `LanguageManager`, `ListItem` and `SortListItem` into the library as file moves that git detects as renames (`Core/XmlManager.cs`, `Core/Options.cs`, `Core/LanguageManager.cs`, `Core/ListItems.cs`). Each type exists once, in the library; the tree, list view and column sorters, which work on Windows Forms items, stay in the app.
- `GlobalOptions` no longer holds the cyberware and bioware grade lists, which belong to the equipment: they become static members of `GradeList` itself (`GradeList.CyberwareGrades` and `GradeList.BiowareGrades`), loaded from the same data files when the type is first used, and the code that read them from `GlobalOptions` reads them there.
- `build-candidate.mjs` builds the app with the library from the same source folder; the library keeps its intermediate files in a folder of its own below the one the script gives.
- The parity workflow treats `Chummer/` and `Core/` together as the compiled source: the source identity a candidate build records, the source snapshot, the repair guard and plans, the widened source and the commits on the accepted branch all cover both. The diagnosis and repair prompts name both folders, so their prompt versions change (`hypothesis-v2`, `challenge-v2`, `repair-v3`, `repair-plan-v2`, `repair-task-v2`).

Area: the Chummer app (a new class library, the moved classes and the app's side of the new interfaces), its build tooling (`parity/scripts/build-candidate.mjs`) and the parity workflow's view of the source. Evidence: the candidate builds; the metadata of the executable and the library together holds the same types as a build of the previous source, each once, with the moved ones in the library and no Windows Forms reference in it; every move is a git rename of at least 90% similarity; the workflow's tests cover the second source folder; and a live `npm start` run of the whole case suite with diagnosis, repair and widening compares the candidate with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

- `core-library`: the class library without Windows Forms: what it references, which types it holds, how it reaches the application, and that forms are still translated.

### Modified Capabilities

- `chummer-build`: candidate builds include the library, from the repository and from a source copy.
- `discrepancy-diagnosis`: the recorded source identity and the snapshot cover `Chummer/` and `Core/`; new prompt versions.
- `isolated-repair`: the patch guard and plans accept files under `Core/`; new prompt versions.
- `deterministic-widening`: the widened source and the commits on the accepted branch hold `Core/` as well.
- `fix-changes`: a fix commit without a fix change holds only the compiled source.
- `agent-evaluation`: eval runs measure the new hypothesis prompt version.

## Impact

- New: `Core/` (`Core.csproj`, `IApplicationHost.cs`, `ApplicationHost.cs`, `IMainForm.cs`), `Chummer/WinFormsApplicationHost.cs`, `Chummer/ControlTranslator.cs`, `Chummer/Sorters.cs`.
- Moved: `Chummer/clsXmlManager.cs`, `clsOptions.cs`, `clsLanguageManager.cs`, `clsListItems.cs` to `Core/`.
- Changed: `Chummer/Chummer.csproj` (project reference), `Chummer/Program.cs` (host registration), `Chummer/frmMain.cs` (`IMainForm`), `Chummer/clsEquipment.cs` (the grade lists) and the readers of the grade lists in `clsImprovement.cs`, `frmCreate.cs`, `frmSelectCyberware.cs` and `frmTest.cs`, `ChummerGenSR4.sln`, `parity/scripts/build-candidate.mjs` (comments), `workflow/src/` (compiled source folders, prompts) and its tests, `AGENTS.md`.
- The release output gains `ChummerGenSR4.Core.dll` beside `ChummerGenSR4.exe`; the capture runner already stages every file of the candidate's folder.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
