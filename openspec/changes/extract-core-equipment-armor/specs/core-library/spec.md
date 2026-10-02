## ADDED Requirements

### Requirement: The library holds armor, cyberware and gear
The library SHALL define `CapacityStyle`, `ArmorMod` and `Armor` in `Core/Armor.cs`, `Grade`, `GradeList` and `Cyberware` in `Core/Cyberware.cs`, and `Gear`, `Commlink` and `OperatingSystem` in `Core/Gear.cs`, all in the namespace `Chummer`; each of these files SHALL have reached the library by a commit in which git detects it as a rename of `Chummer/Armor.cs`, `Chummer/Cyberware.cs` or `Chummer/Gear.cs` with at least 90% similarity, and none of these types SHALL be defined in the executable. Weapons, vehicles, lifestyles and `Equipment` SHALL stay in the app's `Chummer/clsEquipment.cs`. The moved types SHALL keep their behaviour: they SHALL save, load and print the same XML, compute the same costs, availabilities, capacities and Essence, and fill the same tree nodes as before. Their public members SHALL keep their names and signatures, except that they take the character as an `ICharacter`, that each `Create` and `Copy` method that took a `TreeNode` SHALL take an `ITreeNodeView`, that each one that took the lists of weapons and their nodes SHALL take a function that adds a granted weapon with its node, and that `Armor.Create` SHALL take a function that creates the node of an included armor mod instead of the context menu of armor mods. A moved item SHALL add the weapons it grants, ask for a variable cost and ask for the weapon category of ammunition through `ApplicationHost.Current.Equipment`, at the same points as before, and SHALL create the weapons of included armor mods and of child gear and keep them nowhere, as before. The app SHALL keep each former `Create` and `Copy` signature with a `TreeNode`, the weapon lists or the context menu as an extension method that wraps the node (or passes `null` for none) and adds each granted weapon's node and then the weapon to the caller's lists, so that no call site changes; a list that is `null` SHALL fail with a `NullReferenceException` when a weapon is added to it, as before.

#### Scenario: Types of the build
- **WHEN** the types of `ChummerGenSR4.exe` and `ChummerGenSR4.Core.dll` of a candidate are listed
- **THEN** the moved armor, cyberware and gear types appear only in the library, and every type of a build of the source before the change appears once

#### Scenario: History of the equipment
- **WHEN** `git log --follow Core/Gear.cs` runs
- **THEN** it lists the commits of `Chummer/Gear.cs`, back to the commit that cut it out of `Chummer/clsEquipment.cs` without changing its code

#### Scenario: A copied piece of gear
- **WHEN** a piece of gear with a plain child, a commlink and an operating system is copied into a tree node
- **THEN** the node shows the copy's display name with its identifier as tag, gets one child node per copied child in order, each with the child's display name and identifier, and is expanded after each child, the copied children have the types of the originals, and no weapon is added

#### Scenario: Granted weapons reach the caller's lists
- **WHEN** an item created through a former signature adds a granted weapon
- **THEN** the weapon's tree node is added to the caller's node list and then the weapon to the caller's weapon list, and a list that is `null` fails with a `NullReferenceException`

#### Scenario: Characters with their equipment
- **WHEN** a saved character with armor, cyberware or bioware, commlinks and other gear is opened
- **THEN** its windows show the equipment, its values and its tree nodes, and its captures match the canonical executable's

## MODIFIED Requirements

### Requirement: The library reaches the application only through registered interfaces
The library SHALL reach the application only through `IApplicationHost` (the executable's folder, an error message, an information message, a yes/no question, quitting, the translation of a form or user control, the selection dialogs of the improvements, and the equipment host), `IMainForm` (opening a character file), `IImprovementCharacter` (the members of a character that the improvements read and change, which the app's character implements), `ICharacter` (the members of a character that the character's items, its armor, cyberware and gear, and the app's readers of their character use, which the app's character implements, with the views of a cyberlimb and a skillsoft, which the app's cyberware and gear implement), `ITreeNodeView` (the text, tag and grey colour of the tree node of a created item, a new node in no tree, adding a node as the last child, and expanding the node, which the app shows on a Windows Forms tree node), `IEquipmentHost` (asking for a number that cannot be cancelled, asking for the weapon category of ammunition, and creating a granted weapon for a character on a tree node) and `IEquipmentWeapon` (the identifier, name, display name and range of a granted weapon, which the app's weapon implements). The app SHALL register its host in `ApplicationHost.Current` as the first statement of `Program.Main`. Reading `ApplicationHost.Current` before a host is registered SHALL throw an `InvalidOperationException` that names the missing registration, registering a second host SHALL throw an `InvalidOperationException` and leave the first in place, and registering `null` SHALL throw an `ArgumentNullException`; there SHALL be no default host. `GlobalOptions.MainForm` SHALL be an `IMainForm`, which the main window implements and registers. `IMainForm.LoadCharacter` SHALL be the only place that declares the defaults of the optional arguments (`true`, an empty name and `false`); the main window's own `LoadCharacter` SHALL take all four arguments, so that a call through the interface and a call on the window cannot differ. The app's host SHALL behave as the moved code did: the executable's folder is `Application.StartupPath`, an error is a `MessageBox` with `OK` and the error icon, an information message one with `OK` and the information icon, a question one with `Yes` and `No` and the question icon whose answer is yes only for `Yes`, and quitting is `Application.Exit`. Its selection dialogs SHALL open the same windows with the same descriptions, forced values, lists and filters as the moved code did, return the selection, and return `null` exactly when the window's result is `Cancel`; a dialog that needs the character SHALL throw when the character it is given is not the app's character, instead of opening the window without it. Its equipment host SHALL ask for a number with the number window without a cancel button and return its value, ask for a weapon category with the weapon category window, limited to the given category unless it is empty, and return its selected category, and create a granted weapon as the app's weapon for the app's character on the given node without context menus; it SHALL throw an `ArgumentException` for a character that is not the app's character or a node that is not the app's tree node view. The app's tree node view SHALL set the node's text and tag as given, show grey text with `SystemColors.GrayText`, create new nodes as tree node views of new Windows Forms tree nodes, add a node as the last child of its own, throw an `InvalidCastException` when the node to add is not an app tree node view, and expand its node.

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
