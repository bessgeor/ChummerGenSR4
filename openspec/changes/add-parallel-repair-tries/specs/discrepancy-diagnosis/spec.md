## ADDED Requirements

### Requirement: A cluster may get several independent hypotheses
The profile's `diagnosis.hypotheses` (an integer from 1 to 3, default 1) SHALL set how many hypothesis jobs each cluster gets, each in a fresh session from the same sealed context, started together with the other clusters' hypothesis jobs up to the model pool size. Each hypothesis that does not abstain SHALL get its own challenge job as a single hypothesis does. The check run SHALL cover the predictions of every hypothesis and alternative of every cluster, and each hypothesis SHALL be judged with its own alternative by the existing rule. A cluster SHALL be `confirmed` when at least one of its hypotheses is confirmed, `refuted` when every hypothesis that predicted is refuted, and `undecided` otherwise; it SHALL be abstained only when every hypothesis abstained, and failed when any job failed with `invalid_output` or `refused`. Each hypothesis and challenge record SHALL get the check label of its own hypothesis. A thread stored with one hypothesis per cluster SHALL be read as one hypothesis per cluster.

#### Scenario: One of two hypotheses confirmed
- **WHEN** a cluster's first hypothesis is refuted and its second is confirmed by the check
- **THEN** the cluster is `confirmed`, the first hypothesis record is labelled `refuted` and the second `confirmed`

#### Scenario: Default
- **WHEN** the profile does not set `diagnosis.hypotheses`
- **THEN** each cluster gets one hypothesis job, as before
