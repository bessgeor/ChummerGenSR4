# Tasks

## 1. Contracts and case loading

- [x] 1.1 Add `setValue`, `click`, `selectItem`, `contextMenu` and `saveReload` with the fields `control`, `value` and `item` to `parity-cases.schema.json`, and their operations to `parity-capture-timing.schema.json`, with examples and generated code; map them in `ActionExpander`. Evidence: `npm run contracts:check`, `npm run contracts:test` and `npm run parity:test` pass, with expander tests for each type's required and forbidden fields.

## 2. Capture runner

- [x] 2.1 Resolve the active window and use it for activation, `selectTab`, `waitFor`, captures and UI trees; run acting calls so a dialog does not block them. Evidence: unit tests for the active-window walk on a fake window graph and for the call waiter (returns, window change, timeout, a later failure reaching the next action).
- [x] 2.2 Perform `setValue`, `click`, `selectItem` and `contextMenu`, measured by the timing decorator. Evidence: unit tests that a side passes each action to its session and stops at a failed one, and that every timing operation has a report order; the live run of task 4.1.
- [x] 2.3 Perform `saveReload` with per-side fixture copies for saving cases. Evidence: unit tests for staging (per-side copies only for saving cases); the live run of task 4.1.

## 3. Coverage and scenarios

- [x] 3.1 Prove bindings from `setValue`, `click` and `selectItem` in the coverage manifest. Evidence: workflow tests for each action's events, an action without a capture before it, a control the capture did not show and the unchanged tab proofs.
- [x] 3.2 Add `parity/cases/rich-scenarios.json`, declare `frmSelectGear` active in `parity/inventory/scope.json` and document the actions in `AGENTS.md` and `README.md`. Evidence: a loader test loads the case file against its fixtures; the inventory command test counts the active classes; the live run of task 4.1.

## 4. Verification and archive

- [x] 4.1 Run `npm start -- --case-file parity/cases/rich-scenarios.json` live with the sourcebook overlay and the shared canonical cache; record in `verification.md` the canonical hash before and after, each case's execution outcome apart from its visual result, the comparer's completeness, the bindings the inventory proved, fixture-tested scope apart from live evidence, and what remains unverified.
- [x] 4.2 Archive the change with `openspec archive add-rich-scenarios`. Evidence: `npm run openspec:validate` passes after the archive.
