# Proposal

## Why

A case can only select tabs, wait and capture. The character suite therefore shows how each tab looks for a saved character, but no case changes a value, opens a dialog or saves anything. Those are the paths where the app computes and writes data, and where a candidate is most likely to differ from the canonical executable. The coverage manifest agrees: of the active bindings, only tab selection events are ever exercised. A text box's `TextChanged`, a button's `Click` and a list's `SelectedIndexChanged` can never be proved.

## What Changes

- **Value edits.** A `setValue` action types a value into a text box or numeric up-down named by its control name, leaves the control so the app takes the value, and fails unless the control then holds exactly that value and held something else before.
- **Buttons and items.** A `click` action presses a button or check box by control name. A `selectItem` action selects the item with a given text in a list box, combo box or tree view, and fails when the item is missing or already selected.
- **Context menus and dialogs.** A `contextMenu` action opens the context menu of a control (of a tree view's selected node) without moving the pointer and invokes the item with a given text, for example right-click on a gear item, then `Add as Plugin`. Every action works on the active window: the main window, or the modal dialog it has open. An action that opens a dialog does not block the runner. A capture with a dialog open captures the dialog, and its UI tree is the dialog's.
- **Save and reload.** A `saveReload` action saves the character through the app's own Save command, checks that the file was written, closes the app, which must exit without asking anything, and opens the saved file in a new app process. A case with this action gets its own copy of the fixture on each side, so the candidate never opens what the canonical side saved.
- **Proof of exercised bindings.** The coverage manifest counts a binding of the control a `setValue`, `click` or `selectItem` acted on as exercised when the capture just before the action showed that control in its class: the text and value change events for `setValue`, `Click` for `click`, and the selection events for `selectItem`.
- **Scope.** The inventory's scope declares `frmSelectGear`, the dialog the gear scenarios drive, active, so its controls and bindings are counted. The reasons of the deferred classes opened from a button or a menu no longer say that no case action clicks or opens a menu, which is no longer true; they say that no case opens the class.
- **Rich scenario case file.** `parity/cases/rich-scenarios.json` holds scenarios that use the new actions on suite fixtures: a name edit, an attribute change, a gear dialog opened from a context menu and a button, and a save/reload round-trip in build and career mode.

Area: the parity tools (case loading, the capture runner), the contracts, the workflow's inventory, a new case file and docs. The Chummer app and `bin/` are untouched. Evidence: contract drift and round-trip tests; `dotnet test` for loading and mapping the new actions, the active-window rules and the per-side copies; workflow tests for the new proof rule; a live `npm start` run of the rich scenario case file with UI trees, the canonical hash before and after, execution outcomes apart from visual results, and the bindings it proved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `visual-parity-capture`: the `setValue`, `click`, `selectItem`, `contextMenu` and `saveReload` actions, the active window, per-side fixture copies for saving cases, their timing operations, and the rich scenario case file.
- `interaction-inventory`: bindings exercised by value edits, clicks and item selections.

## Impact

- Edited files: `parity-cases.schema.json` and `parity-capture-timing.schema.json`, their examples and generated code; `parity/src/Parity.Cases` (new action records, the expander); `parity/src/Parity.Capture` (session, driver, staging, timing); their tests; `workflow/src/inventory/` and `workflow/src/discovery/known-texts.ts` with tests; `parity/inventory/scope.json` and the active-class count in `workflow/tests/inventory-command.test.ts`; `AGENTS.md` and `README.md`.
- New files: `parity/cases/rich-scenarios.json`; new capture runner classes for the actions.
- Capture runner assemblies change, so canonical cache entries stored before this change are not reused.
