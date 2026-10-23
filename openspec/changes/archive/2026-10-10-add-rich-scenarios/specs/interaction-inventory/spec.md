## MODIFIED Requirements

### Requirement: The coverage manifest is built only from proven results
The coverage manifest SHALL list every planned case and capture with the candidate side's outcome in the run's coverage (`observed` for a performed capture, else `failed`, `filtered`, `missing`, `not-run`, `optional-absent` or `skipped-optional`), or `not-captured` when no run read holds the case; every control of an active class as `observed`, with the case and capture of every recorded tree in which a node matched it, `windowless` when no tree matched it and its declared type is never a window of its own (a component, a tool strip item, a pop-up menu, a dialog or a grid column), or `unobserved`; the totals of controls to observe SHALL leave the windowless ones out; every binding of an active class as `exercised`, with its proofs, or `unexercised`; and, per case and capture, the automation IDs that matched no control. A node's control name SHALL be its automation ID when the node is a WinForms window and the ID is not a number, and none otherwise. A node SHALL count only when it is shown: its parent is shown and its bounds overlap those of every WinForms window above it; an element that is not a window and has no rectangle SHALL be shown with its parent. A shown node SHALL match a control when its control name names a control declared in the class whose context it is in; the root and the instances of inventoried classes, recognized by the instance name their designer sets or by a declared control of that class's type, SHALL set the context of their subtree. A tab control SHALL show the page named by its one shown `TabItem` child that has children and a name, and that item SHALL match the tab control's tab page whose designer text is that name when exactly one has it. A binding SHALL be `exercised` only by one of two proofs. A tab proof: a tab control showed a page in two consecutive performed captures of a case, a different one in each, with a performed `selectTab` action and no `setValue`, `click`, `selectItem`, `contextMenu` or `saveReload` action between them; then its `SelectedIndexChanged`, `Selected`, `Selecting`, `Deselecting` and `Deselected` bindings are exercised in that case. An action proof: the candidate side performed a `setValue`, `click` or `selectItem` action on a control, the latest performed capture before it had only `wait` and `waitFor` actions after it up to the action, and that capture's tree matched the control in exactly one class `K`; then the bindings of `K.<control>` to `TextChanged` and `ValueChanged` (for `setValue`), `Click` (for `click`) or `SelectedIndexChanged`, `SelectedValueChanged` and `AfterSelect` (for `selectItem`) are exercised, with a proof naming the case, the capture and the action with its index. A `contextMenu` or `saveReload` action SHALL prove no binding. A control's presence in the source SHALL NOT make it observed, and its presence on screen SHALL NOT make its bindings exercised. A performed candidate capture without its tree, a tree for a capture that was not performed or that belongs to another run, a run whose summary records no trees, a case found in two runs or in no plan, a planned capture a run does not plan, or a document that does not match its schema, including one the inventory itself would write, SHALL be a setup error and SHALL NOT be written.

#### Scenario: Control on screen
- **WHEN** the tree of `build-Diego/skills` holds a visible node with automation ID `cmdAddKnowledgeSkill` under the `frmCreate` node, and `frmCreate` declares that control
- **THEN** the control is `observed` with `build-Diego/skills` listed

#### Scenario: Tab change proves the selection event
- **WHEN** `street-gear-lifestyle` shows page `Lifestyle` and `street-gear-armor` shows `Armor` of tab control `tabStreetGearTabs`, with `selectTab:Armor` performed between them
- **THEN** `frmCreate.tabStreetGearTabs.SelectedIndexChanged` is `exercised` in that case

#### Scenario: Value edit proves the change event
- **WHEN** capture `character-info` matched `frmCreate.txtCharacterName` and the next action, `setValue:txtCharacterName`, was performed
- **THEN** `frmCreate.txtCharacterName.TextChanged` is `exercised` with a proof naming the case, `character-info` and the action

#### Scenario: Restart between captures
- **WHEN** a `saveReload` and a `selectTab` lie between a capture showing page `Gear` and one showing `Common`
- **THEN** the tab control's selection bindings get no proof from them

#### Scenario: Action without a capture before it
- **WHEN** a `click` on `cmdOK` follows a `selectItem` with no capture between them
- **THEN** the `click` proves nothing

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
