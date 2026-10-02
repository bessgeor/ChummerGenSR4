## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: The library reaches the application only through registered interfaces
The library SHALL reach the application only through `IApplicationHost` (the executable's folder, an error message, an information message, a yes/no question, quitting, the translation of a form or user control, and the selection dialogs of the improvements), `IMainForm` (opening a character file) and `IImprovementCharacter` (the members of a character that the improvements read and change, which the app's character implements). The app SHALL register its host in `ApplicationHost.Current` as the first statement of `Program.Main`. Reading `ApplicationHost.Current` before a host is registered SHALL throw an `InvalidOperationException` that names the missing registration, registering a second host SHALL throw an `InvalidOperationException` and leave the first in place, and registering `null` SHALL throw an `ArgumentNullException`; there SHALL be no default host. `GlobalOptions.MainForm` SHALL be an `IMainForm`, which the main window implements and registers. `IMainForm.LoadCharacter` SHALL be the only place that declares the defaults of the optional arguments (`true`, an empty name and `false`); the main window's own `LoadCharacter` SHALL take all four arguments, so that a call through the interface and a call on the window cannot differ. The app's host SHALL behave as the moved code did: the executable's folder is `Application.StartupPath`, an error is a `MessageBox` with `OK` and the error icon, an information message one with `OK` and the information icon, a question one with `Yes` and `No` and the question icon whose answer is yes only for `Yes`, and quitting is `Application.Exit`. Its selection dialogs SHALL open the same windows with the same descriptions, forced values, lists and filters as the moved code did, return the selection, and return `null` exactly when the window's result is `Cancel`; a dialog that needs the character SHALL throw when the character it is given is not the app's character, instead of opening the window without it.

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
