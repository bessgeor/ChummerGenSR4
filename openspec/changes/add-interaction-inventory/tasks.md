# Tasks

## 1. UI trees

- [ ] 1.1 Add `parity-ui-tree.schema.json` with its example and generated code, `uiTrees` in the summary schema and `uiTree` in the timing operations. Evidence: `npm run contracts:check`, `npm run contracts:test` and the C# round-trip tests pass.
- [ ] 1.2 Record the candidate's tree after each capture with `--ui-tree`, through `IAppSession`, the timing decorator and `SideExecutor`, and name the folder in the summary. Evidence: unit tests with a scripted driver show trees written for the candidate's performed captures only, none without the option or on the canonical side, a throwing recording failing its capture action, and `uiTree` timing samples.

## 2. Inventory

- [ ] 2.1 Add the designer parser and the source inventory. Evidence: unit tests on small designer and code files for controls, containment, text, tag, context menu, instance name and bindings, and for each failure (unreadable binding, undeclared field, missing code file or handler, duplicate ID); a test over the repository's `Chummer/` lists every designer class and resolves every handler.
- [ ] 2.2 Add `parity/inventory/scope.json` and its checks. Evidence: unit tests for a missing class, an unknown class, an empty reason and a deferred event; a test shows the committed scope file declares exactly the repository's classes.
- [ ] 2.3 Build the coverage manifest from runs. Evidence: unit tests on synthetic runs for tuple outcomes, observed and unresolved nodes with class contexts, the exercise rule (changed page, unchanged page, no `selectTab` between, tab control absent in one tree), deferred statuses, and each setup error (missing tree, run without trees, case in two runs, unknown case).

## 3. Entry points

- [ ] 3.1 Add `npm run inventory`, the capture step's `--ui-tree` and key line, the `inventory` node after triage with the source guard and its printed line, and document both in `AGENTS.md` and `README.md`. Evidence: workflow tests for the options and exit statuses, the capture arguments and key, the node's routing with and without diagnosis and with `--only triage`, and the source guard; `npm run workflow:typecheck` and `npm run workflow:test` pass.

## 4. Verification and archive

- [ ] 4.1 Run live `npm start` on the whole suite with the sourcebook overlay and the shared canonical cache. Record the canonical hash before and after, each case's execution outcome apart from its visual outcome, where the canonical sides came from, the `Inventory:` totals and the tree timings in `verification.md`, separating fixture-tested scope from live evidence and naming what remains unverified.
- [ ] 4.2 Archive the change with `openspec archive add-interaction-inventory`. Evidence: `npm run openspec:validate` passes after the archive.
