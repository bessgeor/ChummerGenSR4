## ADDED Requirements

### Requirement: The outcome records the thread's discovery
`outcome.json` SHALL hold `discovery`: null when the thread did not discover, else the discovery thread, its exit status, the scenarios it admitted, those of them that differ and the path of its `discovery.json`. The thread's outcome SHALL stay about its planned scope: a scenario admitted by its discovery SHALL NOT change it.

#### Scenario: Clean scope with an admitted scenario
- **WHEN** a thread's planned scope has no finding and its discovery admits a scenario that differs
- **THEN** the outcome is `verified_for_scope` and `outcome.json` lists the admitted scenario as differing
