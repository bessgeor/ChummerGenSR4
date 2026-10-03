## ADDED Requirements

### Requirement: The candidate's UI trees are recorded on request
With `--ui-tree`, the capture runner SHALL record after each performed capture of the candidate side, before the capture is recorded, the UI Automation tree of the main window as shown: every element of the control view that is not off screen, in depth-first order, with its parent's index, automation ID, name, control type, class name, enabled state and bounds. The tree SHALL be read before the capture's image is written, so a tree that cannot be read leaves no image of the failed capture. It SHALL write the tree to `ui-trees/<case>/<capture>.json` in the run folder (`parity-ui-tree.schema.json`) and name the folder in the summary's `uiTrees`, which SHALL be absent without the option or when the run ended with a setup error. A tree that cannot be recorded SHALL fail its capture action with the reason, like any other failed action, so coverage is invalid and the run's status is 2. The canonical side, live or from the cache, SHALL record no tree, and the option SHALL NOT change the canonical cache's key or entries. The timing decorator SHALL measure each recording as operation `uiTree`.

#### Scenario: Trees recorded
- **WHEN** a case runs with `--ui-tree` and its candidate side performs captures `common` and `skills`
- **THEN** the run holds `ui-trees/<case>/common.json` and `ui-trees/<case>/skills.json`, and the summary's `uiTrees` is `ui-trees`

#### Scenario: Recording fails
- **WHEN** reading the tree throws after the `skills` capture
- **THEN** that capture action is `failed` with the reason, the rest of the side is `not-run` and the run exits with 2

#### Scenario: Without the option
- **WHEN** a run has no `--ui-tree`
- **THEN** it writes no tree and the summary has no `uiTrees`
