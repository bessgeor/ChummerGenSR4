## ADDED Requirements

### Requirement: Capture steps record UI trees and triage is followed by the inventory
The workflow's capture steps SHALL run the capture runner with `--ui-tree`, use a step key format under which records made without trees miss, and keep the tree files among the outputs a reused step must still have intact; check, narrow, level and baseline captures SHALL NOT record trees. Whenever triage runs, including with `--only triage`, an `inventory` node SHALL follow it and then route as triage did. The node SHALL write `out/workflow/threads/<thread>/inventory/source-inventory.json` and `coverage-manifest.json` from the thread's capture runs and the run's report SHALL print one `Inventory:` line, after the triage totals, with the number of classes and active classes, observed controls of the active ones, exercised interactions of the active ones, observed tuples of the planned ones and unresolved automation IDs. Any setup error of the inventory SHALL end the run with status 3 and leave the thread resumable at the inventory; the inventory SHALL NOT otherwise change the exit status. A thread stored before the node existed, whose capture runs recorded no trees, SHALL skip it, and its report SHALL say that the inventory did not run.

#### Scenario: Inventory after triage
- **WHEN** `npm start` captures, compares and triages every case
- **THEN** the thread's `inventory/` folder holds both documents before diagnosis starts, and the run's report prints the `Inventory:` line after the triage totals

#### Scenario: A reused capture without trees
- **WHEN** a capture step recorded before trees existed has the same inputs otherwise
- **THEN** its key differs, so the case is captured again with trees

#### Scenario: A thread from before the inventory
- **WHEN** a thread checkpointed before the inventory node existed is resumed and reaches it
- **THEN** the node does nothing, the thread goes on to diagnosis or `conclude`, and the report says the inventory did not run

#### Scenario: Source changed since the build
- **WHEN** `npm start -- --only triage` runs after `Chummer/` changed since the candidate was built
- **THEN** the inventory node fails with a setup error and the run exits with 3
