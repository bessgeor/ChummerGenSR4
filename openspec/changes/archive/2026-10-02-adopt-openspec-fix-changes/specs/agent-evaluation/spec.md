## ADDED Requirements

### Requirement: Finished threads are compared in pairs by cluster
`npm run eval -- compare-threads --baseline <threads> --candidate <threads>` SHALL take two comma-separated lists of thread IDs, read each thread's `outcome.json` and, for each of its clusters, the model time of the workflow records whose thread and subject are that thread and cluster. A cluster on both sides SHALL be one pair; a cluster on one side only SHALL be listed and not paired, and a cluster twice on one side SHALL be a setup error. For each of `fixRate` (1 for `fixed`, else 0) and `modelTime` (seconds), the command SHALL report the pairs, each side's mean, the mean paired difference (candidate minus baseline), its standard error, its 95% t interval and a verdict: `too-few-pairs` below two pairs, else `improved` when the interval lies entirely on the better side (above zero for the fix rate, below zero for model time), `worse` when it lies entirely on the other side, and `no-difference` otherwise. It SHALL write the comparison to `out/evals/comparisons/`. A thread without `outcome.json` SHALL be a setup error.

#### Scenario: Two pairs
- **WHEN** both sides fixed the same two clusters, with 300 and 200 s of model time on the baseline and 400 and 260 s on the candidate
- **THEN** the fix rate's mean difference is 0 and its verdict `no-difference`, the model time's mean difference is 80 s with a 95% t interval from Student's t with one degree of freedom, and its verdict follows from that interval

#### Scenario: Clusters on one side only
- **WHEN** a cluster appears only in a candidate thread
- **THEN** it is listed as unpaired and does not count in either metric
### Requirement: Eval runs show contexts without priors
An eval run SHALL show each job the item's frozen context without the priors a thread with fix changes sealed into it: the job's working folder SHALL have no `priors/` folder and a `context.json` without `priors`, and its prompt SHALL be the one of the run's recorded prompt version, which has no priors section. A run on a dataset frozen from such a thread SHALL therefore record and be certified under the version it measured.

#### Scenario: Dataset frozen from a thread with fix changes
- **WHEN** a hypothesis run starts on a dataset whose contexts hold priors
- **THEN** every prompt starts with `PROMPT_VERSION=hypothesis-v1`, none names a prior, and the run and its records carry `hypothesis-v1`
