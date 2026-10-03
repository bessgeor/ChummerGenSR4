# Proposal

## Why

`Chummer/clsEquipment.cs` still holds the character's weapons with their accessories and mods, lifestyles, vehicles with their mods, and the unused `Equipment`. These read and write their save data, print themselves and compute their damage, ranges, costs and availabilities, and they live in the Windows Forms executable although they use Windows Forms only to fill and give context menus to the tree nodes of newly created items, to ask for a vehicle mod's variable cost, and to find ammunition and gear through the app's search functions. The class library already holds the rest of the character's equipment and the interfaces through which it reaches the character, its tree nodes and the application; with a few more members on those interfaces, weapons, lifestyles and vehicles can live there too, complete and unchanged in what they do.

## What Changes

- Separate the groups of `Chummer/clsEquipment.cs` into files of their own in the app, without changing their code: `Weapon`, `WeaponAccessory` and `WeaponMod` go to `Chummer/Weapon.cs`, `LifestyleType` and `Lifestyle` to `Chummer/Lifestyle.cs`, and `VehicleMod` and `Vehicle` to `Chummer/Vehicle.cs`. The unused `Equipment` stays in `clsEquipment.cs`.
- Widen the interfaces through which the items reach the application:
  - `ICharacter` adds the character's `STR` and `BOD` attributes, `IgnoreRules`, and three searches of its gear: a piece of gear by identifier among the character's gear and its children, by the identifier of the weapon it created, and among the gear of its vehicles. The app's character answers them with the search functions the weapons used before.
  - `ITreeNodeView` adds `Children`, the node's child nodes in order, with which a vehicle finds the node of a weapon mount.
  - `IEquipmentHost.SelectNumber`, the number window that cannot be cancelled, also asks for a vehicle mod's variable cost.
  - `IEquipmentWeapon` adds `VehicleMounted`, with which a vehicle marks the weapons that its gear grants.
- In place, the four files reach the character only through `ICharacter`, tree nodes only through `ITreeNodeView`, the number window only through `IEquipmentHost`, and drop their Windows Forms and drawing `using` lines. Each `Create` method that took a `TreeNode` takes an `ITreeNodeView`; `Weapon.Create` and `Vehicle.Create` take, for each context menu they took, a function that creates the node of a child of that kind. The app's `ArmorModNodes` becomes `ContextMenuNodes`, the function that creates a node with a given context menu, for armor mods, weapons and vehicles alike, and the app keeps every former signature as an extension method, so no call site changes.
- Move `Chummer/Weapon.cs`, `Chummer/Lifestyle.cs`, `Chummer/Vehicle.cs` and `Chummer/clsEquipment.cs` into the library (the last as `Core/Equipment.cs`) as file moves that git detects as renames.
- The C# test project tests the app's adapters (the tree node view's children, the context menu node function) and moved items without an application host. A second test project registers an application host with small data files, so that it creates weapons and vehicles into recording tree nodes and through the app's extension methods into Windows Forms tree nodes.

Area: the Chummer app (the moved equipment, the widened interfaces in the library and their implementations in the app) and its C# tests. Evidence: the candidate builds; the metadata of the executable and the library together holds the same types as a build of the previous source, each once, with the moved types in the library and the renamed node function in the app; each move is a git rename of at least 90% similarity; unit tests run the adapters and moved items, with and without a registered host; and a live `npm start` run of the whole case suite with diagnosis, repair and widening compares the candidate with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-library`: the library also holds weapons, lifestyles, vehicles and `Equipment`, and the character and tree node interfaces gain the members they read.

## Impact

- New: `Core/Weapon.cs`, `Core/Lifestyle.cs`, `Core/Vehicle.cs` and `Core/Equipment.cs` (moved), tests in `parity/tests/Parity.Tests` and the test project `parity/tests/Parity.Hosted.Tests`.
- Moved: the weapon, lifestyle and vehicle types out of `Chummer/clsEquipment.cs` into `Chummer/Weapon.cs`, `Chummer/Lifestyle.cs` and `Chummer/Vehicle.cs`, and those and `Chummer/clsEquipment.cs` to `Core/`.
- Renamed: `Chummer/ArmorModNodes.cs` to `Chummer/ContextMenuNodes.cs`.
- Changed: `Core/ICharacter.cs`, `Core/ITreeNodeView.cs` and `Core/IEquipmentWeapon.cs` (the new members), `Core/IEquipmentHost.cs` and `Core/IApplicationHost.cs` (their documentation), `Chummer/clsCharacter.cs` (the gear searches), `Chummer/TreeNodeView.cs`, `Chummer/EquipmentTreeNodeCreation.cs` (the new extension methods), `Chummer/WinFormsEquipmentHost.cs` (its documentation), and the test doubles of the tree node, the character and the weapon in `parity/tests/Parity.Tests`.
- The character of a weapon, weapon accessory, weapon mod, lifestyle, vehicle mod or vehicle is an `ICharacter`; each `Create` with a tree node takes an `ITreeNodeView`, and `Weapon.Create` and `Vehicle.Create` the node functions. No other public member of a moved type changes its name or signature, and no call site of a `Create` method changes. The release output keeps the same two files.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
