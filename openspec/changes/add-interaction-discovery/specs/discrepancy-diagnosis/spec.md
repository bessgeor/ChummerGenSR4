## MODIFIED Requirements

### Requirement: Provider, model and effort are chosen per job kind
The local workflow profile SHALL be able to choose, for each job kind (`hypothesis`, `challenge`, `grade`, `repair`, `rank`, `scenario`), the provider (`claude` or `codex`), the model (or the CLI's default), the effort and the time limit, and SHALL be able to set the model pool size, the run budget for model time, the CLI executables, the certificates folder and the repair deadline. Without a profile, hypothesis, grade, repair, rank and scenario jobs SHALL run on Claude and challenge jobs on Codex. The provider, model and effort SHALL be recorded with every job. An invalid profile SHALL be a setup error, a time limit above 35 000 minutes included.

#### Scenario: Challenger on another provider by default
- **WHEN** no profile sets the job kinds and a cluster is diagnosed
- **THEN** its hypothesis job runs on Claude and its challenge job on Codex, and both records name their provider

#### Scenario: Unknown provider
- **WHEN** the profile names provider `other` for `challenge`
- **THEN** the run ends with status 3 naming the profile

#### Scenario: Discovery jobs on Codex
- **WHEN** the profile names provider `codex` for `scenario`
- **THEN** discovery runs its scenario jobs on Codex and its rank job on Claude
