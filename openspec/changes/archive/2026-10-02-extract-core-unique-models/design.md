# Design

## Context

`Chummer/clsUnique.cs` (about 8,600 lines) holds 24 types: `Attribute`, `QualityType`, `QualitySource`, `Quality`, `SkillGroup`, `Skill`, `SpiritType`, `Spirit`, `Spell`, `Focus`, `StackedFocus`, `Metamagic`, `Power`, `TechProgram`, `TechProgramOption`, `MartialArt`, `MartialArtAdvantage`, `MartialArtManeuver`, `ContactType`, `Contact`, `CritterPower`, `InitiationGrade`, `CalendarWeek` and `MentorSpirit`. Besides the library's `XmlManager`, `LanguageManager`, the options and the improvements, they use these types of the app:

| What | Where |
|---|---|
| `Character` | a field and the constructor of nearly every type; the `Create` methods' parameter; `CharacterObject` of `Skill`, `Spirit` and `Power`; the public field `Attribute._objCharacter`. The members read are `Options`, `BuildMethod`, `IsCritter`, `MetatypeCategory`, `OverrideSpecialAttributeEssenceLoss`, `EssencePenalty`, `MAG`, `MAGMagician`, `WoundModifiers`, `SkillsoftAccess`, `GetAttribute`, `GetObjectName`, `Skills`, `SkillGroups`, `TechPrograms`, `Cyberware`, `Gear`, and members `IImprovementCharacter` already declares |
| `TreeNode` | the `Create` methods of `Quality`, `Spell`, `Metamagic`, `TechProgram`, `TechProgramOption`, `MartialArt`, `MartialArtAdvantage`, `MartialArtManeuver` and `CritterPower` set the node's `Text` and `Tag`; `Quality` also sets `ForeColor` to `SystemColors.GrayText` |
| `Weapon` | `Quality.Create` creates the weapons a quality grants, each with a grey tree node, and adds them to two lists the caller passes |
| `Cyberware` | `Attribute` reads `Category`, `LimbSlot`, `TotalBody`, `TotalStrength` and `TotalAgility` of the character's cyberlimbs |
| `Gear` | `Skill` reads `Name`, `Category`, `Extra`, `Rating`, `Equipped` and `Children` of the character's skillsofts; `StackedFocus` holds, saves and loads a list of gear |
| `System.Drawing.Color` | `Contact.Colour`, saved as its ARGB value and loaded with `Color.FromArgb` |

The app reads through `CharacterObject` also `Created`, `Qualities`, `SettingsFile`, `Uneducated`, `RESEnabled`, `AdeptEnabled`, `MagicianEnabled`, `Improvements` and `Gear`. The library reaches the application through `IApplicationHost`, `IMainForm` and `IImprovementCharacter`, and the parity workflow already treats `Chummer/` and `Core/` as the compiled source.

## Goals / Non-Goals

**Goals:**
- The items in the library, with their git history, unchanged in what they do, save, load and print.
- The app behaving and looking exactly as before, including the tree nodes of created items and the colours of contacts.
- Every type defined once across the executable and the library; no call site of a `Create` method changes.

**Non-Goals:**
- Moving `StackedFocus`, which holds gear and stays in the app.
- Changing the moved code beyond what reaching the application through interfaces requires: no renames of members other than the contact colour, no cleanup of their logic.
- Touching the canonical `bin/ChummerGenSR4.exe`.

## Decisions

1. **One character interface for the items.** `ICharacter` extends `IImprovementCharacter`, because the items create improvement managers with their character, and declares the members of the table above and those the app reads through `CharacterObject`, with the character's own names and types where the type is in the library (`CharacterOptions`, `CharacterBuildMethod`, `Attribute`, `List<Skill>`, `List<SkillGroup>`, `List<Quality>`, `List<TechProgram>`). `GetAttribute` and `Skills` hide the improvement interface's members of the same names with the full types; `Character` already implements those through explicit members, so its public `GetAttribute` and `Skills` implement the new ones. Fields, constructors, `Create` parameters, `CharacterObject` and `Attribute._objCharacter` become `ICharacter`; every call site passes a `Character`, so they compile unchanged, and the app's reads through `CharacterObject` find the members on the interface. An interface per item type was the alternative; one interface keeps the character's surface in one place, where it can be compared with the character.
2. **Views for cyberlimbs and skillsofts.** `ICharacter.Cyberware` is an `IEnumerable<ICharacterCyberware>` and `ICharacter.Gear` an `IEnumerable<ICharacterGear>`, which `Character` implements with explicit members that return its lists. `Cyberware` and `Gear` implement the views with their existing public members; `Gear.Children` is a `List<Gear>`, so `ICharacterGear.Children` is an explicit member returning it. The attribute and skill loops change only the declared type of their loop variable and still walk the same objects in the same order. The app's own loop over `CharacterObject.Gear` keeps `Gear` as its loop variable, which casts each element as before. The views sit in the character interface's file, since they exist only for it.
3. **A tree node view, and the former signatures as extension methods.** `ITreeNodeView` has `Text`, `Tag` and `ShowAsGrayText()`. Each `Create` method takes an `ITreeNodeView` where it took a `TreeNode` and sets it at the same points as before, so a node that a cancelled selection left half filled is left the same way. `TreeNodeView` wraps a `TreeNode`, and `ShowAsGrayText` sets its `ForeColor` to `SystemColors.GrayText`. `TreeNodeCreation` holds, as extension methods, the nine former `Create` signatures with `TreeNode` (and `Character`); each wraps the node and calls the item's method. A call with a `TreeNode` finds no applicable instance method and binds to the extension, so the call sites in the forms do not change; no call site passes `null` for the node, which would bind to the instance method.
4. **A quality's weapons through a function.** `Quality.Create` takes a `Func<XmlNode, string>` instead of the two lists, and calls it for each weapon the quality grants, at the same point as before, keeping the identifier it returns. The extension's function, built by `WeaponNodeFunction.Create`, makes a tree node, creates the `Weapon` on it with `Weapon.Create`, makes the node grey through `TreeNodeView`, adds both to the caller's lists and returns the weapon's `InternalId`, as the former block did. `WeaponNodeFunction` is generic in the weapon's type and takes the creation as a function, so that the grey node and the lists can be tested without the app's `Weapon`.
5. **A contact's colour as an ARGB value.** `Contact.Colour` (`Color`) becomes `Contact.ColourArgb` (`int?`): `null` for a contact whose colour was never set, else the ARGB value. Saving writes `0` for `null` and the value otherwise, which is what `Color.Empty.ToArgb()` and `ToArgb()` wrote; loading reads the value, and a contact without one keeps `null`, as the former code kept `Color.Empty`. The app's `ContactColour.GetColour()` returns `Color.Empty` for `null` and `Color.FromArgb(value)` otherwise, and `SetColour()` stores `null` for `Color.Empty` and `ToArgb()` otherwise; the ten lines that read or set `Colour` call them. A loaded colour was a `Color.FromArgb` value before as well, so the only difference is that a known colour set during a session would come back as an unnamed one with the same ARGB value; the contact connection window gets its colours from the colour dialog, which gives unnamed colours, so the app never sets a known one.
6. **`StackedFocus` stays in the app.** It holds a `List<Gear>`, creates and loads `Gear` objects and exposes the list to the forms; the library cannot name the app's `Gear`. It moves unchanged into `Chummer/StackedFocus.cs` before anything else changes.
7. **Move order.** Each step builds and keeps the app's behaviour, and each move is a commit of its own:
   1. `StackedFocus` out of `clsUnique.cs` into `Chummer/StackedFocus.cs`;
   2. still in the app: `ICharacter` with its views and `ITreeNodeView` as `Chummer/ICharacter.cs` and `Chummer/ITreeNodeView.cs`, `CharacterBuildMethod` out of `clsCharacter.cs` into `Chummer/CharacterBuildMethod.cs`, the implementations on `Character`, `Cyberware` and `Gear`, and `TreeNodeView`;
   3. in place, in `Chummer/clsUnique.cs`: the items reach the character and the tree node only through the interfaces, the contact colour becomes an ARGB value, and its `using System.Drawing;` and `using System.Windows.Forms;` lines go; `TreeNodeCreation`, `ContactColour` and the contact colour call sites follow;
   4. `Chummer/clsUnique.cs`, `Chummer/ICharacter.cs`, `Chummer/ITreeNodeView.cs` and `Chummer/CharacterBuildMethod.cs` moved unchanged to `Core/UniqueModels.cs`, `Core/ICharacter.cs`, `Core/ITreeNodeView.cs` and `Core/CharacterBuildMethod.cs`.
   Preparing in place first makes the move commit a pure rename. All moved types stay in one file, as before, so the whole history follows one path. The moved files keep their BOM and CRLF line endings; new files are stored with CRLF like the other source files.
8. **The compiled source is already covered.** The parity workflow compiles `Chummer/` and `Core/` and its prompts describe both, so nothing in it needs to change for the move.

## Risks / Trade-offs

- **A tree node filled differently.** A created quality, spell or power whose node text, tag or colour differed would show differently in the tree. Mitigation: each `Create` method keeps its node assignments in place with only the parameter's type changed; the extension methods only wrap the node; the colour of the quality and its weapons is set by the same `SystemColors.GrayText` assignment, now in the app.
- **A contact drawn in another colour.** Mitigation: the ARGB value is saved and loaded as before, `null` stands for `Color.Empty`, and unit tests save and load contacts with and without a colour; the live run opens characters with contacts.
- **No case creates an item.** The capture cases open saved characters, so no `Create` method and no extension runs live. Mitigation: `TreeNodeView`, `ContactColour` and `WeaponNodeFunction` are compiled into the C# tests and tested there (text and tag, grey text, the contact colour and its empty value, a created weapon with a grey node added to both lists); the extension methods are reviewed as wrappers of the former signatures, their call sites are unchanged, and the build proves they bind to the extensions, since no instance method takes a `TreeNode`.
- **Most of the items need the host.** Their display names, prints and costs read the language and the options, whose static constructors read the application host, so the unit tests cover only what runs without it: the contact's save data and the attribute's modifiers from improvements and cyberlimbs. The rest is covered by the live run.
- **The character interface grows with the items.** It names exactly what the items and the app's reads through `CharacterObject` use today; a new use would add a member.

## Verification

Fixture-tested (no desktop): the candidate build; a listing of the types of the executable and the library compared with a build of the source before this change; the rename similarity of the move commit; the C# tests of the moved items with a test character and of the app's adapters.

Only a live run proves that the app starts, opens every case's character with its attributes, qualities, skills, magic, contacts and powers, and draws every captured window as the canonical executable does: `npm start` over the whole case suite with diagnosis, repair and widening, recording the canonical SHA-256 before and after, execution outcomes apart from visual results, and the loop's outcome for any discrepancy.
