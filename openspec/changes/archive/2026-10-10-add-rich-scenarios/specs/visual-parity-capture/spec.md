## ADDED Requirements

### Requirement: Actions edit values, press buttons and select items
A case action of type `setValue` SHALL name a `control` and a `value`, `click` a `control`, and `selectItem` a `control` and an `item`; the loader SHALL fail when an action lacks a field its type requires or has one it does not take. The control SHALL be the first element of the active window whose UI Automation ID is the control name and that is on screen and enabled; none SHALL fail the action naming the control and the window. `setValue` SHALL set the control's text, or, for a control that is not an edit box such as a numeric up-down, the text of its first child window that is one, then move focus out of the control with Tab, and SHALL fail when the control held the value before or does not hold exactly the value afterwards. `click` SHALL invoke a button or toggle a check box, and SHALL fail for a control that supports neither. `selectItem` SHALL select the item whose name is `item` among the control's descendants, and SHALL fail when there is no such item, when it was already selected or when it is not selected afterwards. None of these actions SHALL move the pointer.

#### Scenario: Value typed into a text box
- **WHEN** a case performs `setValue` with control `txtCharacterName` and value `Diego Parity`
- **THEN** the text box holds `Diego Parity` and the action is `performed`

#### Scenario: Value already present
- **WHEN** `setValue` names a value the control already holds
- **THEN** the action is `failed` with a reason saying the value did not change
- **AND** the rest of the side is `not-run`

#### Scenario: Clamped number
- **WHEN** `setValue` gives a numeric up-down a value above its maximum
- **THEN** the action is `failed` with the value the control holds

#### Scenario: Unknown control
- **WHEN** `click` names a control that the active window does not show
- **THEN** the action is `failed` naming the control and the window

#### Scenario: Field of another action type
- **WHEN** a `click` action has an `item`
- **THEN** loading fails naming the action

### Requirement: Actions apply to the active window and do not block on dialogs
Every action SHALL apply to the active window: the main window when it is enabled, otherwise the topmost visible window it owns, followed while that window is disabled too; a disabled window that shows no owned window for 10 s SHALL fail the action. Activation, `selectTab`, `waitFor`, the new actions, the capture and the UI tree SHALL use it. A `setValue`, `click`, `selectItem` or `contextMenu` call SHALL run so that a dialog it opens does not block the runner: the action SHALL wait until the call returns or the active window changes, for at most 10 s, otherwise fail, and then until the app's UI thread has handled a sent message, and the settle time. A call still running when its action ends SHALL be kept until the window it started from is active again; at the end of each acting action and before every action, such a call SHALL have returned within 10 s, and its failure, or its not returning, SHALL fail that action. It SHALL NOT be dropped. `setValue` SHALL press Tab only when its call returned, and SHALL wait until the edit box has lost the keyboard focus.

#### Scenario: Button opens a dialog
- **WHEN** `click` presses `cmdAddGear`, whose handler shows the gear selection dialog
- **THEN** the action is `performed` while the dialog is open
- **AND** the next `selectItem` acts on the dialog's controls

#### Scenario: Capture with a dialog open
- **WHEN** a capture runs while the gear selection dialog is open
- **THEN** the capture holds the dialog's visible window
- **AND** with UI trees, the candidate's tree is the dialog's

#### Scenario: Nothing happens
- **WHEN** a call neither returns nor opens a window within 10 s
- **THEN** the action is `failed` with a timeout reason

### Requirement: Context menus open without the pointer
A `contextMenu` action SHALL name a `control` and an `item`. It SHALL focus the control and press the context menu key, so that WinForms shows the menu of a tree view's selected node or of the control, wait for the menu, which is the process's visible top-level window other than the active window that holds menu items, and invoke the menu item whose name, without accelerator ampersands, is `item`. It SHALL fail when no menu opens within 5 s or the menu has no such item, and SHALL close a menu it opened without invoking anything when it fails. It SHALL NOT move the pointer.

#### Scenario: Plugin added from the gear tree
- **WHEN** a case selects a gear item in `treGear` and performs `contextMenu` with item `Add as Plugin`
- **THEN** the gear selection dialog is the active window

#### Scenario: Missing menu item
- **WHEN** the menu that opens has no item named `item`
- **THEN** the action is `failed` listing the items the menu has
- **AND** no menu stays open

### Requirement: A save and reload round-trips the character
A `saveReload` action, which takes no field, SHALL activate the main window, focus the status bar, set the character file's last-write time to a fixed past time and press Ctrl+S. It SHALL fail when the file's write time does not change within 10 s, and SHALL wait until the app has handled a sent message and, for up to 10 s of its own, until no process holds the file open; it SHALL fail when a process still holds the file after that. It SHALL then close the main window and fail when the process has not exited within 30 s. It SHALL then start the app on the same file and wait for it as at startup, startup delay and character form included, and later actions SHALL act on the new process. The saved file SHALL stay in the run folder.

#### Scenario: Round-trip
- **WHEN** a build case edits the character's name, performs `saveReload` and captures `character-info`
- **THEN** the capture shows the edited name, read from the saved file by a new process

#### Scenario: Close asks a question
- **WHEN** the app does not exit within 30 s after saving
- **THEN** the action is `failed` with that reason and the side ends by closing the process

#### Scenario: Nothing was written
- **WHEN** the file's write time is unchanged 10 s after Ctrl+S
- **THEN** the action is `failed` and the app is not restarted

#### Scenario: The file stays open
- **WHEN** a process still holds the saved file open 10 s after the app has handled a sent message
- **THEN** the action is `failed` with a reason that names the file, and the app is not closed

### Requirement: Rich scenarios are declared in their own case file
`parity/cases/rich-scenarios.json` SHALL hold scenario entries on suite fixtures, with the suite's startup delay and settle time, that use the new actions: an edit of the character's name, a change of an attribute value, a gear selection dialog opened by a button and one opened from a context menu, each captured with the dialog open and after it closes, and a save and reload in build mode and in career mode. Every scenario SHALL capture before each `setValue`, `click` and `selectItem`, so the coverage manifest can prove its bindings.

#### Scenario: Running the rich scenarios
- **WHEN** a contributor runs `npm start -- --case-file parity/cases/rich-scenarios.json` with the suite's overlay
- **THEN** every scenario runs on both executables with execution outcomes and visual results reported apart

## MODIFIED Requirements

### Requirement: Runs are staged in a run-scoped folder with the canonical settings
Each run SHALL create `out/runs/<runId>/` and stage both executables there, each with copies of the canonical `data`, `lang`, `settings`, `sheets` and `export` folders from `bin/`, and with copies of the fixtures. Both executables SHALL load the staged fixture copies. A case whose actions hold `saveReload` SHALL get one copy of its fixture per side, so that neither side opens a file the other saved; every other case SHALL have one copy for both sides. Nothing the run writes SHALL land outside `out/runs/<runId>/`, except the app's own registry key.

#### Scenario: Committed files are untouched
- **WHEN** a run completes
- **THEN** `git status` shows no change to tracked files

#### Scenario: Saving case
- **WHEN** a case with `saveReload` runs on both sides
- **THEN** the candidate side opens a copy of the repository fixture, not the file the canonical side saved

### Requirement: Captures do not depend on focus or activation history
Before each capture, the runner SHALL bring the active window to the foreground and paint its frame as active and, when the active window is the main window, move keyboard focus to the character form's status bar, so that neither earlier input nor the order in which windows were activated changes the captured pixels. A dialog SHALL keep the focus the case's actions left in it.

#### Scenario: Frame state is the same on both sides
- **WHEN** one side's window is the first one launched in the run and the other side's is not
- **THEN** both sides' captures show an active window frame and the same focused control

### Requirement: UI timing is recorded by a decorator around the driver
The capture runner SHALL measure every launch, activation, tab selection, label wait, wait, value edit, click, item selection, context menu, save and reload, capture and close through a decorator around its UI driver and sessions, recording the case, side, operation, target, duration and whether the call threw, and SHALL pass every exception through unchanged. At the end of a run that reaches its last case it SHALL write `timing.json`, conforming to `parity-capture-timing.schema.json`, with each live side's samples in order and their total, and per operation the count, failures, total, median, 80th percentile and maximum. A side served from the cache SHALL have no samples.

#### Scenario: Timing does not change outcomes
- **WHEN** a tab selection throws because the tab is absent
- **THEN** the sample is recorded as failed
- **AND** the action's outcome is the same as without the decorator

### Requirement: The candidate's UI trees are recorded on request
With `--ui-tree`, the capture runner SHALL record after each performed capture of the candidate side, before the capture is recorded, the UI Automation tree of the captured window (the active window) as shown: every element of the control view that is not off screen, in depth-first order, with its parent's index, automation ID, name, control type, class name, enabled state and bounds. The tree SHALL be read before the capture's image is written, so a tree that cannot be read leaves no image of the failed capture. It SHALL write the tree to `ui-trees/<case>/<capture>.json` in the run folder (`parity-ui-tree.schema.json`) and name the folder in the summary's `uiTrees`, which SHALL be absent without the option or when the run ended with a setup error. A tree that cannot be recorded SHALL fail its capture action with the reason, like any other failed action, so coverage is invalid and the run's status is 2. The canonical side, live or from the cache, SHALL record no tree, and the option SHALL NOT change the canonical cache's key or entries. The timing decorator SHALL measure each recording as operation `uiTree`.

#### Scenario: Trees recorded
- **WHEN** a case runs with `--ui-tree` and its candidate side performs captures `common` and `skills`
- **THEN** the run holds `ui-trees/<case>/common.json` and `ui-trees/<case>/skills.json`, and the summary's `uiTrees` is `ui-trees`

#### Scenario: Recording fails
- **WHEN** reading the tree throws after the `skills` capture
- **THEN** that capture action is `failed` with the reason, the rest of the side is `not-run` and the run exits with 2

#### Scenario: Without the option
- **WHEN** a run has no `--ui-tree`
- **THEN** it writes no tree and the summary has no `uiTrees`
