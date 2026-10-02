## MODIFIED Requirements

### Requirement: Each passed repair attempt is widened in order
After repair, the workflow SHALL widen every cluster whose latest repair attempt passed and has no widening yet, one cluster at a time in cluster ID order, each on the source accepted before it: the thread's source snapshot plus the attempts promoted earlier in the thread, also those promoted before a next attempt of another cluster. No model job SHALL run during widening. Every step of a widening (preparing the widened candidate, each level, the promotion, the rollback) SHALL be checkpointed on its own, so a resumed thread repeats only the step that was interrupted.

#### Scenario: Two passed attempts
- **WHEN** the repairs of two clusters pass
- **THEN** the cluster with the lower ID is widened first, and the second is widened only after the first was promoted or rolled back

#### Scenario: Killed during a level
- **WHEN** a run is killed while the `mode` level of a widening is capturing, and the thread is resumed
- **THEN** the `narrow` and `character` levels are not captured again, and the `mode` level is captured again

#### Scenario: A next attempt after a promotion
- **WHEN** one cluster's attempt was promoted and another cluster's second attempt passes
- **THEN** the second attempt is widened on the source with the promoted patch, and the promoted cluster is not widened again

### Requirement: Every widening is documented and labelled
Each final widening SHALL write `widening/<cluster>/attempt-<n>/widening.json` in the thread's folder, `n` being the attempt's number, with the attempt and its record, every level (its selection, run folder, execution outcome, rows passed and failed, each failing row's attribution and baseline run, and the baseline capture's run and execution outcome), the outcome `promoted` or `rejected`, the stage and reason of a rejection, and the commit of a promotion. A widening SHALL work only in its attempt's folder, so a next attempt's widening never removes an earlier one's document. The thread's `widening.json` SHALL list every current widening, the earlier widenings of clusters that got a next attempt, the accepted branch and commit, and totals. The repair record of a widened attempt SHALL get the automatic `widening` label with the outcome, stage, reason and commit.

#### Scenario: Remaining findings are listed
- **WHEN** an attempt is promoted with two `pre-existing` rows at the `suite` level
- **THEN** its `widening.json` lists both rows with their baseline runs, and the report counts them as pre-existing

#### Scenario: Two widenings of one cluster
- **WHEN** a cluster's first attempt is rejected at the `character` level and its second attempt is promoted
- **THEN** `widening/<cluster>/attempt-1/widening.json` holds the rejection and `widening/<cluster>/attempt-2/widening.json` the promotion
- **AND** the thread's `widening.json` lists both
