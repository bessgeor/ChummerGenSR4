## ADDED Requirements

### Requirement: With fix changes the fix commit holds the fix change
In a thread with fix changes, promoting a verified attempt SHALL complete the fix change drafted by its repair with the widening's levels, archive it through the OpenSpec CLI in a staging root under the attempt's widening folder, copy the archived folder into the widened source at `fixes/openspec/changes/archive/<archived name>/`, and stage that folder together with `Chummer/` in the fix commit. The staging root SHALL be made anew on every try. A promotion resumed after its commit was made SHALL take that commit and archive nothing again. A passed attempt without a draft SHALL be a setup error.

#### Scenario: Promotion with a fix change
- **WHEN** a verified attempt of a thread with fix changes is promoted
- **THEN** the fix commit's tree holds `Chummer/` with the patch and `fixes/openspec/changes/archive/<date>-fix-<cluster>-<suffix>/` with `proposal.md`, `tasks.md`, `verification.md`, `fix.json` and `.openspec.yaml`, and the repository's working tree is unchanged

#### Scenario: Killed after the commit
- **WHEN** the run is killed after the fix commit with its fix change was made and the thread is resumed
- **THEN** the promotion takes the existing commit and no second fix change is archived
