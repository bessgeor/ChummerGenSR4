# Proposal

## Why

`Chummer/clsUnique.cs` holds the character's own items: its attributes, qualities, skills and skill groups, spirits, spells, foci, metamagics and echoes, adept powers, complex forms and their options, martial arts with their advantages and maneuvers, contacts, critter powers, initiation grades, calendar weeks and mentor spirits. They read and write their save data, print themselves and compute their values from the character's improvements, and they live in the Windows Forms executable although they use Windows Forms only to fill the tree node of a newly created item, and drawing only for the colour of a contact. The class library already holds the data, options, language and improvement classes they build on; with an interface for the character and one for the tree node, the items can live there too, complete and with their history.

## What Changes

- Add the interfaces through which the items reach the application:
  - `ICharacter`, which extends `IImprovementCharacter` with the members of a character that the items read (its options and settings file, build method, attributes, skills, skill groups, qualities and complex forms, the Essence and MAG values the attributes and skills compute with), with the small views `ICharacterCyberware` (what the attributes read of a cyberlimb) and `ICharacterGear` (what the skills read of a skillsoft). The app's `Character`, `Cyberware` and `Gear` implement them; `CharacterBuildMethod` gets a file of its own so that it can move with the interface.
  - `ITreeNodeView`, the text, tag and grey colour of the tree node that shows a created item; the app's `TreeNodeView` shows them on a Windows Forms `TreeNode`.
- In place, the items reach the character only through `ICharacter` and the tree node only through `ITreeNodeView`: each `Create` method that filled a `TreeNode` takes an `ITreeNodeView`, and the app keeps the former `Create` signatures as extension methods that hand over a `TreeNodeView`, so no call site changes. A quality adds the weapons it grants through a function the app gives it, which creates the weapon and its grey tree node as before. A contact holds its colour as an ARGB value, or none, and the app reads and sets it as a Windows Forms colour through two extension methods.
- `StackedFocus`, which holds and loads gear, stays in the app in a file of its own.
- Move the other 23 types of `clsUnique.cs` into the library with the two interfaces and `CharacterBuildMethod`, as file moves that git detects as renames (`Chummer/clsUnique.cs` to `Core/UniqueModels.cs`).
- The C# test project tests the moved items without an application host: a contact's colour through saving and loading, and an attribute's modifiers from improvements and cyberlimbs through a test character.

Area: the Chummer app (the moved items, the new interfaces in the library and their implementations in the app) and its C# tests. Evidence: the candidate builds; the metadata of the executable and the library together holds the same types as a build of the previous source plus the new interfaces and app classes, each once, with the moved items in the library; the move is a git rename of at least 90% similarity; unit tests run moved items with a test character; and a live `npm start` run of the whole case suite with diagnosis, repair and widening compares the candidate with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-library`: the library also holds the character's items, and reaches the application through the character and tree node interfaces as well.

## Impact

- New: `Core/ICharacter.cs`, `Core/ITreeNodeView.cs` (added in the app and moved with the items), `Core/CharacterBuildMethod.cs` (taken out of `Chummer/clsCharacter.cs` and moved), `Chummer/StackedFocus.cs`, `Chummer/TreeNodeView.cs`, `Chummer/TreeNodeCreation.cs`, `Chummer/ContactColour.cs`, tests in `parity/tests/Parity.Tests`.
- Moved: `Chummer/clsUnique.cs` to `Core/UniqueModels.cs`.
- Changed: `Chummer/clsCharacter.cs` (the interface), `Chummer/clsEquipment.cs` (the views on `Cyberware` and `Gear`), `Chummer/ContactControl.cs`, `Chummer/frmCreate.cs` and `Chummer/frmCareer.cs` (the contact colour).
- `Contact.Colour` becomes `Contact.ColourArgb`; `CharacterObject` of skills, spirits and powers and the character of an attribute are an `ICharacter`. No other public member of a moved type changes its name or signature, and no `Create` call site changes. The release output keeps the same two files.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
