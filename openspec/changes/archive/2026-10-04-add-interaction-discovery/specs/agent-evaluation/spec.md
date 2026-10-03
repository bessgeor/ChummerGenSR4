## ADDED Requirements

### Requirement: Rank and scenario jobs are evaluated
`npm run eval -- freeze --job rank|scenario --name <name>` SHALL write a new dataset version with one item per context of the succeeded `workflow` records of the job kind that have a `discovery` label and whose context folder is still in its discovery thread folder, with copies of the context and the snapshot, verified like other datasets; a scenario item's gold SHALL be its plan's case and selected tab names when its label is `proven`, else none; a rank item's gold SHALL be the targets its threads proved and those whose scenario executed without proof in a thread while no thread proved them; a scenario that did not execute SHALL say nothing about its target. Scenario items SHALL be partitioned by target ID and rank items by context hash, with the seed rules of other datasets. `npm run eval -- run` on such a dataset SHALL stage each item like a discovery job, record it with origin `eval-run`, and score `valid` (rank: the answer passed validation; scenario: its plan passes the plan validator against the context's fixtures, tab texts and labels, and an abstention has no value) and `reached` (rank: true when its highest-scored target that is not `infeasible` is among the gold's proven targets, false when among the unproven ones or when no target is left that is not `infeasible` and the gold has a proven or an unproven target, else null; scenario: true when its plan is valid, uses the gold plan's fixture case and selects every tab name of the gold plan, false otherwise, null without gold); `invalid_output` and `refused` SHALL fail both metrics where they have a value. The summary, `--resume`, `compare --metric valid|reached` and `certify --metric valid|reached` SHALL work on these runs as on the others; `compare` without `--metric` SHALL use the first metric of the runs' job kind (`prediction` or `valid`), and a metric the run's job kind does not score SHALL be a setup error.

#### Scenario: Scenario item without a proven plan
- **WHEN** a scenario record labelled `not-proven` is frozen and its item is run
- **THEN** the sample has a `valid` value and no `reached` value

#### Scenario: Wrong metric
- **WHEN** `certify --metric rootCause` names a scenario run
- **THEN** the command exits with 3 and writes no certificate

## MODIFIED Requirements

### Requirement: Eval records carry labels from separate sources
An eval record SHALL hold, apart from each other, a `check` label (the cluster's check outcome), a `hindsight` label (a grade `symbol`, `file`, `mechanism`, `wrong` or `abstained` and the benchmark item it comes from), a `review` label (a verdict `correct`, `wrong` or `unclear`, an optional note, the reviewer and the time), a `grader` label (a score from 0 to 1, a rationale and the grader job's record), for a repair job a `repair` label (the outcome `passed` or `rejected` of its attempt, the rejection stage and reason, and the time), for a repair job whose attempt was widened, a `widening` label (the outcome `promoted` or `rejected`, the rejection stage `apply`, `build`, `narrow`, `character`, `mode`, `suite` or `promote` and reason, the commit of a promotion, and the time) and, for a rank or scenario job, a `discovery` label (the outcome `proven`, `not-proven`, `untested`, `invalid-plan`, `execution-failed` or `abstained`, the number of differing captures or none, and the time). A record stored without the `repair`, `widening` or `discovery` label SHALL be read with it empty. Only hindsight grades and `correct` or `wrong` review verdicts SHALL count as gold (a `correct` verdict gives a dataset item its gold root cause; a `wrong` verdict is gold that the answer is wrong and gives none); a grader score, a repair label and a widening label SHALL NOT change any other label, any dataset's gold or any metric. Each record SHALL name its origin (`workflow`, `eval-run` or `grader`), and the review queue, the grader, hindsight and the hypothesis and challenge datasets SHALL use `workflow` hypothesis and challenge records only. A challenge record of the workflow SHALL name the hypothesis record it challenged. `npm run eval -- records` SHALL print the records' counts by origin, job kind, result and label.

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

#### Scenario: Discovery records stay out of review
- **WHEN** the store holds labelled scenario records and the review queue is built
- **THEN** no scenario record is in the queue and the grader grades none

### Requirement: Datasets are frozen and partitioned by discrepancy
`npm run eval -- freeze --job hypothesis|challenge --name <name>` SHALL write a new version `out/evals/datasets/<name>/v<k>/` and never change an existing one. It SHALL hold one item per context (for challenges, per context and hypothesis) of the succeeded `workflow` records of the job kind whose context is still in its thread folder, with copies of the contexts and snapshots, the observations of every case and capture by the thread's capture runs and check run (`not-observed` where two runs disagree), the gold root cause (from the earliest benchmark item covering a source record whose snapshot has the fix's files as the fix's parent has them, else from a `correct` review verdict) or none, and the previous version's hash. Each cluster's items SHALL lie in one partition, `test` or `development`, chosen from the SHA-256 of the seed and the cluster ID and the test percentage. A new version SHALL use the seed and test percentage of the previous version of its name, and others SHALL be a setup error that writes nothing. A record whose context or thread snapshot is gone, and a challenge that names no hypothesis, SHALL be left out with a line saying so. The dataset SHALL be identified by the SHA-256 of its canonical content; freezing and every load SHALL verify each copied context against its hash and each snapshot against its identity, and a mismatch or no item SHALL be a setup error.

#### Scenario: One discrepancy, one partition
- **WHEN** two threads diagnosed the same cluster and a dataset is frozen from both
- **THEN** both items lie in the same partition

#### Scenario: Another seed
- **WHEN** a new version of a dataset is frozen with a seed other than its previous version's
- **THEN** the command exits with 3 and writes no version

#### Scenario: Copied context changed
- **WHEN** a file of a frozen dataset's context copy is edited and an eval run loads the dataset
- **THEN** the run ends with status 3 naming the item and runs no job

### Requirement: Certificates gate unattended dispatch per job kind
`npm run eval -- certify --run <runId> --metric <m> --min-pass <rate>` SHALL issue a certificate for the run's job kind (`hypothesis`, `challenge`, `rank` or `scenario`) only when the run is complete, ran on the `test` partition, the lower bound of the 95% Wilson interval of the metric's pass rate over items (the repetitions of an item count once) is at least the rate and, with `--max-mean-cost-usd`, every sample's cost is known and their mean is at most the limit. The certificate SHALL name the job kind, provider, model, effort, prompt version, run, dataset hash and partition, metric, counts, rate, interval and thresholds, and SHALL replace the job kind's earlier certificate in the certificates folder. A refused certificate SHALL print every reason, write nothing and exit with 1.

#### Scenario: Too few samples for the threshold
- **WHEN** a run passed 3 of 3 items and `--min-pass 0.8` is asked
- **THEN** the certificate is refused because the interval's lower bound is below 0.8

#### Scenario: Development partition
- **WHEN** the run ran on the `development` partition
- **THEN** the certificate is refused

#### Scenario: Scenario certificate
- **WHEN** a complete scenario run on the test partition passed `valid` on 20 of 20 items and `--metric valid --min-pass 0.8` is asked
- **THEN** a `scenario.json` certificate is written for the run's agent choice and prompt version
