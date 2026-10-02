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
The library SHALL reach the application only through `IApplicationHost` (the executable's folder, an error message, an information message, a yes/no question, quitting, the translation of a form or user control, and the selection dialogs of the improvements), `IMainForm` (opening a character file), `IImprovementCharacter` (the members of a character that the improvements read and change, which the app's character implements), `ICharacter` (the members of a character that the character's items and the app's readers of their character use, which the app's character implements, with the views of a cyberlimb and a skillsoft, which the app's cyberware and gear implement) and `ITreeNodeView` (the text, tag and grey colour of the tree node of a created item, which the app shows on a Windows Forms tree node). The app SHALL register its host in `ApplicationHost.Current` as the first statement of `Program.Main`. Reading `ApplicationHost.Current` before a host is registered SHALL throw an `InvalidOperationException` that names the missing registration, registering a second host SHALL throw an `InvalidOperationException` and leave the first in place, and registering `null` SHALL throw an `ArgumentNullException`; there SHALL be no default host. `GlobalOptions.MainForm` SHALL be an `IMainForm`, which the main window implements and registers. `IMainForm.LoadCharacter` SHALL be the only place that declares the defaults of the optional arguments (`true`, an empty name and `false`); the main window's own `LoadCharacter` SHALL take all four arguments, so that a call through the interface and a call on the window cannot differ. The app's host SHALL behave as the moved code did: the executable's folder is `Application.StartupPath`, an error is a `MessageBox` with `OK` and the error icon, an information message one with `OK` and the information icon, a question one with `Yes` and `No` and the question icon whose answer is yes only for `Yes`, and quitting is `Application.Exit`. Its selection dialogs SHALL open the same windows with the same descriptions, forced values, lists and filters as the moved code did, return the selection, and return `null` exactly when the window's result is `Cancel`; a dialog that needs the character SHALL throw when the character it is given is not the app's character, instead of opening the window without it. The app's tree node view SHALL set the node's text and tag as given and show grey text with `SystemColors.GrayText`.

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

#### Scenario: A forced selection
- **WHEN** a bonus asks for a skill while the manager has a forced value
- **THEN** the skill window is created limited to that skill and with opacity 0, as before, and its selection is returned

#### Scenario: A manager without the application
- **WHEN** a manager is created with selection dialogs of its own and no host is registered
- **THEN** it creates, removes and adds up improvements without reading `ApplicationHost.Current`, the language or the options, also for a value such as `Rating + BOD` or `Rating div 2`

#### Scenario: A metatype quality in the tree
- **WHEN** a quality that comes from the metatype is created with a tree node, and it grants a weapon
- **THEN** the quality's node shows its display name in grey with its identifier as tag, and the weapon is added to the caller's lists with a grey node, as before

### Requirement: Forms are still translated
`LanguageManager.Load(language, object)` SHALL load the selected language once, as before, and then hand the object to the host's control translation, except after a language file that could not be loaded. The app's control translation SHALL translate a `Form` or `UserControl` exactly as `LanguageManager` did before the move: every control whose tag names a string gets that string's text, through panels, tab pages, both panels of a `SplitContainer` and flow layout panels, list view column headers, status strip labels and the top-level tree nodes whose tag starts with `Node_`; a missing string leaves the tag as the text, and throws instead when the app was started with `/debug`. Any other object, or none, SHALL be left untranslated.

#### Scenario: Window captions from the language file
- **WHEN** a character window is opened in English
- **THEN** its labels, buttons, tabs and column headers show the texts of `lang/en-us.xml` for their tags, and its captures match the canonical executable's

#### Scenario: Options handed to the language manager
- **WHEN** the character options call `LanguageManager.Load` with themselves
- **THEN** nothing is translated and no error is raised

### Requirement: The library holds the improvements
The library SHALL define `Improvement` and `ImprovementManager` in the namespace `Chummer`, in `Core/Improvement.cs`, which SHALL have reached the library by a commit in which git detects it as a rename of `Chummer/clsImprovement.cs` with at least 90% similarity; neither type SHALL be defined in the executable. The manager SHALL keep its whole behaviour: it SHALL create the improvements of every bonus node it understood before, ask for the same selections, remove improvements with the flags, grades and Adapsin grades they switch, roll back the improvements of a creation that a cancelled selection stopped and return `false` for it, and add up values with `ValueOf` as before. Its public members SHALL keep their names and signatures, except that it takes the character as an `IImprovementCharacter`, so that every place that creates a manager, with a character or with none, compiles unchanged. A second constructor SHALL take the selection dialogs as an argument and, for every bonus except a sprite selection (which loads `critters.xml` through `XmlManager`), read neither the application host nor the language nor the options. The result of a value that contains `Rating` or an attribute name SHALL be formatted and read in the `en-US` culture, whatever the culture of the thread.

#### Scenario: Types of the build
- **WHEN** the types of `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` of a candidate are listed
- **THEN** `Improvement` and `ImprovementManager` appear only in the library, and every type of a build of the source before the move appears once

#### Scenario: History of the improvements
- **WHEN** `git log --follow Core/Improvement.cs` runs
- **THEN** it lists the commits of `Chummer/clsImprovement.cs` before the move

#### Scenario: A selection in a bonus
- **WHEN** a manager given a character and selection dialogs creates the improvements of a bonus that asks for a text, and the dialogs return a value
- **THEN** the character holds a `Text` improvement for that value, `SelectedValue` is the value, and the call returns `true`

#### Scenario: A cancelled selection
- **WHEN** a selection of a bonus is cancelled after earlier parts of the same bonus created improvements
- **THEN** the call returns `false`, the improvements it created are removed from the character, and the flags they switched on are switched off again

#### Scenario: Removing the last source of a flag
- **WHEN** the improvements of a source that enabled `MAG` are removed and no other source enables it
- **THEN** the character's `MAG` is disabled, while it stays enabled when another source still enables it

#### Scenario: A fractional value on a machine with a decimal comma
- **WHEN** a bonus gives the value `Rating div 2` with rating 3 on a thread whose culture uses a decimal comma, such as Russian
- **THEN** the improvement's value is 1, as it is on a thread whose culture uses a decimal point

#### Scenario: Characters with improvements
- **WHEN** a saved character with qualities, powers, cyberware and gear is opened
- **THEN** its windows show the values its improvements give, and its captures match the canonical executable's

### Requirement: The library holds the character's items
The library SHALL define `Attribute`, `QualityType`, `QualitySource`, `Quality`, `SkillGroup`, `Skill`, `SpiritType`, `Spirit`, `Spell`, `Focus`, `Metamagic`, `Power`, `TechProgram`, `TechProgramOption`, `MartialArt`, `MartialArtAdvantage`, `MartialArtManeuver`, `ContactType`, `Contact`, `CritterPower`, `InitiationGrade`, `CalendarWeek` and `MentorSpirit` in the namespace `Chummer`, in `Core/UniqueModels.cs`, which SHALL have reached the library by a commit in which git detects it as a rename of `Chummer/clsUnique.cs` with at least 90% similarity; none of these types SHALL be defined in the executable. `StackedFocus`, which holds gear, SHALL stay in the app, in `Chummer/StackedFocus.cs`. The items SHALL keep their behaviour: they SHALL save, load and print the same XML and compute the same values as before. Their public members SHALL keep their names and signatures, except that they take and expose the character as an `ICharacter`, that each `Create` method that filled a `TreeNode` SHALL take an `ITreeNodeView` and set its text, tag and grey colour where it set the node's, that `Quality.Create` SHALL take a function that adds a granted weapon and returns its identifier instead of the two lists, and that `Contact.Colour` SHALL be `Contact.ColourArgb`, an ARGB value or `null` when no colour was set. The app SHALL keep each former `Create` signature with a `TreeNode` as an extension method that fills the node through the item's `Create`, so that no call site changes, and SHALL read and set a contact's colour as `Color.Empty` for `null` and as the ARGB colour otherwise. A contact SHALL save `0` as the colour when none was set and its ARGB value otherwise, and a loaded contact SHALL keep the saved value, or `null` when its save data has none.

#### Scenario: Types of the build
- **WHEN** the types of `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` of a candidate are listed
- **THEN** the moved items appear only in the library, `StackedFocus` only in the executable, and every type of a build of the source before the move appears once

#### Scenario: History of the items
- **WHEN** `git log --follow Core/UniqueModels.cs` runs
- **THEN** it lists the commits of `Chummer/clsUnique.cs` before the move

#### Scenario: A contact without a colour
- **WHEN** a contact whose colour was never set is saved and loaded again
- **THEN** its save data holds the colour `0`, and the loaded contact has the ARGB value 0, which the app shows as `Color.FromArgb(0)`, as the canonical executable does

#### Scenario: A contact with a colour
- **WHEN** a contact with a colour is saved and loaded again
- **THEN** its save data holds the colour's ARGB value, and the loaded contact has the same value

#### Scenario: Cyberlimbs modify an attribute
- **WHEN** the character has a cyberlimb in a limb slot
- **THEN** its `AGI`, `BOD` and `STR` attributes report modifiers, and other attributes report modifiers only from their improvements

#### Scenario: Characters with their items
- **WHEN** a saved character with attributes, qualities, skills, spells, powers, complex forms, critter powers, martial arts and contacts is opened
- **THEN** its windows show these items, their values and the contacts' colours, and its captures match the canonical executable's
