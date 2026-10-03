## ADDED Requirements

### Requirement: The source inventory lists every form, control and event binding
The inventory SHALL read every WinForms designer file under `Chummer/` and `Core/` that has an `InitializeComponent` method and list each class (form or user control) with its base type, its designer and code files, the instance name it sets, its controls and components (name, type, container, text, translation tag, context menu, designer line) and its event bindings (target control and member, event, handler, the handler's file and line, the binding's designer line), with the ID `<Class>.<target>.<Event>` and `(self)` as the target of the class's own events. Containment SHALL follow `Controls.Add` and the tool strip item lists. An event binding it cannot read, a containment or binding that names an undeclared field, a class without a code file, a handler its code file does not define, a string assignment that is not made of string literals, a string with an escape the parser does not read, or two bindings with the same ID SHALL fail the inventory with the file and line; the inventory SHALL NOT leave such an entry out. `source-inventory.json` SHALL record the SHA-256 of the files it read.

#### Scenario: Binding with its handler
- **WHEN** a designer file declares `cmdAdd`, adds it to `panSkills` and binds `this.cmdAdd.Click += new System.EventHandler(this.cmdAdd_Click);`, and the code file defines `cmdAdd_Click`
- **THEN** the inventory lists control `cmdAdd` in `panSkills` and the interaction `<Class>.cmdAdd.Click` with the handler's file and line

#### Scenario: Handler missing
- **WHEN** a binding names a method that the class's code file does not define
- **THEN** the inventory fails naming the designer file, its line and the handler

#### Scenario: The app's own source
- **WHEN** the inventory reads the repository's `Chummer/` folder
- **THEN** every designer class is listed and every binding's handler is found

### Requirement: The scope declares every class as active or deferred
`parity/inventory/scope.json` SHALL declare every inventoried class exactly once as `active` or `deferred` with a non-empty reason, and SHALL list the events deferred in every class, each with a non-empty reason. A class the scope file does not declare, a declared class the source does not have, an unknown scope value or an empty reason SHALL be a setup error. Controls and bindings of a deferred class, and bindings of a deferred event, SHALL be `deferred` with that reason and SHALL NOT count toward the active totals.

#### Scenario: A new form
- **WHEN** the source gains a form that the scope file does not declare
- **THEN** the inventory fails with a setup error naming the form

#### Scenario: A dialog is deferred
- **WHEN** `frmSelectGear` is declared `deferred` with the reason that only a menu or button opens it
- **THEN** each of its controls and bindings is `deferred` with that reason in the manifest

### Requirement: The coverage manifest is built only from proven results
The coverage manifest SHALL list every planned case and capture with the candidate side's outcome in the run's coverage (`observed` for a performed capture, else `failed`, `filtered`, `missing`, `not-run`, `optional-absent` or `skipped-optional`), or `not-captured` when no run read holds the case; every control of an active class as `observed`, with the case and capture of every recorded tree in which a node matched it, `windowless` when no tree matched it and its declared type is never a window of its own (a component, a tool strip item, a pop-up menu, a dialog or a grid column), or `unobserved`; the totals of controls to observe SHALL leave the windowless ones out; every binding of an active class as `exercised`, with its proof, or `unexercised`; and, per case and capture, the automation IDs that matched no control. A node's control name SHALL be its automation ID when the node is a WinForms window and the ID is not a number, and none otherwise. A node SHALL count only when it is shown: its parent is shown and its bounds overlap those of every WinForms window above it; an element that is not a window and has no rectangle SHALL be shown with its parent. A shown node SHALL match a control when its control name names a control declared in the class whose context it is in; the root and the instances of inventoried classes, recognized by the instance name their designer sets or by a declared control of that class's type, SHALL set the context of their subtree. A tab control SHALL show the page named by its one shown `TabItem` child that has children and a name, and that item SHALL match the tab control's tab page whose designer text is that name when exactly one has it. A binding SHALL be `exercised` only when a tab control showed a page in two consecutive performed captures of a case, a different one in each, with a performed `selectTab` action between them; then its `SelectedIndexChanged`, `Selected`, `Selecting`, `Deselecting` and `Deselected` bindings are exercised in that case. A control's presence in the source SHALL NOT make it observed, and its presence on screen SHALL NOT make its bindings exercised. A performed candidate capture without its tree, a tree for a capture that was not performed or that belongs to another run, a run whose summary records no trees, a case found in two runs or in no plan, a planned capture a run does not plan, or a document that does not match its schema, including one the inventory itself would write, SHALL be a setup error and SHALL NOT be written.

#### Scenario: Control on screen
- **WHEN** the tree of `build-Diego/skills` holds a visible node with automation ID `cmdAddKnowledgeSkill` under the `frmCreate` node, and `frmCreate` declares that control
- **THEN** the control is `observed` with `build-Diego/skills` listed

#### Scenario: Tab change proves the selection event
- **WHEN** `street-gear-lifestyle` shows page `Lifestyle` and `street-gear-armor` shows `Armor` of tab control `tabStreetGearTabs`, with `selectTab:Armor` performed between them
- **THEN** `frmCreate.tabStreetGearTabs.SelectedIndexChanged` is `exercised` in that case

#### Scenario: Control scrolled out of its panel
- **WHEN** a node with automation ID `lblSkillName` lies below the bounds of the panel window above it
- **THEN** it is neither matched nor unresolved

#### Scenario: Visible button is not exercised
- **WHEN** a button is observed in every capture and no action clicked it
- **THEN** its `Click` binding is `unexercised`

#### Scenario: Missing tree
- **WHEN** a run's candidate side performed capture `skills` and the run has no tree for it
- **THEN** the inventory fails with a setup error naming the run, case and capture

#### Scenario: Failed capture
- **WHEN** the candidate side's `skills` capture failed
- **THEN** that tuple is `failed` and no control is observed from it

### Requirement: The inventory describes the candidate's source
When it reads capture runs, the inventory SHALL describe only the source the candidate was built from: when the compiled-source identity of the working tree's `Chummer/` and `Core/` differs from the one the candidate's build recorded, or none was recorded, it SHALL fail with a setup error. `npm run inventory` SHALL also fail with a setup error when a run's candidate SHA-256 differs from the one the build recorded beside the source identity, or when none was recorded, so its runs must show the candidate that build left.

#### Scenario: Source changed after the build
- **WHEN** a designer file changes after the candidate was built and the inventory reads a capture run
- **THEN** the inventory fails with a setup error asking for a new build

#### Scenario: No runs, no build
- **WHEN** `npm run inventory` runs without `--run` and no candidate was built
- **THEN** it writes both documents with nothing observed and exits with 0

### Requirement: npm run inventory builds the documents from capture runs
`npm run inventory -- --run <folder>...` SHALL write `source-inventory.json` and `coverage-manifest.json` to `--out` (default `out/inventory/<UTC time>/`) from the given capture runs, which must have been made with `--ui-tree`, and SHALL accept `--case-file` and `--scope`. It SHALL exit 0 when the documents are written and 3 for a setup error, and print the manifest's totals. Without `--run`, every tuple SHALL be `not-captured` and every active control that can show as a window `unobserved`.

#### Scenario: Run without trees
- **WHEN** `npm run inventory -- --run <folder>` reads a run made without `--ui-tree`
- **THEN** it exits with 3 naming the run
