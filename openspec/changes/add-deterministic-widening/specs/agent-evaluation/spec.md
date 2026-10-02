## MODIFIED Requirements

### Requirement: Eval records carry labels from separate sources
An eval record SHALL hold, apart from each other, a `check` label (the cluster's check outcome), a `hindsight` label (a grade `symbol`, `file`, `mechanism`, `wrong` or `abstained` and the benchmark item it comes from), a `review` label (a verdict `correct`, `wrong` or `unclear`, an optional note, the reviewer and the time), a `grader` label (a score from 0 to 1, a rationale and the grader job's record), for a repair job a `repair` label (the outcome `passed` or `rejected` of its attempt, the rejection stage and reason, and the time) and, for a repair job whose attempt was widened, a `widening` label (the outcome `promoted` or `rejected`, the rejection stage `apply`, `build`, `narrow`, `character`, `mode`, `suite` or `promote` and reason, the commit of a promotion, and the time). A record stored without the `repair` or `widening` label SHALL be read with it empty. Only hindsight grades and `correct` or `wrong` review verdicts SHALL count as gold (a `correct` verdict gives a dataset item its gold root cause; a `wrong` verdict is gold that the answer is wrong and gives none); a grader score, a repair label and a widening label SHALL NOT change any other label, any dataset's gold or any metric. Each record SHALL name its origin (`workflow`, `eval-run` or `grader`), and the review queue, the grader and datasets SHALL use `workflow` hypothesis and challenge records only. A challenge record of the workflow SHALL name the hypothesis record it challenged. `npm run eval -- records` SHALL print the records' counts by origin, job kind, result and label.

#### Scenario: Challenge names its hypothesis
- **WHEN** a challenge job runs on a cluster's hypothesis
- **THEN** its record names that hypothesis's record, and the grader, datasets and the review page pair the challenge with exactly that hypothesis; a challenge record that names none is not graded and not frozen

#### Scenario: Grader score is not gold
- **WHEN** a record has a grader score of 0.95 and no review or hindsight label
- **THEN** a dataset freezing it gives its item no gold root cause

#### Scenario: Record from before the repair label
- **WHEN** a hypothesis record stored without a `repair` label is read
- **THEN** it is read with `repair` empty and its other labels unchanged

#### Scenario: Record from before the widening label
- **WHEN** a repair record stored with a `repair` label and without a `widening` label is read
- **THEN** it is read with `widening` empty and its `repair` label unchanged
