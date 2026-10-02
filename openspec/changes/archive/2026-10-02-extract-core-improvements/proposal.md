# Proposal

## Why

Improvements are how a character's qualities, powers, cyberware and gear change its attributes, skills, limits and tabs: `Improvement` records one bonus, and `ImprovementManager` turns the bonus nodes of the data files into improvements, removes them again and adds their values up. Both live in the Windows Forms executable, although the manager uses Windows Forms only to open the selection windows a bonus can ask for (a skill, an attribute, a mentor spirit and so on), and the app's character only through a few of its members. The class library without Windows Forms already holds the data, options and language classes that the improvements build on; with a small interface for the character and one for the selection windows, the improvements can live there too, complete and with their history.

## What Changes

- Add the interfaces through which the improvements reach the application:
  - `IImprovementCharacter`, the members of a character that the manager reads and changes (its improvements, the flags and grades that bonuses switch, its attributes, skills and weapons, and the conversion of Adapsin cyberware grades), with the small views `IImprovementAttribute`, `IImprovementSkill` and `IImprovementWeapon`. The app's `Character`, `Attribute`, `Skill` and `Weapon` implement them.
  - `IImprovementDialogs`, one method per selection a bonus can ask for, each returning the selection or `null` when the user cancels; the host gives it as `IApplicationHost.ImprovementDialogs`. The app's `WinFormsImprovementDialogs` opens the same windows with the same texts and settings as before.
- In place, the manager reaches the character and the selection windows only through these interfaces; the conversion of Adapsin grades moves onto the character.
- Move `Improvement` and `ImprovementManager` into the library with the two interfaces, as file moves that git detects as renames (`Chummer/clsImprovement.cs` to `Core/Improvement.cs`), with the whole manager: every bonus it understood, the removal of improvements with the flags they switch, the transaction and its rollback, and `ValueOf`.
- The manager also takes its selection windows in its constructor, so that it can run without an application host, and the C# test project tests it that way.

Area: the Chummer app (the moved improvements, the new interfaces in the library and their implementations in the app) and its C# tests. Evidence: the candidate builds; the metadata of the executable and the library together holds the same types as a build of the previous source plus the new interfaces and the dialogs class, each once, with the improvement types in the library; the move is a git rename of at least 90% similarity; unit tests run the moved manager with a test character and test selections; and a live `npm start` run of the whole case suite with diagnosis, repair and widening compares the candidate with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-library`: the library also holds the improvements, and reaches the application through the improvement dialogs of the host and the character interface.

## Impact

- New: `Core/IImprovementCharacter.cs`, `Core/IImprovementDialogs.cs` (added in the app and moved with the improvements), `Chummer/WinFormsImprovementDialogs.cs`, `parity/tests/Parity.Tests/ImprovementManagerTests.cs`.
- Moved: `Chummer/clsImprovement.cs` to `Core/Improvement.cs`.
- Changed: `Core/IApplicationHost.cs` (the dialogs), `Chummer/WinFormsApplicationHost.cs`, `Chummer/clsCharacter.cs` (the interface and the Adapsin grade conversion), `Chummer/clsUnique.cs` (`Attribute`, `Skill`), `Chummer/clsEquipment.cs` (`Weapon`), `parity/tests/Parity.Tests/ApplicationHostTests.cs`.
- No call site of the manager changes; the release output keeps the same two files.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
