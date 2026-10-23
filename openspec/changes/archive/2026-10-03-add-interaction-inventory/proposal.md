# Proposal

## Why

The character suite captures every main tab of the app, but nothing says which of the app's forms, controls and event handlers those captures actually show or drive, and which ones no case reaches. Without that inventory, the parity evidence cannot state its own scope: a clean run says nothing about the dialogs, menus and value edits it never touched, and there is no list of uncovered interactions to work from.

## What Changes

- **UI trees from the capture runner.** With `--ui-tree`, the capture runner records, after each capture of the candidate side, the UI Automation tree of the app's main window as it was on screen: every element that is not off screen, with its automation ID (the WinForms control name), name, control type, class name, enabled state, bounds and parent. The trees go to `ui-trees/<case>/<capture>.json` in the run folder (`parity-ui-tree.schema.json`), and the summary names the folder. A tree that cannot be recorded fails its capture action like any other action failure.
- **Source inventory.** A new `workflow/src/inventory/` module reads every WinForms designer file under `Chummer/` and `Core/` and lists each form and user control (its base type and code file), its controls (type, container, text, translation tag, context menu, designer line) and its event bindings (control, event, handler and the handler's file and line). A designer construct it cannot read, or a handler it cannot find, is an error, never a gap.
- **Explicit scope.** `parity/inventory/scope.json` declares every form and user control as `active` (the character forms and what they host, which the cases open) or `deferred`, each with a reason, and the events deferred everywhere (lifecycle and layout events no user action raises), each with a reason. A class that the scope file does not declare, or that the source does not have, is an error.
- **Coverage manifest.** The inventory joins the source inventory, the scope, the case plan and the capture runs into `coverage-manifest.json`: every planned case and capture with its outcome on the candidate side; every control of an active class as `observed` (on screen in a recorded tree, with where) `windowless` (its declared type is never a window and no tree matched it) or `unobserved`, and every control of a deferred class as `deferred`; every event binding as `exercised` (only when a run proves it: a tab control's selection events after a `selectTab` action changed its visible page between two captures), `unexercised` or `deferred`; and the tree elements no declared control matches. Coverage comes only from recorded trees of performed captures; source presence is never coverage.
- **Entry points.** `npm start` records UI trees in its capture steps and runs a new `inventory` node after triage, which writes the thread's `inventory/` folder and prints the manifest's totals. `npm run inventory -- --run <folder>...` builds the same documents from capture runs made with `--ui-tree`. Both refuse to describe a source other than the one the candidate was built from.

Area: the parity tools, the workflow, the contracts and docs. The Chummer app and `bin/` are untouched. Evidence: contract drift and round-trip tests; `dotnet test` covers the tree recording with a scripted driver; workflow tests cover the designer parser on fixture sources, the scope checks, the coverage rules and the node; a live `npm start` run on the whole suite records the canonical hash before and after, execution outcomes apart from visual results, and the manifest's totals.

## Capabilities

### New Capabilities

- `interaction-inventory`: the source inventory, the explicit scope, the coverage manifest and `npm run inventory`.

### Modified Capabilities

- `visual-parity-capture`: the candidate's UI trees recorded with `--ui-tree`.
- `parity-workflow`: capture steps record UI trees, and the `inventory` node follows triage.

## Impact

- New files: `contracts/schemas/parity-ui-tree.schema.json` with its example and generated code; the tree recorder under `parity/src/Parity.Capture/Ui/`; `workflow/src/inventory/` and its tests; `parity/inventory/scope.json`.
- Edited files: the summary schema, its example and generated code; `CaptureOptions`, its parser, `SideExecutor`, `CaseRunner`, `IAppSession`, `ChummerSession`, the timing decorator and the run report; the capture step, its key and the graph; `package.json`; `AGENTS.md` and `README.md`.
- Capture steps recorded before this change miss, because their key gains the tree option. Output still goes only to the git-ignored `out/`.
