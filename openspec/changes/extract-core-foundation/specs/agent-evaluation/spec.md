## MODIFIED Requirements

### Requirement: Eval runs show contexts without priors
An eval run SHALL show each job the item's frozen context without the priors a thread with fix changes sealed into it: the job's working folder SHALL have no `priors/` folder and a `context.json` without `priors`, and its prompt SHALL be the one of the run's recorded prompt version, which has no priors section. A run on a dataset frozen from such a thread SHALL therefore record and be certified under the version it measured.

#### Scenario: Dataset frozen from a thread with fix changes
- **WHEN** a hypothesis run starts on a dataset whose contexts hold priors
- **THEN** every prompt starts with `PROMPT_VERSION=hypothesis-v2`, none names a prior, and the run and its records carry `hypothesis-v2`
