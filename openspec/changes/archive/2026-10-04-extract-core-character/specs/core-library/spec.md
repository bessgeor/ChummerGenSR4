## ADDED Requirements

### Requirement: The library holds the character
The library SHALL define `Character` and the twelve event handler delegates of its changes in `Core/Character.cs`, `ExpenseType`, `KarmaExpenseType`, `NuyenExpenseType`, `ExpenseUndo` and `ExpenseLogEntry` in `Core/Expenses.cs`, `StackedFocus` in `Core/StackedFocus.cs`, `ItemFinder` in `Core/ItemFinder.cs` and `UnshownTreeNode` in `Core/UnshownTreeNode.cs`, with the delegates outside any namespace as before and the other types in the namespace `Chummer`. Each of the first four files SHALL have reached the library by a commit in which git detects it as a rename of `Chummer/clsCharacter.cs`, `Chummer/clsExpenses.cs`, `Chummer/StackedFocus.cs` or `Chummer/ItemFinder.cs` with at least 90% similarity, and none of these types SHALL be defined in the executable. The moved types SHALL keep their behaviour: the character SHALL save, load and print the same XML and compute the same values as before. Their public members SHALL keep their names and signatures, except that `Character` SHALL NOT have `Print` and `PrintWindow`, which the app's view model holds. The character SHALL save the application host's product version, without a leading `0.0.0.`, as `appversion`; SHALL show the host's error message and return `false` from `Load`, at the same point as before, when the file's game edition is set and is not `SR4`; and SHALL print its mugshot by writing it through the host's image writer to `mugshots/<new identifier>.img` in the host's folder, creating the folder, and printing that file's URL and the base64 image, or an empty URL when it has no mugshot. When it converts the qualities of an old save file, it SHALL create each quality with an `UnshownTreeNode` and create each weapon the quality grants itself, as a `Weapon` of this character created from its data node into a new node of the quality's node without context menus, add the weapons to its weapon list in the order they were granted and keep no node. `ItemFinder` SHALL hold the searches `FindGear` to `FindMartialArtManeuver` of the former `CommonFunctions` unchanged, and `CommonFunctions` SHALL derive from it, so that every search keeps its name, signature and result. `UnshownTreeNode` SHALL implement `ITreeNodeView` in memory: it keeps its text and tag as set, records that it was shown in grey and how often it was expanded, creates new unshown nodes in no tree, adds nodes as its last children, lists its children in order, and throws an `InvalidCastException` when a node to add is not an `UnshownTreeNode`.

#### Scenario: Types of the build
- **WHEN** the types of `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` of a candidate are listed
- **THEN** the character, its delegates, the expense types and the stacked focus appear only in the library, `ItemFinder` and `UnshownTreeNode` appear once in the library and `CharacterViewModel` once in the executable as new types, and every other type of a build of the source before the change appears once

#### Scenario: History of the character
- **WHEN** `git log --follow Core/Character.cs` runs
- **THEN** it lists the commits of `Chummer/clsCharacter.cs` before the move

#### Scenario: The saved version
- **WHEN** a character is saved
- **THEN** its file's `appversion` is the host's product version without a leading `0.0.0.`, and loading the file again gives the same saved values

#### Scenario: A file of another game edition
- **WHEN** a character file whose game edition is `SR5` is loaded
- **THEN** the host shows the incorrect game version error with its caption once and `Load` returns `false`

#### Scenario: A printed mugshot
- **WHEN** a character with a mugshot is printed
- **THEN** the host's image writer gets the decoded bytes of the mugshot and a path in the `mugshots` folder of the host's folder, and the printout holds that file's URL and the base64 mugshot

#### Scenario: A node that is never shown
- **WHEN** an item fills an `UnshownTreeNode` with text, a tag, grey text, child nodes and expansions
- **THEN** the node holds them in order, its new nodes start empty and in no tree, and adding a node of another kind throws an `InvalidCastException` and adds nothing

#### Scenario: The item searches
- **WHEN** a piece of gear, or a piece plugged into it, is searched by its identifier with `ItemFinder`
- **THEN** it is found, and an identifier that no gear has gives `null`

#### Scenario: A quality of an old save file
- **WHEN** a character file whose quality is saved in the old format, as a name with its cost, is loaded, and the quality grants a weapon
- **THEN** the character has the quality, created from the data file, and the weapon, whose identifier the quality keeps

#### Scenario: Characters from their saved files
- **WHEN** a saved character is opened, in build or in career mode
- **THEN** its window shows the character, its values and its tabs, and its captures match the canonical executable's

### Requirement: The character windows work on a view model
The app SHALL define `CharacterViewModel`, which takes a character, exposes it as `Character`, holds the character's print preview window in `PrintWindow`, and has `Print(blnDialog)`, which writes the character's printout and either opens a preview window for this view model, as a dialogue when `blnDialog` is `true`, or, when the view model already has one, activates and refreshes it. `frmCreate` and `frmCareer` SHALL be created from a view model and SHALL read and change the view model's character, print through the view model and refresh its preview window after a change; `frmMain` SHALL create a view model for each character whose window it opens. `frmViewer.Characters` SHALL be a list of view models, whose characters it prints and whose `PrintWindow` it clears when it closes.

#### Scenario: Opening a character window
- **WHEN** the main window opens a saved or a new character
- **THEN** it creates the character's window from a new view model of that character, and the window shows that character


## MODIFIED Requirements
### Requirement: The library reaches the application only through registered interfaces
The library SHALL reach the application only through `IApplicationHost` (the executable's folder, the application's product version, an error message, an information message, a yes/no question, quitting, writing an image to a file in its own format, the translation of a form or user control, the selection dialogs of the improvements, and the equipment host), `IMainForm` (opening a character file), `IImprovementCharacter` (the members of a character that the improvements read and change, which the character implements), `ICharacter` (the members of a character that the character's items, its equipment and the app's readers of their character use, including the searches for a piece of the character's gear by its identifier, by the identifier of the weapon it created, and among the gear of the character's vehicles, which the character implements, with the views of a cyberlimb and a skillsoft, which the cyberware and gear implement), `ITreeNodeView` (the text, tag and grey colour of the tree node of a created item, a new node in no tree, adding a node as the last child, the node's children in order, and expanding the node, which the app shows on a Windows Forms tree node), `IEquipmentHost` (asking for a number that cannot be cancelled, asking for the weapon category of ammunition, and creating a granted weapon for a character on a tree node) and `IEquipmentWeapon` (the identifier, name, display name, vehicle mounting and range of a granted weapon, which the weapon implements). The app SHALL register its host in `ApplicationHost.Current` as the first statement of `Program.Main`. Reading `ApplicationHost.Current` before a host is registered SHALL throw an `InvalidOperationException` that names the missing registration, registering a second host SHALL throw an `InvalidOperationException` and leave the first in place, and registering `null` SHALL throw an `ArgumentNullException`; there SHALL be no default host. `GlobalOptions.MainForm` SHALL be an `IMainForm`, which the main window implements and registers. `IMainForm.LoadCharacter` SHALL be the only place that declares the defaults of the optional arguments (`true`, an empty name and `false`); the main window's own `LoadCharacter` SHALL take all four arguments, so that a call through the interface and a call on the window cannot differ. The app's host SHALL behave as the moved code did: the executable's folder is `Application.StartupPath`, the product version is `Application.ProductVersion`, an image is decoded with `Image.FromStream` and written with `Image.Save` to the given file, an error is a `MessageBox` with `OK` and the error icon, an information message one with `OK` and the information icon, a question one with `Yes` and `No` and the question icon whose answer is yes only for `Yes`, and quitting is `Application.Exit`. Its selection dialogs SHALL open the same windows with the same descriptions, forced values, lists and filters as the moved code did, return the selection, and return `null` exactly when the window's result is `Cancel`; a dialog that needs the character SHALL throw when the character it is given is not a `Character`, instead of opening the window without it. Its equipment host SHALL ask for a number with the number window without a cancel button and return its value, ask for a weapon category with the weapon category window, limited to the given category unless it is empty, and return its selected category, and create a granted weapon for the given `Character` on the given node without context menus; it SHALL throw an `ArgumentException` for a character that is not a `Character` or a node that is not the app's tree node view. The character SHALL answer the gear searches as the item searches of `ItemFinder` do, with `null` when nothing is found. The app's tree node view SHALL set the node's text and tag as given, show grey text with `SystemColors.GrayText`, create new nodes as tree node views of new Windows Forms tree nodes, add a node as the last child of its own, throw an `InvalidCastException` when the node to add is not an app tree node view, show the node's children in order as tree node views of the same Windows Forms nodes, and expand its node.

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

#### Scenario: Child nodes of a created item
- **WHEN** an item adds child nodes to its app tree node view
- **THEN** each new node starts in no tree, empty and without a colour, is added after the node's existing children, and the node is expanded when the item expands it

#### Scenario: A node of another kind
- **WHEN** a node that is not an app tree node view is added to an app tree node view, or reaches the app's weapon lists
- **THEN** it throws an `InvalidCastException` and the Windows Forms node gets no child

#### Scenario: Children of a node
- **WHEN** an item reads the children of its app tree node view and adds a node to one of them
- **THEN** it gets the Windows Forms node's children in order with their tags, and the added node becomes a child of that Windows Forms child

#### Scenario: Child nodes with a context menu
- **WHEN** the app's node function for a context menu creates nodes
- **THEN** each is a new tree node view in no tree with that context menu, or with none for `null`

### Requirement: The library holds the character's items
The library SHALL define `Attribute`, `QualityType`, `QualitySource`, `Quality`, `SkillGroup`, `Skill`, `SpiritType`, `Spirit`, `Spell`, `Focus`, `Metamagic`, `Power`, `TechProgram`, `TechProgramOption`, `MartialArt`, `MartialArtAdvantage`, `MartialArtManeuver`, `ContactType`, `Contact`, `CritterPower`, `InitiationGrade`, `CalendarWeek` and `MentorSpirit` in the namespace `Chummer`, in `Core/UniqueModels.cs`, which SHALL have reached the library by a commit in which git detects it as a rename of `Chummer/clsUnique.cs` with at least 90% similarity; none of these types SHALL be defined in the executable. `StackedFocus`, which holds gear, SHALL be defined in `Core/StackedFocus.cs`, which reached the library with the character. The items SHALL keep their behaviour: they SHALL save, load and print the same XML and compute the same values as before. Their public members SHALL keep their names and signatures, except that they take and expose the character as an `ICharacter`, that each `Create` method that filled a `TreeNode` SHALL take an `ITreeNodeView` and set its text, tag and grey colour where it set the node's, that `Quality.Create` SHALL take a function that adds a granted weapon and returns its identifier instead of the two lists, and that `Contact.Colour` SHALL be `Contact.ColourArgb`, an ARGB value or `null` when no colour was set. The app SHALL keep each former `Create` signature with a `TreeNode` as an extension method that fills the node through the item's `Create`, so that no call site changes, and SHALL read and set a contact's colour as `Color.Empty` for `null` and as the ARGB colour otherwise. A contact SHALL save `0` as the colour when none was set and its ARGB value otherwise, and a loaded contact SHALL keep the saved value, or `null` when its save data has none.

#### Scenario: Types of the build
- **WHEN** the types of `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` of a candidate are listed
- **THEN** the moved items and `StackedFocus` appear only in the library, and every type of a build of the source before the move appears once

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
