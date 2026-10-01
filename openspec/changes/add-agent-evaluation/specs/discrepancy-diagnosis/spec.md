## MODIFIED Requirements

### Requirement: Provider, model and effort are chosen per job kind
The local workflow profile SHALL be able to choose, for each job kind (`hypothesis`, `challenge`, `grade`), the provider (`claude` or `codex`), the model (or the CLI's default), the effort and the time limit, and SHALL be able to set the model pool size, the run budget for model time, the CLI executables and the certificates folder. Without a profile, hypothesis and grade jobs SHALL run on Claude and challenge jobs on Codex. The provider, model and effort SHALL be recorded with every job. An invalid profile SHALL be a setup error, a time limit above 35 000 minutes included.

#### Scenario: Challenger on another provider by default
- **WHEN** no profile sets the job kinds and a cluster is diagnosed
- **THEN** its hypothesis job runs on Claude and its challenge job on Codex, and both records name their provider

#### Scenario: Unknown provider
- **WHEN** the profile names provider `other` for `challenge`
- **THEN** the run ends with status 3 naming the profile

### Requirement: Every model job is recorded
Every model job, including a failed one, a quota failure and an `infra` failure, SHALL be recorded in the workflow's store with one schema for all job kinds: record ID, job kind, origin, thread, subject, context hash, prompt version, provider, model and effort, start and end, duration, usage (and cost when the provider reports it), the result or the failure kind with its message, the validated output, and the `check`, `hindsight`, `review` and `grader` labels. Diagnosis jobs SHALL have origin `workflow`. The check outcome of a cluster SHALL be added as the `check` label of every one of its jobs' records, also those of attempts that ended the run with `infra` before a resume, and setting one label SHALL leave the others unchanged. The thread's `diagnosis.json` SHALL list each cluster's context hash, hypothesis, challenge, check outcome and record IDs.

#### Scenario: Failed job recorded
- **WHEN** a challenge job fails with `invalid_output`
- **THEN** its record has result `invalid_output` with the validation errors, no output, and the cluster's subject

#### Scenario: Label added
- **WHEN** a cluster's check outcome is `refuted`
- **THEN** the records of its hypothesis and challenge jobs carry the label `check: refuted` and their other labels are unchanged
