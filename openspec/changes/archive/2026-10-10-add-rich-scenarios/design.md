# Design

## Context

The capture runner drives the app through MSAA and UI Automation: it selects tab items, waits for labels and renders the main window with `PrintWindow`. It parks the pointer on the title bar and fails a capture when the pointer moved, and it focuses the status bar before each capture. Both sides of a case open the same staged copy of the fixture. The coverage manifest proves a binding only through a tab change between two captures.

## Goals / Non-Goals

**Goals:**

- Cases that edit values, press buttons, select items, open context menus and dialogs, and save and reload the character, on both executables, with the same execution and visual reporting as today.
- No action moves the pointer, so pointer parking keeps deciding nothing.
- A binding counts as exercised only where an action that raises its event was performed and its effect checked.

**Non-Goals:**

- Discovery plans keep their four action types; the scenario job does not propose the new actions.
- No comparison of the saved files; a round-trip is judged by the captures after the reload.
- No common file dialogs: Save uses the file the character was opened from.

## Decisions

### Controls are named by their WinForms name

Every new action names its control by the automation ID UI Automation reports for a WinForms window, which is the control's `Name`, the same name the source inventory lists. The control is the first element with that ID under the active window that is on screen and enabled; none is a failure naming the ID and the window. Item and menu texts are matched exactly, without the `&` of an accelerator, which UI Automation removes.

### The active window

Actions apply to the active window: the main window when it is enabled, otherwise the topmost visible window it owns (from `EnumWindows` and `GetWindow(GW_OWNER)`, tooltips left out, the native ones and the ones WinForms registers under its own class name), followed while that window is disabled too, so a message box over a dialog is found. WinForms disables the owner before the dialog is shown, while it loads, so a disabled window that shows no owned window yet is waited for, up to 10 s, before it is a failure. `selectTab`, `waitFor`, activation, the capture and the UI tree all use the active window, so a scenario captures a dialog by capturing while it is open. The status bar exists only on the character form, so focus moves to it only when the active window is the main window; a dialog keeps the focus the scenario's actions left, which is the same on both sides. The pointer stays on the main window's title bar; dialogs open centred over the main window and do not cover it.

Alternative considered: a separate `captureDialog` action. Rejected because every other action would then need its own window argument too.

### Actions do not block on dialogs

WinForms carries out a UI Automation `Invoke` or a selection inside the app's message loop, and a handler that calls `ShowDialog` returns only when the dialog closes. Each acting call therefore runs on a worker thread. The action waits until the call returns or the active window changes, for at most 10 s, then until the app has handled a sent `WM_NULL`, and the settle time. `WaitForInputIdle` cannot tell when the app is done: it waits only for the first idle state of a process. A call still running is kept with the window it started from. Once that window is active again, its dialog has closed and the call must return within 10 s; this is checked at the end of every acting action, so the action that closed the dialog fails when the call fails, and before every action. A call whose dialog is still open when the side ends is ended by closing the process.

### How each action acts

- `setValue`: focuses the control and sets its text through the `ValuePattern` of the control or, when the control is not an edit box, of its first child window that is one. A numeric up-down shows only its two buttons in UI Automation's control view, but its edit box is a child window. It then, when its call returned without opening a window, presses Tab and waits until the edit box has lost the keyboard focus, so a control that reads its value when it loses focus does. It fails when the control held the value before, or holds another value afterwards (a numeric up-down that clamps the value, for example).
- `click`: `InvokePattern`, or `TogglePattern` for a check box.
- `selectItem`: the `SelectionItemPattern` of the item with that name among the control's descendants, for a list box, a drop-down list or a tree view alike. It fails when the item was already selected or is not selected afterwards.
- `contextMenu`: selects nothing itself; it focuses the control and presses the context menu key, which makes WinForms show the menu of a tree view's selected node, or of the control, at the node or control. It then waits for the menu, invokes the item with that text, and fails when no menu opens or it has no such item. No mouse input is sent. UI Automation does not list a WinForms context menu among the desktop's children, so the menu is the process's visible top-level window, other than the active window, that holds menu items.
- `saveReload`: activates the main window, focuses the status bar, sets the character file's last-write time back to a fixed past time, and presses Ctrl+S, the shortcut of the character forms' Save command. The file must get a newer write time within 10 s; the runner then waits until the app handles a sent message, which it can only once the save has ended, and, for up to 10 s of its own, until no process holds the file open. The runner then closes the main window and waits up to 30 s for the process to exit; a process still running (for example one asking whether to save) fails the action. It then starts the app on the same file and waits for it exactly as at startup, startup delay included.

### Per-side fixture copies for saving cases

A case whose actions hold `saveReload` gets `characters/<case>/canonical/<file>` and `characters/<case>/candidate/<file>` in the run folder; other cases keep their one shared copy, so the paths the app sees, and therefore their captures and cache entries, do not change. The canonical cache key covers the repository fixture's hash and the actions, so a saving case has its own entries.

### Proof of exercised bindings

The manifest already proves a selection binding by two captures that show different pages; an acting action between them could change the page by itself (a reload opens the first page), so such a pair now proves nothing. For the new actions the effect is checked by the runner, so the proof is the action itself together with the capture before it: a performed `setValue`, `click` or `selectItem` on the candidate side, with only `wait` and `waitFor` actions between it and the latest performed capture before it, whose tree showed the named control in exactly one class `K`; the runner acts on the first such control it finds, and when two classes show one the tree cannot tell which. Then `K.<control>` bindings of the action's events are exercised: `TextChanged` and `ValueChanged` for `setValue`, `Click` for `click`, and `SelectedIndexChanged`, `SelectedValueChanged` and `AfterSelect` for `selectItem`. A proof names the case, the capture and the action with its index. `contextMenu` proves nothing: its menu items are not windows, and the trees cannot show them. The manifest's schema version stays 1; tab proofs keep their shape.

## Risks / Trade-offs

- **[A UI Automation proxy may set a value without the notification a user's input sends]** → `setValue` leaves the control with Tab, and both sides run the same mechanism, so parity is unaffected; the live run shows whether the app reacted in its captures.
- **[A scenario that changes nothing proves nothing]** → `setValue` and `selectItem` fail when the value or selection was already there.
- **[Saving rewrites the staged copy]** → per-side copies; the repository fixtures are never written.
- **[Close prompts]** → a process that does not exit after a save fails the action instead of being killed silently; the side's end still closes it.
- **[Captures of dialogs]** → their size is the dialog's; the comparer handles any size.

## Migration Plan

Existing case files load and run unchanged. The capture runner's assemblies change, so the shared canonical cache stores new entries on the first run.

## Evidence

Fixture tests prove loading and mapping the actions, the active-window walk on a fake window graph, the per-side copies and the proof rule, and the checks of each action (a value already held or clamped, an item already selected or not selected afterwards, a control that cannot be pressed, a menu without the item, a save that writes nothing or leaves the file open, a dialog open at a save, an app that does not exit) on fake controls and a fake save command. Only a live run proves that the actions act on the real app, that dialogs do not block, that the round-trip saves and reopens, and that both executables behave alike.
