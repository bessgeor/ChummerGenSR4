## ADDED Requirements

### Requirement: Fix changes live in their own OpenSpec root
The repository SHALL hold a second OpenSpec root, `fixes/`, whose `fixes/openspec/config.yaml` names the project-local schema `fix` as its default and whose `fixes/openspec/schemas/fix/` defines the artifacts `proposal` (`proposal.md`), `tasks` (`tasks.md`, requiring the proposal) and `verification` (`verification.md`, requiring the tasks). Fix changes SHALL NOT be created in the project's `openspec/changes/`. `npm run fixes:validate` SHALL run the pinned OpenSpec CLI in `fixes/` to validate every active fix change strictly and every archived fix change for completed tasks, and SHALL exit non-zero when either fails.

#### Scenario: Empty archive
- **WHEN** `npm run fixes:validate` runs on a repository with no fix change
- **THEN** it exits with 0

#### Scenario: Archived change with an open task
- **WHEN** an archived fix change's `tasks.md` holds an unchecked task
- **THEN** `npm run fixes:validate` exits non-zero and names the change

### Requirement: A fix change records the discrepancy, the work and its verification
A fix change SHALL be named `fix-<cluster>-<suffix>`, the suffix being the last eight characters of the thread ID. Its `proposal.md` SHALL describe the discrepancy (the cluster, its image hash and members with case, capture, change core, differing pixels and OCR text), the hypothesis with its claim, mechanism, cited locations, evidence and confidence, the challenge's outcome and the check's observations. Its `tasks.md` SHALL list every subtask as a checked task with its files, its blockers and the record that implemented it. Its `verification.md` SHALL list the narrow check and each widening level with its run folder, execution outcome (capture status, coverage, failures) apart from its visual result (rows passed and failed, and the attribution of each failing row). The change SHALL also hold `fix.json`, a record of the same facts that the workflow validates with a schema when it reads it; the markdown SHALL be rendered from that record.

#### Scenario: A promoted fix with two subtasks
- **WHEN** an attempt with two subtasks, the second blocked by the first, is promoted
- **THEN** its fix change's `tasks.md` lists both as checked tasks, the second naming the first as its blocker, and `fix.json` lists both with their records and files

### Requirement: The OpenSpec CLI creates, validates and archives every fix change
The workflow SHALL create each fix change with the pinned CLI (`openspec new change <name> --schema fix`) in a staging root that holds a copy of the repository's `fixes/openspec/config.yaml` and `schemas/`, with the CLI's telemetry turned off. Before archiving it SHALL check that every task is checked, then run `openspec validate <name> --strict` and `openspec archive <name> -y --skip-specs`. An unchecked task, a non-zero exit of the CLI or an archive folder that the CLI did not create SHALL be a setup error naming the change and holding the CLI's output.

#### Scenario: The CLI refuses the change
- **WHEN** strict validation of a fix change fails
- **THEN** the run ends with a setup error holding the CLI's output, and no commit is made

### Requirement: Fix changes are turned on per thread
`npm start -- --fix-changes` SHALL start a thread that works in fix changes: priors in diagnosis, planned repair and a fix change with every promotion. The option SHALL be stored with the thread, so a resumed thread keeps it, and a thread stored without it SHALL run without fix changes. Without the option the workflow SHALL run as it does without this capability. `--fix-changes` together with `--unattended` SHALL be a setup error before any step, since no certificate covers the prompts it adds.

#### Scenario: Off by default
- **WHEN** `npm start` runs without `--fix-changes` and a cluster is promoted
- **THEN** the hypothesis prompt has no priors, the repair runs one job per attempt, and the fix commit holds only `Chummer/`

#### Scenario: With unattended
- **WHEN** `npm start -- --fix-changes --unattended --no-repair` is given
- **THEN** the run ends with a setup error (exit 3) before any step
