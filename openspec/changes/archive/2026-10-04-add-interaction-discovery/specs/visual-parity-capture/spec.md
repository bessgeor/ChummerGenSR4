## MODIFIED Requirements

### Requirement: Cases are declared in a validated case file
The capture runner SHALL read its cases from a case file that conforms to `parity-cases.schema.json`. Each character entry SHALL name a fixture path relative to the case file and an explicit mode, `build` or `career`. An entry MAY carry its own `actions`, which replace the mode's actions for that entry, together with a `scenario` name matching `^[a-z0-9][a-z0-9-]*$`; its case is then named `<mode>-<file>@<scenario>` instead of `<mode>-<file>`. The loader SHALL fail when a fixture is missing, when the declared mode does not match the character's `<created>` flag, when an included sequence is unknown or included recursively, when an entry has `actions` without `scenario`, `scenario` without `actions` or an empty `actions` list, or when two cases have the same name.

#### Scenario: Mode mismatch
- **WHEN** a character entry declares `build` for a file whose `<created>` element is `True`
- **THEN** loading fails with an error naming the entry and both modes
- **AND** no executable is launched

#### Scenario: Sequences are expanded
- **WHEN** a case's actions include a named sequence
- **THEN** the case runs the sequence's actions in place of the include, in order

#### Scenario: An entry with its own actions
- **WHEN** an entry for `rigger.chum` in build mode has `scenario` `pets` and its own actions
- **THEN** the case `build-rigger@pets` runs those actions and not the case file's `buildActions`

#### Scenario: Actions without a scenario name
- **WHEN** an entry has `actions` and no `scenario`
- **THEN** loading fails naming the entry
