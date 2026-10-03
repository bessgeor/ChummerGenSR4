# Design

## Context

`Chummer/clsEquipment.cs` (about 8,000 lines) holds the unused `Equipment`, `Weapon`, `WeaponAccessory`, `WeaponMod`, `LifestyleType`, `Lifestyle`, `VehicleMod` and `Vehicle`. Besides the library's data, options, language, improvement and equipment classes, these use these types of the app:

| What | Where |
|---|---|
| `Character` | the field and constructor of every type and the `Create` parameter of `Weapon`. Of the members read, `STR`, `BOD` and `IgnoreRules` are not on `ICharacter`; `Gear` and `Vehicles` are read only to pass them to the search functions below |
| `CommonFunctions` | a weapon creates one to find its loaded ammunition (`FindGear` among the character's gear, then `FindVehicleGear` among its vehicles, whose found vehicle it ignores) when it computes its damage, armor penetration, recoil or ranges and when it prints its ammunition, and the gear that created it (`FindGearByWeaponID`) when it prints |
| `TreeNode` | the `Create` methods set the node's `Text` and `Tag`; `Weapon` and `Vehicle` create child nodes for their included items, add them with `Nodes.Add` and `Expand` the node; `Vehicle` colours its included mods with `SystemColors.GrayText` and looks for the node of a weapon mount among its node's `Nodes` by tag |
| `ContextMenuStrip` | `Weapon.Create` gives the nodes of an underbarrel weapon, its accessories and its mods three menus, which it passes on to the underbarrel weapon; `Vehicle.Create` gives the nodes of its mods, gear, weapons, their accessories and their mods five menus |
| `frmSelectNumber` | `VehicleMod` asks for a variable cost in a window that cannot be cancelled |

Gear, the gear's `Create` with its weapon function, `ITreeNodeView`, `IEquipmentHost` and `ApplicationHost.Current` are in the library already.

## Goals / Non-Goals

**Goals:**
- Weapons, lifestyles, vehicles and `Equipment` in the library, unchanged in what they do, save, load and print.
- The app behaving and looking exactly as before, including the tree nodes and context menus of created weapons and vehicles.
- Every type defined once across the executable and the library; no call site of a `Create` method changes.

**Non-Goals:**
- Moving `Character`, `CommonFunctions` or any other app type.
- Changing how armor, cyberware, gear and qualities create the weapons they grant (through the equipment host), or removing `IEquipmentWeapon`, which the moved weapon now implements in the library.
- Changing the moved code beyond what reaching the application through interfaces requires: no renames, no cleanup of their logic.
- Touching the canonical `bin/ChummerGenSR4.exe`.

## Decisions

1. **Separate the groups in the app first.** As with armor, cyberware and gear, the three groups are cut out unchanged into `Chummer/Weapon.cs`, `Chummer/Lifestyle.cs` and `Chummer/Vehicle.cs` with the file's `using` lines, and `clsEquipment.cs` keeps only `Equipment`, so that each later move is a pure rename. `Equipment`'s file moves as `Core/Equipment.cs`, which keeps its history and drops the `cls` prefix like the other moved files.
2. **The character answers the searches.** `ICharacter` adds `STR`, `BOD` and `IgnoreRules`, which `Character` has publicly, and `FindGear(id)`, `FindGearByWeaponID(id)` and `FindVehicleGear(id)`, which `Character` implements explicitly by calling the same `CommonFunctions` methods on its own gear and vehicle lists. A weapon calls them where it called `CommonFunctions` with the character's lists. Alternatives: exposing the character's gear and vehicle lists and moving the search functions into the library would move part of `CommonFunctions`, whose other members are Windows Forms code, and a search on the equipment host would put model logic into the window adapter. `FindVehicleGear` has no found-vehicle argument because no weapon reads it, and `Vehicle` could not appear in the interface before it moved.
3. **The tree node view shows its children.** `ITreeNodeView` adds `Children`, the node's child nodes in order; `TreeNodeView` wraps each Windows Forms child node in a new view, so a vehicle that adds its weapon to a mount node found there adds it to that Windows Forms node.
4. **Context menus through node functions.** `Weapon.Create` and `Vehicle.Create` take a `Func<ITreeNodeView>` for each menu they took, and create each child node of that kind with it where they created it with `new TreeNode()`; the statement that set the menu goes. The app's `ContextMenuNodes.Create(menu)`, the former `ArmorModNodes` renamed because armor, weapons and vehicles now share it, creates a new `TreeNode` with the menu (none for `null`). The menu is set when the node is created instead of after the item fills it, which no one can see, since the node is in no tree until the parent adds it; a vehicle weapon that finds no mount now has the menu on a node that is never shown. The requirement says so: every node that an item shows has the menu of its kind, set when the node is created. A vehicle mod's grey colour becomes `ShowAsGrayText()`. Alternative: a menu object on `ITreeNodeView` would carry a Windows Forms type, or an untyped object, through the library.
5. **The vehicle's included gear.** `Vehicle.Create` creates a gear with a weapon function that keeps each granted weapon in a local list and drops its node, as the former local node list did, and then marks each kept weapon as vehicle mounted, as before. `IEquipmentWeapon` adds `VehicleMounted`, which `Weapon` already has, so that the vehicle marks the weapons through the interface and does not assume that the host creates the library's `Weapon`.
6. **The number window through the host.** `VehicleMod` asks `ApplicationHost.Current.Equipment.SelectNumber` with the same limits and description and keeps the number as text, as it kept the window's value.
7. **The former signatures as extension methods.** `EquipmentTreeNodeCreation` adds the six former `Create` signatures of `Weapon`, `WeaponAccessory`, `WeaponMod`, `Lifestyle`, `VehicleMod` and `Vehicle` with `TreeNode` and context menus; each wraps the node (or passes `null`) and builds a node function per menu. A call with a `TreeNode` finds no applicable instance method and binds to the extension; no app call passes a `null` literal as the node, which would bind to the instance method.
8. **Move order.** Each step builds and keeps the app's behaviour, and each is a commit of its own:
   1. the three groups cut out of `clsEquipment.cs` into their files in the app;
   2. the interface members in the library (the character's searches and values, the tree node's children and the weapon's vehicle mounting), their implementations in `Character` and `TreeNodeView`, and the test doubles;
   3. in place, in the four files: the character, the tree nodes, the menus, the searches and the number window only through the interfaces, the Windows Forms and drawing `using` lines removed; `ContextMenuNodes` and the extension methods added;
   4. the four files moved unchanged to `Core/`;
   5. tests with a registered host that create weapons and vehicles.
   The moved files keep their BOM and CRLF line endings; new files are stored with CRLF like the other source files.

## Risks / Trade-offs

- **A tree filled differently.** A weapon's or vehicle's included items in another order, colour, menu or parent would show differently. Mitigation: every node is created, filled, added and expanded at the same point as before, with only the node's type and the moment its menu is set changed; unit tests check the children view and adding to a found child on Windows Forms nodes and the node function with and without a menu, and tests with a registered host create a weapon and a vehicle into recording nodes and through the app's extension methods into Windows Forms nodes, checking each node's kind, text, tag, colour, parent, expansion and menu.
- **Ammunition found differently.** Mitigation: the character calls the same search functions on the same lists, in the same order (gear, then vehicles); unit tests check that a weapon's armor penetration uses ammunition from either and its own value when neither has it.
- **No case creates an item.** The capture cases open saved characters, so no `Create` method, extension, menu node or variable-cost window of weapons, lifestyles and vehicles runs live, while loading, saving, the values and the tree of loaded equipment, and the ammunition searches of loaded weapons do. Mitigation: `Weapon.Create` and `Vehicle.Create` and the extension methods of both run in a test project that registers a host whose folder holds small data files, with a stand-in for the app's `Character`; the other four extension methods only wrap the node, are wrapped as before and are covered by the build, which proves no call site changed. The variable-cost window of a vehicle mod and the `Create` of lifestyles remain unexecuted.

## Verification

Fixture-tested (no desktop): the candidate build at each step; a listing of the types of the executable and the library compared with a build of the source before this change; the rename similarity of the move commit; the C# tests of the moved weapons and vehicles with a test character and of the app's adapters; the C# tests that create a weapon and a vehicle with a registered host and small data files, in a test project of their own because the host is registered once for the process.

Only a live run proves that the app starts, opens every case's character with its weapons, lifestyles and vehicles, and draws every captured window as the canonical executable does: `npm start` over the whole case suite with diagnosis, repair and widening, recording the canonical SHA-256 before and after, execution outcomes apart from visual results, and the loop's outcome for any discrepancy.
