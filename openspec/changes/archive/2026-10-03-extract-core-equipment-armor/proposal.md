# Proposal

## Why

`Chummer/clsEquipment.cs` holds, besides weapons, vehicles and lifestyles, the character's armor and armor mods, cyberware and bioware with their grades, and gear with its commlinks and operating systems. These read and write their save data, print themselves and compute their costs, availabilities and capacities, and they live in the Windows Forms executable although they use Windows Forms only to fill the tree nodes of newly created items, to ask for a variable cost or an ammunition's weapon category, and to create the weapons that an item grants. The class library already holds the character's other items and the interfaces through which they reach the character and their tree nodes; with a few more members on those interfaces and a host for the equipment's dialogs and weapons, armor, cyberware and gear can live there too, complete and unchanged in what they do.

## What Changes

- Separate the groups of `Chummer/clsEquipment.cs` into files of their own in the app, without changing their code: `CapacityStyle`, `ArmorMod` and `Armor` go to `Chummer/Armor.cs`, `Grade`, `GradeList` and `Cyberware` to `Chummer/Cyberware.cs`, and `Gear`, `Commlink` and `OperatingSystem` to `Chummer/Gear.cs`. Weapons, vehicles, lifestyles and the unused `Equipment` stay in `clsEquipment.cs`.
- Widen the interfaces through which the items reach the application:
  - `ICharacter` adds the character's `Metatype` and its `CHA`, `INT`, `LOG` and `WIL` attributes, which the equipment reads.
  - `ITreeNodeView` adds `NewNode()` (a new node that is in no tree yet), `Add(child)` and `Expand()`, with which an item fills the child nodes of its own node.
  - `IEquipmentWeapon`, what an item reads and changes of a weapon it grants (its identifier, name, display name and range), which the app's `Weapon` implements.
  - `IEquipmentHost`, registered as `IApplicationHost.Equipment`: it asks for a variable cost that cannot be cancelled, asks for the weapon category of ammunition, and creates a granted weapon for the character on a tree node. The app's host does this with the same windows and the same weapon creation as before, which the creation of a quality's granted weapons now shares, and it takes the app's own `Character` and tree node out of the interfaces' arguments with a checked conversion (`AppArguments`) that refuses any other type.
- In place, the three files reach the character only through `ICharacter`, tree nodes only through `ITreeNodeView`, the windows and weapons only through `IEquipmentHost`, and drop their Windows Forms and drawing `using` lines. Each `Create` and `Copy` method that took a `TreeNode` and the two weapon lists takes an `ITreeNodeView` and a function that adds a granted weapon with its node; `Armor.Create` takes a function that creates the node of an included mod instead of the mods' context menu (the app's `ArmorModNodes.Create(menu)`). The app keeps every former signature as an extension method, so no call site changes.
- Move `Chummer/Armor.cs`, `Chummer/Cyberware.cs` and `Chummer/Gear.cs` into the library as file moves that git detects as renames.
- The C# test project tests the app's adapters (the tree node view's new members, the weapon lists' function, the mod node function, the argument checks of the equipment host) and moved items without an application host.

Area: the Chummer app (the moved equipment, the widened interfaces in the library and their implementations in the app) and its C# tests. Evidence: the candidate builds; the metadata of the executable and the library together holds the same types as a build of the previous source plus the new interfaces and app classes, each once, with the moved equipment in the library; each move is a git rename of at least 90% similarity; unit tests run the adapters and moved items; and a live `npm start` run of the whole case suite with diagnosis, repair and widening compares the candidate with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-library`: the library also holds armor, cyberware and gear, and reaches the application through the widened character and tree node interfaces and the equipment host as well.

## Impact

- New: `Core/IEquipmentWeapon.cs`, `Core/IEquipmentHost.cs`, `Chummer/WinFormsEquipmentHost.cs`, `Chummer/GrantedWeaponLists.cs`, `Chummer/ArmorModNodes.cs`, `Chummer/AppArguments.cs`, `Chummer/EquipmentTreeNodeCreation.cs`, tests in `parity/tests/Parity.Tests`.
- Moved: the armor, cyberware and gear types out of `Chummer/clsEquipment.cs` into `Chummer/Armor.cs`, `Chummer/Cyberware.cs` and `Chummer/Gear.cs`, and those to `Core/Armor.cs`, `Core/Cyberware.cs` and `Core/Gear.cs`.
- Changed: `Core/ICharacter.cs`, `Core/ITreeNodeView.cs`, `Core/IApplicationHost.cs`, `Chummer/TreeNodeView.cs`, `Chummer/WinFormsApplicationHost.cs`, `Chummer/clsEquipment.cs` (the weapon's interface), `Chummer/TreeNodeCreation.cs` (a quality's weapon creation), and the test doubles of the host and the character in `parity/tests/Parity.Tests`. The app's `Character` already has the members that `ICharacter` adds.
- The character of an armor, armor mod, cyberware or gear is an `ICharacter`; each `Create` and `Copy` with a tree node takes an `ITreeNodeView` and the weapon function, and `Armor.Create` the mod node function. No other public member of a moved type changes its name or signature, and no call site of a `Create` or `Copy` method changes. The release output keeps the same two files.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
