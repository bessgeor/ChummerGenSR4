# interaction-discovery Specification

## Purpose
Defines interaction discovery: targets derived from what a baseline's coverage manifest left unobserved or unexercised, a rank job and scenario jobs that propose tab-selection scenarios for them, a plan validator that admits a plan to the desktop lane, proof taken only from the recorded UI trees of the scenarios' capture run, and the registry of admitted scenarios rendered into a case file.

## Requirements

### Requirement: npm run discover runs a resumable discovery thread
`npm run discover -- --from <thread>` SHALL run a discovery thread of its own LangGraph graph, checkpointed in `out/discovery/checkpoints.sqlite` under a thread ID it prints at the start, and `npm run discover -- --resume <thread>` SHALL continue a stopped thread with the options it was started with. It SHALL accept `--case-file`, `--settings-overlay`, `--threshold`, `--canonical-cache` or `--live-canonical` with the defaults of `npm start`, `--targets <n>` from 1 to 10 (default 3) and `--unattended`; an unknown option, a missing value or contradicting options SHALL be a setup error. Its folder SHALL be `out/discovery/threads/<thread>/`. The exit status SHALL be 0 when the thread concluded with nothing below; 1 when an admitted scenario showed a visual difference; 2 when its capture run had status 2 or invalid coverage, or a rank or scenario job failed with `invalid_output` or `refused`; and 3 for a setup error, after which the thread SHALL stay resumable.

#### Scenario: Interrupted and resumed
- **WHEN** a discovery thread is stopped while its scenario jobs run and is resumed
- **THEN** the finished jobs are not run again and the thread continues with its stored options

#### Scenario: Unknown option
- **WHEN** `npm run discover -- --from t --targets 0` is run
- **THEN** it exits with 3 naming the option and starts no thread

### Requirement: The baseline describes the candidate discovery runs
Discovery SHALL read the source inventory and coverage manifest of the `--from` thread's `inventory/` folder, and SHALL fail with a setup error when either is missing, when the source inventory of the working tree has another source hash, when the candidate's build recorded no source or another compiled source than the working tree's, or when a baseline run's candidate SHA-256 differs from the one the build recorded. It SHALL build the capture tools and fingerprint the environment before any job runs, and SHALL NOT build the candidate. A fixture case file or baseline document that changes while the thread runs, a resumed thread included, SHALL be a setup error, since the targets and sealed contexts describe them.

#### Scenario: Designer file changed since the baseline
- **WHEN** a designer file changes after the baseline thread ran and discovery starts
- **THEN** it exits with 3 naming the different source hash and runs no job

### Requirement: Targets come from the baseline's gaps
Discovery SHALL write `targets.json` with one target per group of `unobserved` controls of an active class that share the chain of tab pages containing them (ID `<Class>/<page>/…` by page control names, or `<Class>/-` for controls on no tab page) and one target per tab control of an active class with an unexercised `SelectedIndexChanged`, `Selected`, `Selecting`, `Deselecting` or `Deselected` binding (ID `<Class>.<tabControl>#selection`). Controls and bindings that a registry entry recorded for the same source hash proved SHALL count as covered, and a target left with nothing SHALL be dropped. Unexercised bindings of other events SHALL be counted per event as out of reach of the action vocabulary and SHALL NOT become targets. A thread without targets SHALL conclude without model jobs.

#### Scenario: Controls on one page
- **WHEN** the baseline leaves `lblWeaponAP` and `lblWeaponRC` of `frmCareer`, both inside page `tabWeapons` of page `tabStreetGear`, unobserved
- **THEN** one target `frmCareer/tabStreetGear/tabWeapons` lists both controls

#### Scenario: Proved by the registry
- **WHEN** a registry entry for the current source hash proved every control of a target
- **THEN** that target is not in `targets.json`

### Requirement: A rank job orders the targets with archived fixes as priors
One `rank` job SHALL see a sealed context with every target, the fixture cases of the case file with their mode, form class, selected tab names, captures and a copy of their character file, the known tab texts per form class and the priors, beside a source snapshot whose compiled source equals the candidate's recorded source. Each archived fix change SHALL be scored against each target (3 when its patch changes the target class's code or designer file, 1 per fixture case of the target's mode among its cases, and up to 4 for the Jaccard share of shared words between its OCR texts and the target's control and page texts); the best three that share anything SHALL be copied into the context's `priors/` with their scores and reasons, and a `fix.json` that does not parse SHALL be a setup error. The answer SHALL rank every target exactly once with a score from 0 to 1, a feasibility (`feasible`, `uncertain` or `infeasible`), a fixture case or none, and a non-empty reason; anything else SHALL fail the job as `invalid_output`. The `--targets` targets with the highest scores (ties by ID) that are not `infeasible` SHALL be selected.

#### Scenario: A target left out of the ranking
- **WHEN** the rank answer omits one target
- **THEN** the job fails as `invalid_output`, no scenario job runs and the run exits with 2

#### Scenario: Infeasible target not selected
- **WHEN** the best-scored target is ranked `infeasible`
- **THEN** it gets no scenario job and the next targets are selected

### Requirement: Scenario jobs propose plans in the case-file actions
Each selected target SHALL get one `scenario` job, sent side by side up to the model pool size, that sees a sealed context with the target, its rank, the fixture cases with their actions and a copy of their character file, the known tab texts and the known `waitFor` labels, beside the snapshot. Every file a context lists SHALL carry its SHA-256 in the context, and a file that differs when the context is read again SHALL be a setup error. The answer SHALL be a plan (a fixture case, actions, the target's controls it expects to show, a reason) or an abstention with a reason; a plan naming an unknown case or expecting a control outside the target, or an empty reason, SHALL fail the job as `invalid_output`. Rank and scenario jobs SHALL run read-only in a scratch copy of their context and the snapshot, SHALL be recorded as eval records with their context hash and prompt version, SHALL wait out a usage limit as diagnosis jobs do, and SHALL end the run with a resumable setup error on `infra` or `timeout`. A job that finds the run budget spent when it gets its place SHALL NOT start, and its target SHALL end `budget_exhausted`.

#### Scenario: Usage limit
- **WHEN** a scenario job fails with `quota_exhausted`
- **THEN** the thread waits as diagnosis does and runs the job again, and both attempts keep their records

#### Scenario: Abstention
- **WHEN** a scenario job abstains
- **THEN** its target gets no plan, its record is labelled `abstained`, and the exit status is not changed by it

### Requirement: Plans are validated before they use the lane
A plan SHALL be valid only when its case is a fixture case of the case file; it has at most 24 actions, each a `selectTab` with a `name` and without `optional`, a `waitFor` with a `label`, a `wait` with `milliseconds` from 0 to 10 000 or a `capture` with a `name` matching `^[a-z0-9][a-z0-9-]*$`; it has one to four captures with unique names and ends with a capture; every `selectTab` name is a known tab text of the case's form class (a designer text of one of its tab pages, a `Tab_` string of the English language file, or a page an exercise proof of the baseline names for that class); and every `waitFor` label is a designer text of a control of an active class or a string of the English language file. An invalid plan SHALL get the outcome `invalid-plan` with every reason and SHALL NOT be captured.

#### Scenario: Unknown tab
- **WHEN** a build plan selects the tab `Lifestyles`, which no tab page, language string or baseline proof names
- **THEN** the plan is `invalid-plan` with that reason and the capture run does not include it

#### Scenario: Include is not allowed
- **WHEN** a plan contains an `include` action
- **THEN** the plan is `invalid-plan`

### Requirement: Valid plans run in one capture run and prove coverage only from trees
The valid plans SHALL run in one capture runner call on the desktop lane, with UI trees and the thread's overlay, threshold and canonical cache, after checking that the capture inputs and the capture runner's environment fingerprint are those the thread started with (else a setup error), from a generated case file in the thread folder with one entry per plan named `<mode>-<file>@<scenario>`; exit status 3, a run that covered other cases and a run of another candidate than the built one SHALL be setup errors. Each plan's execution outcome SHALL be `executed` when both sides of its case have no failure, nothing not run, contiguous records and no reason the coverage audit gave for the case, else `execution-failed`; its visual outcome SHALL be `clear` when every result row of its case is within the threshold, else `finding` with the differing captures; and it SHALL be reported apart from the execution outcome. Its proofs SHALL be the controls not observed in the baseline nor proved by the registry that the coverage manifest of the scenario run lists as observed in its case, and the selection bindings that manifest lists as exercised in its case and the baseline did not. A plan SHALL be `proven` only when it executed and has a proof, and `not-proven` when it executed without one; the plan, its expected controls and the model's answer SHALL NOT count as coverage.

#### Scenario: The tree shows a target control
- **WHEN** a scenario's capture tree shows `lblInitiateGradeLabel`, unobserved in the baseline
- **THEN** the scenario is `proven` with that control among its proofs

#### Scenario: Expected but not shown
- **WHEN** a plan expects `lblWeaponAP` and its trees never show it
- **THEN** the plan is `not-proven` and the control stays unobserved

#### Scenario: Failed action
- **WHEN** the candidate side of a scenario fails its `waitFor`
- **THEN** the scenario is `execution-failed`, has no proof, and the run exits with 2

### Requirement: The scenario registry keeps proven scenarios and findings
A scenario that executed and either proved something or showed a finding SHALL be admitted to `parity/discovery/registry.json` with its case, fixture case, mode, scenario name, actions and their hash, target, source hash, proofs, visual outcome and differing captures, discovery thread, run ID, record IDs and time, unless an entry recorded for the same source hash has the same fixture case and actions, which SHALL make it a `duplicate`; such an entry of another source hash SHALL be replaced by it. A register step that runs again in the same thread SHALL neither count that thread's own admissions as earlier proofs nor as duplicates. The registry SHALL be rendered into the case file `parity/cases/discovered.json`, one character entry per registry entry with its own actions and scenario name, and both files SHALL be written together. A registry that does not match its schema, a case file that differs from the registry's rendering, a registry whose startup delay or settle time differs from the fixture case file's, and the registry's own case file named as the fixture case file SHALL each be a setup error. Discovery SHALL NOT commit them. Rank and scenario records SHALL get the automatic `discovery` label: a scenario `proven`, `not-proven`, `invalid-plan`, `execution-failed` or `abstained`, with its number of differing captures when it executed; the rank `proven` when a selected target was proven, `not-proven` when one executed and none was proven, else `untested`.

#### Scenario: Finding without new coverage
- **WHEN** a scenario executed, proved nothing and one of its captures differs beyond the threshold
- **THEN** it is admitted with the visual outcome `finding`, `discovered.json` gains its entry, and `npm start -- --case-file parity/cases/discovered.json` captures, compares and triages it

#### Scenario: Hand-edited case file
- **WHEN** `parity/cases/discovered.json` was edited so that it differs from the registry's rendering and discovery starts
- **THEN** it exits with 3 naming the file

#### Scenario: The registry's own case file as the fixture case file
- **WHEN** `--case-file` names `parity/cases/discovered.json`
- **THEN** discovery exits with 3 before any job runs and rewrites nothing

### Requirement: The discovery document reports execution apart from visual results
`conclude` SHALL write `discovery.json` with the baseline thread, the source hash, the targets with their rank, each selected target's scenario record, plan, validation reasons, case, execution outcome, visual outcome, proofs and admission, the capture run's folder with its status, coverage validity and failures apart from its rows passed and failed, the coverage before and after (baseline counts plus what the run proved), and the registry's entry count before and after. It SHALL print one line per selected target and a `Discovery:` line with the counts.

#### Scenario: Nothing proven
- **WHEN** every plan executed and none proved anything or differed
- **THEN** the coverage after equals the coverage before, nothing is admitted, and the exit status is 0

### Requirement: Unattended discovery needs certificates
`npm run discover -- --unattended` SHALL start only when the certificates folder holds valid `rank` and `scenario` certificates for the thread's provider, model, effort and prompt version of each; otherwise it SHALL exit with 3 listing every problem.

#### Scenario: No scenario certificate
- **WHEN** only a `rank` certificate exists and `--unattended` is given
- **THEN** discovery exits with 3 naming the missing `scenario` certificate
