## MODIFIED Requirements

### Requirement: Eval runs score a configuration on a dataset
`npm run eval -- run --dataset <folder>` SHALL run the prompt of the dataset's job kind, with the tuning configuration `--tuning` selects (default the job kind's active one), with the profile's agent choice on every item of the chosen partition (default `test`) `--repeat` times, each in a scratch copy of the item's context and snapshot, validated like a diagnosis job and recorded with origin `eval-run`. Each sample SHALL get the `prediction` metric (a hypothesis passes when it explains, has at least one observed prediction and every observed prediction held; a challenge passes when its verdict on the hypothesis agrees with the observations by the same rule) and the `rootCause` metric when the item has gold (a hypothesis passes when its grade is `symbol` or `file`; a challenge when it keeps a right hypothesis or replaces a wrong one with a right alternative), else null. `invalid_output` and `refused` SHALL fail both metrics and be counted by kind; a usage limit SHALL wait and run the sample again, and every attempt SHALL keep its record: a resumed run and a retry store theirs under the next attempt number, never over an earlier one; `infra` SHALL end the command with status 3. The run folder SHALL hold its settings (with the tuning configuration, none for the code's prompt, and the prompt version it measures), one file per finished sample and a summary with each metric's passes, count, rate and 95% Wilson interval over items (the repetitions of an item are one sample, passing in the share of them that pass), failures by kind, model time and cost with the number of unknown costs. `--resume <runId>` SHALL run only the missing samples with the stored settings, and a prompt version that changed since, or a stored configuration whose base is no longer the code's prompt version, SHALL be a setup error. A run stored without a tuning configuration SHALL be read as one of the code's prompt. A scratch copy that cannot be removed SHALL fail the run after the sample's record is stored.

#### Scenario: Killed and resumed
- **WHEN** an eval run of four samples is killed after two samples finished and is resumed
- **THEN** only the other two samples run, with the agent choice and tuning configuration stored at the start

#### Scenario: Invalid answer counted
- **WHEN** a sample's job fails with `invalid_output`
- **THEN** the sample fails both metrics, the summary counts one `invalid_output`, and the run continues

#### Scenario: Infra failure kept
- **WHEN** a sample fails with `infra` and the run is resumed
- **THEN** the sample runs again as the next attempt and the failed attempt's record is unchanged

#### Scenario: Run from before tuning
- **WHEN** a run folder whose settings have no tuning configuration is resumed or compared
- **THEN** it is read as a run of the code's prompt

### Requirement: Certificates gate unattended dispatch per job kind
`npm run eval -- certify --run <runId> --metric <m> --min-pass <rate>` SHALL issue a certificate for the run's job kind (`hypothesis`, `challenge`, `rank` or `scenario`) only when the run is complete, ran on the `test` partition, the lower bound of the 95% Wilson interval of the metric's pass rate over items (the repetitions of an item count once) is at least the rate and, with `--max-mean-cost-usd`, every sample's cost is known and their mean is at most the limit. The certificate SHALL name the job kind, provider, model, effort, the prompt version the run measured (a tuned one included), run, dataset hash and partition, metric, counts, rate, interval and thresholds, and SHALL replace the job kind's earlier certificate in the certificates folder. A refused certificate SHALL print every reason, write nothing and exit with 1. The run SHALL have measured the job kind's active tuning configuration (the code's prompt when none is active); a candidate is certified only by `tune activate`. An unattended run SHALL compare each certificate with the agent choice and the prompt version it dispatches for that job kind, the active tuning configuration's included.

#### Scenario: Too few samples for the threshold
- **WHEN** a run passed 3 of 3 items and `--min-pass 0.8` is asked
- **THEN** the certificate is refused because the interval's lower bound is below 0.8

#### Scenario: Development partition
- **WHEN** the run ran on the `development` partition
- **THEN** the certificate is refused

#### Scenario: Scenario certificate
- **WHEN** a complete scenario run on the test partition passed `valid` on 20 of 20 items and `--metric valid --min-pass 0.8` is asked
- **THEN** a `scenario.json` certificate is written for the run's agent choice and prompt version

#### Scenario: Candidate run certified directly
- **WHEN** `certify` names the holdout run of a candidate that is not active
- **THEN** the certificate is refused, exit status 1, and the job kind's certificate is unchanged

#### Scenario: Certificate of the code's prompt while a configuration is active
- **WHEN** the scenario certificate names `scenario-v1` and a scenario configuration is active
- **THEN** `npm run discover -- --unattended` refuses to start, naming the certified and the dispatched prompt versions
