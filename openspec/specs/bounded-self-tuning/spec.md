# bounded-self-tuning Specification

## Purpose
Defines how the prompts of the evaluated job kinds are tuned within fixed bounds: tuning configurations of guidance and context layout, candidates added by a person or proposed by a `tune` job from development runs, eval runs of a configuration, the test partition as a holdout guarded by a ledger, certified activation, rollback, dispatch of the active configurations in workflow and discovery threads, and the resumable tuning cycle.

## Requirements

### Requirement: Tuning configurations change only guidance and context layout
A tuning configuration SHALL name an evaluated job kind (`hypothesis`, `challenge`, `rank` or `scenario`), the base prompt version it extends, 0 to 6 guidance lines of 1 to 400 characters each, not blank, without control, format (zero-width or direction-changing) or line-separating characters and without `PROMPT_VERSION`, and a context layout `inline` or `file`; any other field SHALL make it invalid. Its ID SHALL be `tuned-` followed by the first 12 hex digits of the SHA-256 of its canonical JSON. A job prompted with a configuration SHALL get, after its job kind's instructions and before the context, a section with the guidance lines when there are any, and with `file` no printed context but the instruction to read the sealed `context.json` in its working folder (a challenge still printing its hypothesis); its record SHALL carry the prompt version it has without the configuration followed by `+<ID>`, and its answer SHALL be validated and scored as without it. A configuration whose base prompt version is not the code's current version of its job kind SHALL be a setup error wherever it is used.

#### Scenario: Guidance and file context
- **WHEN** a scenario job is prompted with a configuration of two guidance lines and context `file`
- **THEN** the prompt starts with `PROMPT_VERSION=scenario-v1+tuned-<ID>`, holds both lines in the tuned guidance section, does not print the context, and the record's prompt version is the same

#### Scenario: Stale configuration
- **WHEN** a configuration's base prompt version is `rank-v1` and the code's rank prompt is `rank-v2`
- **THEN** using it is a setup error that names both versions

#### Scenario: Forbidden field
- **WHEN** a candidate file sets a `model` field
- **THEN** it is rejected as invalid and nothing is written

### Requirement: Candidates are added or proposed
`npm run eval -- tune add --file <json>` SHALL store a valid configuration as a candidate under `out/evals/tuning/candidates/<ID>.json` with origin `added`; an equal stored candidate SHALL be kept and named. `npm run eval -- tune propose --run <run> [--metric <m>]` SHALL run one `tune` job, with the profile's agent choice for `tune`, read-only in a scratch copy of a context holding the run's job kind and configuration, the metric, the prompt of the run's first item as a job saw it, every sample of the run (item, repetition, status, message, model time, scores, answer and the item's gold) and the job kind's earlier candidates on the dataset with their measured development differences, with instructions that name both ways a candidate passes the development gate and the value it must keep on every item the baseline answered. The run SHALL be complete and on the `development` partition, else a setup error. A `candidate` answer equal to the run's configuration, or invalid as a configuration, SHALL be `invalid_output`. A valid candidate SHALL be stored with origin `proposed`, the job's record and the run; an abstention SHALL store none. Each attempt SHALL be an eval record of job kind `tune` and origin `workflow`, which the review queue, the grader and datasets SHALL leave out. A usage limit SHALL wait and run the job again; `infra` and `timeout` SHALL be setup errors; `invalid_output` and `refused` SHALL exit with 2.

#### Scenario: Test partition never shown
- **WHEN** `tune propose` names a run on the `test` partition
- **THEN** it exits with 3 and runs no job

#### Scenario: Proposal equals the measured configuration
- **WHEN** the `tune` job answers with the guidance and context of the configuration its run measured
- **THEN** the job is `invalid_output`, no candidate is stored and the command exits with 2

### Requirement: Eval runs measure a chosen configuration
`npm run eval -- run` SHALL take `--tuning active|none|<ID>` (default `active`): the job kind's active configuration, the code's prompt, or a stored candidate. The run SHALL store the configuration (none for the code's prompt) and the prompt version it measures, and `--resume` SHALL use them; a stored configuration that has become stale SHALL be a setup error. A run of a candidate that is not the active configuration on the `test` or `all` partition SHALL be refused with status 3 unless `tune holdout` starts it.

#### Scenario: Candidate on the test partition
- **WHEN** `eval run --tuning <ID> --partition test` names a candidate that is not active
- **THEN** the command exits with 3, says to use `tune holdout`, and starts no run

### Requirement: The test partition is a guarded holdout
`npm run eval -- tune holdout --candidate <ID> --baseline <run> --run <run> [--metric <m>] [--max-exposures <1-3>]` SHALL start the candidate's run on the `test` partition only when both runs are complete, on the `development` partition of the same dataset with the same samples and agent choice, the baseline measured the job kind's active configuration and the other run the candidate, the candidate passes the development gate (the mean paired difference of the metric is above 0, or 0 with a lower mean paired model time, and the candidate has a value of the metric on every repetition of every item the baseline has one on), the ledger records no exposure of the candidate and fewer than the maximum exposures (default 3) of other candidates on the dataset's test items. An exposure SHALL count against every dataset of the job kind whose test partition holds one of its test items, identified by what decides an item's partition (a discrepancy cluster, a discovery target), whatever the dataset's name, version and seed. Otherwise it SHALL print every reason, exit with 1 when the gate or the ledger refused and 3 for a setup error, and write nothing. The ledger SHALL be read, checked and written under a lock folder that one command at a time can create, so commands in two processes do not both pass the limit; a command that cannot get it within ten seconds SHALL end with a setup error naming the folder. Before the run starts it SHALL append the exposure (test items, dataset hash, candidate, both development runs, their comparison, the test run's ID and the time) to `holdout.json` in the tuning folder. The test run SHALL use the candidate development run's repetitions, agent choice, model pool and executables. When the candidate's exposure is recorded but its test run was never created, `tune holdout` SHALL start that run under its recorded ID instead of refusing, and record no new exposure.

#### Scenario: No better on development
- **WHEN** the candidate's development run has the same mean as the baseline and more model time
- **THEN** `tune holdout` exits with 1 and the ledger is unchanged

#### Scenario: Abstains where the baseline answered
- **WHEN** the candidate's mean difference over the items both runs have a value on is 0, its model time is lower, and it has a value of the metric on fewer repetitions of an item than the baseline
- **THEN** `tune holdout` exits with 1 naming the items without a value, and the ledger is unchanged

#### Scenario: Holdout used up
- **WHEN** three candidates were exposed to a dataset's test partition
- **THEN** a fourth candidate's `tune holdout` on it, on a new version of the dataset, or on a dataset with another seed whose test partition holds one of its items, exits with 1 saying a dataset with test items that no candidate has seen is needed

#### Scenario: Killed holdout run
- **WHEN** the candidate's test run is killed after its exposure was recorded
- **THEN** the exposure stays in the ledger and `eval run --resume` finishes the run

#### Scenario: Holdout run never created
- **WHEN** the exposure was recorded and the command stopped before the test run's folder was written
- **THEN** `tune holdout` for the same candidate starts the run under the recorded ID and the ledger keeps one exposure

### Requirement: Activation is certified
`npm run eval -- tune activate --run <run> --baseline <run> --metric <m> --min-pass <rate> [--max-mean-cost-usd <usd>]` SHALL make the candidate of the run the job kind's active configuration only when the run is the test run of its ledger exposure and complete, the baseline is a complete test run of the job kind's active configuration on the same dataset, samples and agent choice, the metric is the one the candidate's development comparison was gated on, the paired comparison of the metric is not `worse` and holds a value of the candidate on every repetition of every item the baseline has one on, and the run meets the certificate rule (95% Wilson lower bound at least the rate, and the mean cost limit when given). Otherwise it SHALL print every reason, exit with 1 and change nothing. On activation it SHALL write the active file `active/<jobKind>.json` in the tuning folder (the new entry with its configuration, time, runs, comparison and certificate, and the replaced entry in the history with the certificate file as it was before), then the job kind's certificate for the tuned prompt version. Asked again, with the same baseline, metric and thresholds, for the run whose activation is active, it SHALL write that entry's certificate again and exit with 0.

#### Scenario: Worse on the holdout
- **WHEN** the paired comparison's 95% interval lies below zero
- **THEN** activation is refused, and the active file and the certificate are unchanged

#### Scenario: Certified candidate
- **WHEN** the comparison is `no-difference` and the Wilson lower bound meets `--min-pass`
- **THEN** the candidate is active, the certificate names its tuned prompt version, and the previous entry is in the history

### Requirement: Rollback restores the previous configuration
`npm run eval -- tune rollback --job <kind> [--reason <text>]` SHALL write the latest history entry's certificate to the certificates folder, or remove the job kind's certificate when the entry has none, then move the active entry with the time, the reason and the certificate file as it was to the rolled-back entries and make that history entry active. A restored configuration whose base prompt version is stale SHALL be named as one that cannot be dispatched. A job kind without history SHALL be a setup error that changes nothing.

#### Scenario: Back to the code's prompt
- **WHEN** a hypothesis configuration was activated over the code's prompt, which had a certificate, and is rolled back
- **THEN** no configuration is active for hypotheses and the certificate file is the one from before the activation

### Requirement: Threads dispatch with the active configurations
`npm start` and `npm run discover` SHALL read the active configurations of the job kinds they dispatch (hypothesis and challenge when the thread runs diagnosis, not with `--no-diagnosis` or `--only` of an earlier node; rank and scenario) from the tuning folder (the profile's `tuning`, else `workflow/evals/tuning/`) when a thread starts and store them in the thread's options; a resumed thread SHALL use the stored ones, and a thread stored without them SHALL use none. A stale or invalid active file of a job kind the thread dispatches SHALL be a setup error before any step runs; one of another job kind SHALL not be read. Hypothesis, challenge, rank and scenario jobs SHALL be prompted with their job kind's configuration and record its prompt version. `--unattended` SHALL require certificates for the prompt versions the thread dispatches.

#### Scenario: Activated between threads
- **WHEN** a scenario configuration is activated after a discovery thread started and the thread is resumed
- **THEN** its remaining scenario jobs use the configuration the thread started with

#### Scenario: Unattended with a tuned prompt
- **WHEN** a hypothesis configuration is active and the hypothesis certificate names `hypothesis-v2`
- **THEN** `npm start -- --unattended --no-repair` refuses to start, naming both prompt versions

### Requirement: A tuning cycle runs the stages in order and resumes
`npm run eval -- tune cycle --dataset <folder> --metric <m> --min-pass <rate> [--candidates <1-3>] [--repeat <n>] [--max-exposures <1-3>] [--max-mean-cost-usd <usd>]` SHALL run a development run of the active configuration, then up to the given number of times a `tune` proposal from that run (seeing the cycle's earlier candidates), a development run of the candidate and their comparison, stopping at an abstention; then `tune holdout` for the candidate that passed the development gate with the highest mean difference (then the lowest model time difference), a test run of the active configuration, and `tune activate`. Every run after the development baseline SHALL use the baseline's agent choice, model pool and executables. It SHALL end `no_improvement` when no candidate passed the development gate, `activated`, `rejected` with the reasons of a refused holdout or activation, or `failed` when a `tune` job failed with `invalid_output` or `refused`. It SHALL record its options, each step's run IDs before the step starts, each result and its outcome in `out/evals/tuning/cycles/<cycleId>/cycle.json`. A resumed cycle whose holdout run was activated already SHALL end `activated` without activating it again, also when that activation has been rolled back since. `tune cycle --resume <cycleId>` SHALL continue with the stored options without repeating a finished step, resuming a recorded run that is not complete. Exit status SHALL be 0 for `activated` and `no_improvement`, 1 for `rejected`, 2 for `failed`, and 3 for a setup error. Every state file of tuning (the ledger, the active files, the certificates, the candidates and the cycle record) SHALL be written to a temporary file and renamed into place, so a stop leaves the earlier file and never a truncated one.

#### Scenario: Killed during a candidate's development run
- **WHEN** a cycle is killed while its first candidate's development run is running and is resumed
- **THEN** the baseline run and the proposal are not repeated, and only the missing samples of that run run

#### Scenario: No candidate is better
- **WHEN** every candidate's development comparison has a negative mean difference
- **THEN** the cycle ends `no_improvement`, exits with 0, and the ledger and the active configuration are unchanged
