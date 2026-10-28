## ADDED Requirements

### Requirement: Only an attempt's selected try is widened
Widening SHALL widen only the try its attempt selected, through the commit at the top level of the attempt's `attempt.json`; a try that was not selected SHALL NOT be widened, promoted or rolled back. The widening document SHALL name the selected try.

#### Scenario: Two passed tries
- **WHEN** an attempt passed with its second of two tries selected
- **THEN** only the second try's commit is applied to the accepted commit, and `widening.json` names try 2
