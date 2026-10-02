## MODIFIED Requirements

### Requirement: Fix changes are turned on per thread
`npm start -- --fix-changes` SHALL start a thread that works in fix changes: priors in diagnosis, planned repair and a fix change with every promotion. The option SHALL be stored with the thread, so a resumed thread keeps it, and a thread stored without it SHALL run without fix changes. Without the option the workflow SHALL run as it does without this capability. `--fix-changes` together with `--unattended` SHALL be a setup error before any step, since no certificate covers the prompts it adds.

#### Scenario: Off by default
- **WHEN** `npm start` runs without `--fix-changes` and a cluster is promoted
- **THEN** the hypothesis prompt has no priors, the repair runs one job per attempt, and the fix commit holds only the compiled source, `Chummer/` and `Core/`

#### Scenario: With unattended
- **WHEN** `npm start -- --fix-changes --unattended --no-repair` is given
- **THEN** the run ends with a setup error (exit 3) before any step
