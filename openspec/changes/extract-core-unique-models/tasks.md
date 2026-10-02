# Tasks

## 1. Interfaces and move

- [ ] 1.1 Move `StackedFocus` unchanged out of `Chummer/clsUnique.cs` into `Chummer/StackedFocus.cs`. Evidence: `npm run build:candidate` builds; the commit removes from `clsUnique.cs` exactly the lines it adds to `StackedFocus.cs` besides the new file's `using` lines and namespace.
- [ ] 1.2 Add `ICharacter` (with `ICharacterCyberware` and `ICharacterGear`) and `ITreeNodeView` in the app, move `CharacterBuildMethod` into `Chummer/CharacterBuildMethod.cs`, implement the interfaces on `Character`, `Cyberware` and `Gear`, and add `TreeNodeView`. Evidence: the candidate builds.
- [ ] 1.3 In place, make the items in `Chummer/clsUnique.cs` reach the character only through `ICharacter` and the tree node only through `ITreeNodeView`, give `Quality.Create` the weapon function, make the contact colour an ARGB value, and drop the file's Windows Forms and drawing `using` lines; add `TreeNodeCreation` and `ContactColour` and switch the contact colour call sites. Evidence: the candidate builds; a search of `Chummer/clsUnique.cs` finds no `TreeNode`, `Weapon`, `Color`, `SystemColors`, `Character` type, `Cyberware` or `Gear` type besides strings, comments and enumeration members.
- [ ] 1.4 Move `Chummer/clsUnique.cs`, `Chummer/ICharacter.cs`, `Chummer/ITreeNodeView.cs` and `Chummer/CharacterBuildMethod.cs` to `Core/`. Evidence: each rename of the move commit has at least 90% similarity; the candidate builds; the type listing of the executable and the library equals the previous source's types plus the new ones, each once, with the moved items and the interfaces in the library and `StackedFocus` in the executable.
- [ ] 1.5 Test the moved items in `parity/tests/Parity.Tests` without a host: a contact saved and loaded without and with a colour, and an attribute's modifiers from improvements and from cyberlimbs of a test character. Evidence: `npm run parity:test` passes.

## 2. Verification and archive

- [ ] 2.1 Run `npm start` live over the whole case suite on the final source with diagnosis, repair and widening. Record in `verification.md` the canonical SHA-256 before and after, each case's execution outcome (capture status, coverage, where the canonical side came from) apart from its visual result and the compare report's completeness, each discrepancy cluster with the loop's outcome, the thread's outcome, the fixture-tested checks of tasks 1.1 to 1.5 apart from the live evidence, and what remains unverified.
- [ ] 2.2 Archive the change with `openspec archive extract-core-unique-models`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
