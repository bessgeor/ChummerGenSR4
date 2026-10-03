# Proposal

## Why

`Chummer/clsCharacter.cs` holds `Character`, the whole character: its attributes, items, equipment, improvements and their totals, and how it saves, loads and prints itself. Its items and equipment already live in the class library, but the character itself lives in the Windows Forms executable, although it uses Windows Forms only for a few things: the application's version and folder, one error message, decoding a mugshot image to write it beside the printout, the print preview window, throw-away tree nodes when it converts qualities of old save files, and the app's item searches. Its expense log entries and stacked foci live in the app for no other reason. With two more members on the application host, the searches in a class of their own, and the print preview window kept by a view model of the character in the app, the character can live in the library, complete and unchanged in what it does, and the character windows work on that view model.

## What Changes

- Separate the item searches of `CommonFunctions` (`FindGear` to `FindMartialArtManeuver`) into `ItemFinder` in `Chummer/ItemFinder.cs`, without changing their code; `CommonFunctions` derives from it, so every call of a search stays as it is.
- `IApplicationHost` adds `ProductVersion`, the application's product version, and `SaveImage`, which decodes an image and writes it to a file in its own format, as the drawing library does. The app's host answers them with `Application.ProductVersion` and `Image.FromStream(…).Save(…)`.
- Add `CharacterViewModel` in the app: it holds a character and the character's print preview window, and prints the character into it (the former `Character.Print` and `Character.PrintWindow`). `frmCreate` and `frmCareer` are created from a view model and print and refresh the preview through it; the preview window keeps the view models it shows and clears their window when it closes.
- In place, `Character` reaches the application only through `ApplicationHost.Current` (the product version it saves, the error it shows for a file of another game edition, the folder and image writer of its printed mugshot), searches its items with `ItemFinder`, converts old qualities with tree nodes of the library that are never shown (`UnshownTreeNode`) and creates the weapons they grant itself, and drops its Windows Forms and drawing `using` lines.
- Move `Chummer/clsCharacter.cs`, `Chummer/clsExpenses.cs`, `Chummer/StackedFocus.cs` and `Chummer/ItemFinder.cs` into the library (as `Core/Character.cs`, `Core/Expenses.cs`, `Core/StackedFocus.cs` and `Core/ItemFinder.cs`) as file moves that git detects as renames.
- The C# tests test the never-shown tree node without a host, and, in the project that registers a host, a character saved and loaded through the host, a file of another game edition, a printed mugshot, a quality of an old save file, the item searches and the extension methods of the app with the library's character instead of a stand-in.

Area: the Chummer app (the moved character, its view model, the host's new members) and its C# tests. Evidence: the candidate builds; the metadata of the executable and the library together holds the same types as a build of the previous source, each once, with the moved types in the library and the view model in the app; each move is a git rename of at least 90% similarity; unit tests run the moved code with and without a registered host; and a live `npm start` run of the whole case suite with diagnosis, repair and widening compares the candidate with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-library`: the library also holds the character, its expense log, its stacked foci and the item searches; the application host gains the product version and the image writer; the character windows work on a view model of the character.

## Impact

- New: `Chummer/CharacterViewModel.cs`, `Core/UnshownTreeNode.cs`, `Core/Character.cs`, `Core/Expenses.cs`, `Core/StackedFocus.cs` and `Core/ItemFinder.cs` (the last four moved), tests in `parity/tests/Parity.Tests` and `parity/tests/Parity.Hosted.Tests`.
- Moved: the item searches out of `Chummer/clsCommon.cs` into `Chummer/ItemFinder.cs`, and that file, `Chummer/clsCharacter.cs`, `Chummer/clsExpenses.cs` and `Chummer/StackedFocus.cs` to `Core/`.
- Changed: `Core/IApplicationHost.cs` and `Chummer/WinFormsApplicationHost.cs` (the two members), `Chummer/clsCommon.cs` (derives from `ItemFinder`), `Chummer/frmCreate.cs`, `Chummer/frmCareer.cs`, `Chummer/frmMain.cs` and `Chummer/frmViewer.cs` (the view model), and the test hosts.
- `Character` loses `Print` and `PrintWindow`, which the view model takes over; `frmCreate`, `frmCareer` and `frmViewer.Characters` take view models. No other public member of a moved type changes its name or signature. The release output keeps the same two files.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
