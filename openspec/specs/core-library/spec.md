# core-library Specification

## Purpose
Defines the class library the Chummer app is built with: that it cannot use Windows Forms, which types it holds, how it reaches the application through registered interfaces, and that forms are still translated.

## Requirements

### Requirement: The library cannot use Windows Forms
`Core/Core.csproj` SHALL be an SDK-style class library targeting `net481` with `AssemblyName` `ChummerGenSR4.Core` and `RootNamespace` `Chummer`. It SHALL turn off the implicit framework references and reference only `mscorlib`, `System`, `System.Core` and `System.Xml`, taking the reference assemblies from the `Microsoft.NETFramework.ReferenceAssemblies` package. The app SHALL reference it with a project reference, and every build of the app SHALL put `ChummerGenSR4.Core.dll` beside `ChummerGenSR4.exe`.

#### Scenario: Built library
- **WHEN** the candidate is built
- **THEN** `ChummerGenSR4.Core.dll` is in the candidate's folder and its assembly references are among `mscorlib`, `System`, `System.Core` and `System.Xml`, with no `System.Windows.Forms` and no `System.Drawing`

#### Scenario: A Windows Forms type in the library
- **WHEN** a source file under `Core/` uses a type from `System.Windows.Forms`
- **THEN** the build fails with a compile error, and no executable is reported as built

### Requirement: The library holds the data, options, language and list item types
The library SHALL define `XmlManager`, `GlobalOptions`, `CharacterOptions`, `SourcebookInfo`, `ClipboardContentType`, `MRUChangedHandler`, `LanguageManager`, `ListItem` and `SortListItem` in the namespace `Chummer`, in `Core/XmlManager.cs`, `Core/Options.cs`, `Core/LanguageManager.cs` and `Core/ListItems.cs`. Each of these files SHALL have reached the library by a commit in which git detects it as a rename of the app's former file with at least 90% similarity. No type SHALL be defined both in the library and in the executable. `SortByName`, `SortByDate` and `ListViewColumnSorter`, which compare Windows Forms items, SHALL stay in the app. `GlobalOptions` SHALL NOT hold the cyberware and bioware grade lists: the app's `GradeList.CyberwareGrades` and `GradeList.BiowareGrades` SHALL hold the grades of `cyberware.xml` and `bioware.xml`, in that file order, filled when `GradeList` is first used.

#### Scenario: Types of the build
- **WHEN** the types of `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` of a candidate are listed
- **THEN** the moved types appear only in the library, the sorters only in the executable, and every other type of a build of the source before the move appears once

#### Scenario: Cyberware grades
- **WHEN** a character with cyberware and bioware of several grades is opened
- **THEN** each item shows the grade it was saved with, taken from the grades of `cyberware.xml` or `bioware.xml`, and its window looks as on the canonical executable

#### Scenario: History of a moved file
- **WHEN** `git log --follow Core/Options.cs` runs
- **THEN** it lists the commits of `Chummer/clsOptions.cs` before the move

### Requirement: The library reaches the application only through registered interfaces
The library SHALL reach the application only through `IApplicationHost` (the executable's folder, an error message, an information message, a yes/no question, quitting, and the translation of a form or user control) and `IMainForm` (opening a character file). The app SHALL register its host in `ApplicationHost.Current` as the first statement of `Program.Main`. Reading `ApplicationHost.Current` before a host is registered SHALL throw an `InvalidOperationException` that names the missing registration, registering a second host SHALL throw an `InvalidOperationException` and leave the first in place, and registering `null` SHALL throw an `ArgumentNullException`; there SHALL be no default host. `GlobalOptions.MainForm` SHALL be an `IMainForm`, which the main window implements and registers. `IMainForm.LoadCharacter` SHALL be the only place that declares the defaults of the optional arguments (`true`, an empty name and `false`); the main window's own `LoadCharacter` SHALL take all four arguments, so that a call through the interface and a call on the window cannot differ. The app's host SHALL behave as the moved code did: the executable's folder is `Application.StartupPath`, an error is a `MessageBox` with `OK` and the error icon, an information message one with `OK` and the information icon, a question one with `Yes` and `No` and the question icon whose answer is yes only for `Yes`, and quitting is `Application.Exit`.

#### Scenario: No host registered
- **WHEN** code touches `LanguageManager.Instance` before a host is registered
- **THEN** the type initialiser fails with the `InvalidOperationException` naming `ApplicationHost.Current`, the handling of a missing language file does not run, and no language or data file is read

#### Scenario: Second registration
- **WHEN** a host is registered while another one is
- **THEN** it throws an `InvalidOperationException` naming the registration, and `ApplicationHost.Current` is still the first host

#### Scenario: Missing settings file
- **WHEN** a character whose settings file does not exist is opened
- **THEN** the app asks with the same yes/no message box as before whether to use the default settings, and on `No` shows the same error message box and cancels the opening

#### Scenario: Opening a character from a contact
- **WHEN** a linked character is opened from a contact, spirit or pet
- **THEN** the main window loads it as before

### Requirement: Forms are still translated
`LanguageManager.Load(language, object)` SHALL load the selected language once, as before, and then hand the object to the host's control translation, except after a language file that could not be loaded. The app's control translation SHALL translate a `Form` or `UserControl` exactly as `LanguageManager` did before the move: every control whose tag names a string gets that string's text, through panels, tab pages, both panels of a `SplitContainer` and flow layout panels, list view column headers, status strip labels and the top-level tree nodes whose tag starts with `Node_`; a missing string leaves the tag as the text, and throws instead when the app was started with `/debug`. Any other object, or none, SHALL be left untranslated.

#### Scenario: Window captions from the language file
- **WHEN** a character window is opened in English
- **THEN** its labels, buttons, tabs and column headers show the texts of `lang/en-us.xml` for their tags, and its captures match the canonical executable's

#### Scenario: Options handed to the language manager
- **WHEN** the character options call `LanguageManager.Load` with themselves
- **THEN** nothing is translated and no error is raised
