# Design

## Context

`Chummer/clsCharacter.cs` (about 6,100 lines) holds `Character` and the twelve event handler delegates of its changes, which are declared outside any namespace. Besides the library's types, it uses these types of the app and the framework:

| What | Where |
|---|---|
| `Application.ProductVersion` | `Save` writes it, without a leading `0.0.0.`, as the file's `appversion` |
| `MessageBox` | `Load` shows an error message with `OK` and the error icon and returns `false` when the file's game edition is set and is not `SR4` |
| `Application.StartupPath`, `Image` | `PrintToStream` decodes the base64 mugshot with `Image.FromStream`, writes it with `Image.Save` to `mugshots/<new guid>.img` in the executable's folder (creating the folder) and prints that file's URL |
| `frmViewer` | `Print` writes the printout, opens the preview window for this character (as a dialogue or not) or, when the character has one, activates and refreshes it; `PrintWindow` holds the window, which clears it when it closes |
| `TreeNode` | the conversion of qualities from old save files creates each quality with a new tree node and lists for the weapons it grants and their nodes; it keeps the weapons and drops every node |
| `CommonFunctions` | the three gear searches of `ICharacter` call `FindGear`, `FindGearByWeaponID` and `FindVehicleGear` on the character's gear and vehicles |
| `ExpenseLogEntry`, `ExpenseType` (`clsExpenses.cs`), `StackedFocus` | the expense log and the stacked foci, which use only the library's types and `Character` |

`CommonFunctions`' searches (`FindGear` to `FindMartialArtManeuver`) use only the library's items and the character, which they pass to the constructors of the empty items they start from; its other members work on Windows Forms trees and menus or open files.

## Goals / Non-Goals

**Goals:**
- `Character`, its delegates, the expense log, the stacked foci and the item searches in the library, unchanged in what they do, save, load and print.
- A view model of the character in the app that holds what the character windows need of Windows Forms beside the character, and the character windows created from it.
- The app behaving and looking exactly as before; every type defined once across the executable and the library.

**Non-Goals:**
- Changing how the character windows read, show and change the character's values: they read them from the view model's character, as they read them from the character before.
- Changing `ICharacter`, `IImprovementCharacter` or the items, which keep reaching the character through these interfaces.
- Moving `CommonFunctions`' tree, menu, deletion and file members, or any window or control.
- Changing the moved code beyond what reaching the application through the host requires: no renames, no cleanup of its logic.
- Touching the canonical `bin/ChummerGenSR4.exe`.

## Decisions

1. **The searches in a class of their own.** The searches are cut out of `clsCommon.cs` unchanged into `ItemFinder`, which holds the character in the protected read-only field `_objCharacter` that `CommonFunctions` used. `CommonFunctions` derives from it and passes its character on, so `objFunctions.FindGear(…)` and every other search call stays as it is, and `CommonFunctions`' own members keep using the same field. Alternative: forwarding methods on `CommonFunctions` would add some thirty members that do nothing; moving only the three searches that the character uses would divide the searches between two classes, since `FindVehicleGear` also needs `FindWeaponGear` and `FindCyberwareGear`.
2. **Two members on the host.** `IApplicationHost.ProductVersion` returns `Application.ProductVersion` in the app, so that the library saves the executable's version and not its own. `IApplicationHost.SaveImage(bytes, path)` decodes the image with `Image.FromStream(stream, true)` and saves it with `Image.Save(path)`, which writes the image in its own format and may encode it again; writing the bytes straight to the file would differ for such images. The error for another game edition uses the host's existing `ShowError`, which is the same message box, inside the same `try` block as before. The mugshot folder is the host's `StartupPath`, which is `Application.StartupPath`.
3. **A tree node that is never shown.** The quality conversion cannot create Windows Forms nodes in the library, and drops every node it creates. The library's `UnshownTreeNode` implements `ITreeNodeView` in memory (text, tag, grey flag, children, expansion count) and is what the conversion creates its quality nodes with. The weapons the converted qualities grant are created by the character as the app's host created them: a `Weapon` of this character created from its data node into a new node of the quality's node without context menus (`objNode.NewNode` for each child node function), its node shown in grey and dropped, the weapon kept for the character's weapon list. Alternative: asking the host to create the weapon would need a Windows Forms node, which the app's host requires, for a node that nobody sees.
4. **The view model holds the print preview.** `CharacterViewModel` takes a character and exposes it as `Character`, holds the preview window in `PrintWindow`, and has `Print(blnDialog)`, the former `Character.Print` with `PrintToStream` called on its character and the window opened for this view model. `frmViewer.Characters` becomes a list of view models: the window prints their characters and clears their `PrintWindow` when it closes, as it did with the characters. `frmCreate` and `frmCareer` take a view model, keep it, set `_objCharacter` to its character, and print and refresh the preview through it; `frmMain` creates a view model for each character it opens or creates. Alternative: a view model that forwards every member of the character would change every one of the windows' thousands of reads of the character without changing what they do.
5. **Move order.** Each step builds and keeps the app's behaviour, and each is a commit of its own:
   1. the searches cut out of `clsCommon.cs` into `Chummer/ItemFinder.cs`;
   2. the host's two members, their implementation in the app, and the test hosts;
   3. the view model, with `Print` and `PrintWindow` moved from the character into it and the windows created from it;
   4. in place, in `clsCharacter.cs`: the version, the error, the mugshot and the searches through the host and `ItemFinder`, the quality conversion with `UnshownTreeNode`, the Windows Forms and drawing `using` lines removed;
   5. `clsCharacter.cs`, `clsExpenses.cs`, `StackedFocus.cs` and `ItemFinder.cs` moved unchanged to `Core/`;
   6. tests of the moved code with and without a host.
   The moved files keep their BOM (where they have one) and CRLF line endings; new files are stored with CRLF like the other source files.

## Risks / Trade-offs

- **A different saved file or printout.** Mitigation: the saved version comes from the same `Application.ProductVersion`, the mugshot is written by the same drawing calls in the app, and hosted tests save and load a character and print a mugshot through a recording host and check the written values.
- **An old save file converted differently.** Mitigation: the converted qualities are created by the same `Create` with the same arguments; only the never-shown nodes change type. A unit test checks the never-shown node, and a hosted test loads a quality in the old format that grants a weapon; no fixture is an old save file, so no live run converts one.
- **The preview window lost or shared.** Mitigation: each character window keeps its own view model for the character it was opened with, and the preview window clears the view models it was opened for, as it cleared the characters. No case prints, so this is covered by the build and review only.
- **Hosted tests that need settings.** The library's character reads the character options, which read `settings/default.xml` from the host's folder or else the registry. The hosted tests write a copy of `bin/settings/default.xml` into their folder, so they never read or write the registry.

## Verification

Fixture-tested (no desktop): the candidate build at each step; a listing of the types of the executable and the library compared with a build of the source before this change; the rename similarity of the move commit; unit tests of the never-shown node without a host; hosted tests that save and load a character, load a file of another game edition, print a mugshot, convert a quality of an old save file, search gear and create weapons and vehicles through the app's extension methods with the library's character.

Only a live run proves that the app starts, opens every case's character from its saved file, and draws every captured window as the canonical executable does: `npm start` over the whole case suite with diagnosis, repair and widening, recording the canonical SHA-256 before and after, execution outcomes apart from visual results, and the loop's outcome for any discrepancy.
