## ADDED Requirements

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

## MODIFIED Requirements

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
