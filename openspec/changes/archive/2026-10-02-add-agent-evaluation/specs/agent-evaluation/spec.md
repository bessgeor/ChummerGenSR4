## ADDED Requirements

### Requirement: Eval records carry four kinds of labels
An eval record SHALL hold, apart from each other, a `check` label (the cluster's check outcome), a `hindsight` label (a grade `symbol`, `file`, `mechanism`, `wrong` or `abstained` and the benchmark item it comes from), a `review` label (a verdict `correct`, `wrong` or `unclear`, an optional note, the reviewer and the time) and a `grader` label (a score from 0 to 1, a rationale and the grader job's record). Only hindsight grades and `correct` or `wrong` review verdicts SHALL count as gold (a `correct` verdict gives a dataset item its gold root cause; a `wrong` verdict is gold that the answer is wrong and gives none); a grader score SHALL NOT change any other label, any dataset's gold or any metric. Each record SHALL name its origin (`workflow`, `eval-run` or `grader`), and the review queue, the grader and datasets SHALL use `workflow` records only. A challenge record of the workflow SHALL name the hypothesis record it challenged. `npm run eval -- records` SHALL print the records' counts by origin, job kind, result and label.

#### Scenario: Challenge names its hypothesis
- **WHEN** a challenge job runs on a cluster's hypothesis
- **THEN** its record names that hypothesis's record, and the grader, datasets and the review page pair the challenge with exactly that hypothesis; a challenge record that names none is not graded and not frozen

#### Scenario: Grader score is not gold
- **WHEN** a record has a grader score of 0.95 and no review or hindsight label
- **THEN** a dataset freezing it gives its item no gold root cause

### Requirement: Accepted fixes are benchmark items
`npm run eval -- benchmark add --cluster <id> --fix <commit> --mechanism <class>` SHALL write `workflow/evals/benchmark/<itemId>.json` with the cluster's identity, image hash, cases, captures and members from a thread's `triage.json` (the newest thread with the cluster, or `--thread`), the fix's parent as base commit, the fix commit with its commit time, the mechanism class, the patch of the fix limited to `Chummer/`, `bin/data/` and `bin/lang/` and, per touched file, its hunks (old start, old line count, header, removed and added lines), the regression commit when `--regression` names it, and the thread. The item SHALL be of kind `revert` when a regression is named and at least 90% of the fix's changed lines are changed lines of the regression with the other sign in files the regression touched, else `fix`. An unknown cluster, an unknown commit, a merge commit, an empty patch, an unknown mechanism class and an existing item SHALL be setup errors and write nothing. `npm run eval -- benchmark check` SHALL recompute every item's patch from git (with the diff options pinned, so a machine's diff configuration does not change it) and SHALL fail with status 3 naming the item when a commit is missing or the patch differs.

#### Scenario: A fix that undoes its regression
- **WHEN** the fix commit restores the lines a named regression commit changed
- **THEN** the item's kind is `revert`

#### Scenario: Patch no longer replays
- **WHEN** an item's stored patch differs from `git diff` of its base and fix commits
- **THEN** `benchmark check` exits with 3 naming the item

### Requirement: Hindsight grades earlier answers against the accepted fix
For every benchmark item, `npm run eval -- hindsight` (and `benchmark add` for its own item) SHALL label each succeeded `workflow` hypothesis and challenge record of the item's cluster that finished before the fix was committed: a hypothesis by its explanation, a challenge by its alternative. The grade SHALL be `symbol` when a location's file is a touched file and its line lies within 3 lines of a hunk's old-side range or its symbol occurs in that file's hunk headers or changed lines, else `file` when a location's file is a touched file, else `mechanism` when the mechanism class equals the item's, else `wrong`; an abstention and a challenge without alternative SHALL be `abstained`. A record graded by several items SHALL keep the grade of the item with the earliest fix. Records that finished after the fix SHALL NOT be labelled. A record SHALL be graded only when each file the fix touches is the same, line endings aside, in the record's thread snapshot as in the fix's parent commit; otherwise it SHALL stay ungraded and the command SHALL name the record and the reason.

#### Scenario: Right file, wrong line
- **WHEN** a hypothesis cites the fixed file at a line 40 lines away from every hunk and a symbol the fix does not mention
- **THEN** its hindsight grade is `file`

#### Scenario: Answer given after the fix
- **WHEN** a record of the cluster finished after the fix commit's time
- **THEN** it gets no hindsight label from that item

#### Scenario: Snapshot is not the fix's base
- **WHEN** a file the fix touches differs between a record's snapshot and the fix's parent commit
- **THEN** the record is not graded, and `hindsight` names the record, the item and the file

### Requirement: An advisory grader orders review
`npm run eval -- grade` SHALL run a `grade` job through the agent runner for each succeeded `workflow` hypothesis and challenge record without a grader label (or the records `--record` names, at most `--limit`), in a scratch copy of the record's context and snapshot outside the repository with the crops as images, and SHALL store its score and rationale as the graded record's `grader` label and the job itself as a record of origin `grader`. The grade jobs of a batch SHALL run side by side up to the model pool size. A context whose hash differs from the record's SHALL be a setup error naming it; a record whose context or thread snapshot no longer exists, and a challenge that names no hypothesis, SHALL be logged and left ungraded. A scratch copy that cannot be removed SHALL fail the command after the job's record is stored. A usage limit SHALL wait like a diagnosis job and run the job again; `infra` SHALL end the command with status 3; `invalid_output` and `refused` SHALL be recorded, leave the label empty and make the exit status 2.

#### Scenario: Grader output out of range
- **WHEN** the grader answers a score of 1.4
- **THEN** the grade job is `invalid_output`, the graded record keeps no grader label and the command exits with 2

### Requirement: Review queue and page
The review queue SHALL hold the succeeded `workflow` hypothesis and challenge records without a review verdict: every hypothesis whose `check` is `confirmed` and whose hindsight grade is not `symbol` or `file`, or whose `check` is `refuted` and whose grade is `symbol` or `file` (disagreements), and per job kind and check label the first `--per-stratum` records (default 3) ordered by the SHA-256 of the seed and the record ID. Disagreements SHALL come first, then graded records by the distance of their score from 0.5 ascending, then ungraded records, ties by record ID. `npm run eval -- queue` SHALL print the queue. `npm run review` SHALL serve on 127.0.0.1 only a page of the queue and per record its members' canonical and candidate crops with their pixel difference, OCR texts, the answer, the check observations and the patch of a benchmark item of the cluster, and a form for a verdict and an optional note. A posted valid verdict SHALL set the record's review label with the OS user as reviewer and show the next queued record. An unknown record SHALL answer 404, an invalid verdict 400 without writing, and an image the record's manifest does not list SHALL NOT be served. A verdict SHALL be accepted only with the token the server put into the form of its record page, and a request SHALL be refused with 403 unless it addresses the server by `127.0.0.1` or `localhost` with the server's port and, when it names an origin, that origin is the server's. The record page SHALL say why the cluster's check is not shown when the thread has no `diagnosis.json` or the cluster no check.

#### Scenario: Disagreement first
- **WHEN** one record is confirmed by its check but graded `wrong` by hindsight and other records were sampled
- **THEN** that record is first in the queue

#### Scenario: File outside the evidence
- **WHEN** the page is asked for `../context.json` or any file the manifest does not list as a crop
- **THEN** it answers 404 and serves nothing

#### Scenario: Verdict from another page
- **WHEN** a page of another site posts a verdict to the server without the page's token
- **THEN** the server answers 403 and writes nothing

### Requirement: Datasets are frozen and partitioned by discrepancy
`npm run eval -- freeze --job <kind> --name <name>` SHALL write a new version `out/evals/datasets/<name>/v<k>/` and never change an existing one. It SHALL hold one item per context (for challenges, per context and hypothesis) of the succeeded `workflow` records of the job kind whose context is still in its thread folder, with copies of the contexts and snapshots, the observations of every case and capture by the thread's capture runs and check run (`not-observed` where two runs disagree), the gold root cause (from the earliest benchmark item covering a source record whose snapshot has the fix's files as the fix's parent has them, else from a `correct` review verdict) or none, and the previous version's hash. Each cluster's items SHALL lie in one partition, `test` or `development`, chosen from the SHA-256 of the seed and the cluster ID and the test percentage. A new version SHALL use the seed and test percentage of the previous version of its name, and others SHALL be a setup error that writes nothing. A record whose context or thread snapshot is gone, and a challenge that names no hypothesis, SHALL be left out with a line saying so. The dataset SHALL be identified by the SHA-256 of its canonical content; freezing and every load SHALL verify each copied context against its hash and each snapshot against its identity, and a mismatch or no item SHALL be a setup error.

#### Scenario: One discrepancy, one partition
- **WHEN** two threads diagnosed the same cluster and a dataset is frozen from both
- **THEN** both items lie in the same partition

#### Scenario: Another seed
- **WHEN** a new version of a dataset is frozen with a seed other than its previous version's
- **THEN** the command exits with 3 and writes no version

#### Scenario: Copied context changed
- **WHEN** a file of a frozen dataset's context copy is edited and an eval run loads the dataset
- **THEN** the run ends with status 3 naming the item and runs no job

### Requirement: Eval runs score a configuration on a dataset
`npm run eval -- run --dataset <folder>` SHALL run the current prompt of the dataset's job kind with the profile's agent choice on every item of the chosen partition (default `test`) `--repeat` times, each in a scratch copy of the item's context and snapshot, validated like a diagnosis job and recorded with origin `eval-run`. Each sample SHALL get the `prediction` metric (a hypothesis passes when it explains, has at least one observed prediction and every observed prediction held; a challenge passes when its verdict on the hypothesis agrees with the observations by the same rule) and the `rootCause` metric when the item has gold (a hypothesis passes when its grade is `symbol` or `file`; a challenge when it keeps a right hypothesis or replaces a wrong one with a right alternative), else null. `invalid_output` and `refused` SHALL fail both metrics and be counted by kind; a usage limit SHALL wait and run the sample again, and every attempt SHALL keep its record: a resumed run and a retry store theirs under the next attempt number, never over an earlier one; `infra` SHALL end the command with status 3. The run folder SHALL hold its settings, one file per finished sample and a summary with each metric's passes, count, rate and 95% Wilson interval over items (the repetitions of an item are one sample, passing in the share of them that pass), failures by kind, model time and cost with the number of unknown costs. `--resume <runId>` SHALL run only the missing samples with the stored settings, and a prompt version that changed since SHALL be a setup error. A scratch copy that cannot be removed SHALL fail the run after the sample's record is stored.

#### Scenario: Killed and resumed
- **WHEN** an eval run of four samples is killed after two samples finished and is resumed
- **THEN** only the other two samples run, with the agent choice stored at the start

#### Scenario: Invalid answer counted
- **WHEN** a sample's job fails with `invalid_output`
- **THEN** the sample fails both metrics, the summary counts one `invalid_output`, and the run continues

#### Scenario: Infra failure kept
- **WHEN** a sample fails with `infra` and the run is resumed
- **THEN** the sample runs again as the next attempt and the failed attempt's record is unchanged

### Requirement: Paired comparison with confidence intervals
`npm run eval -- compare --baseline <runId> --candidate <runId>` SHALL pair two complete runs by item, an item's value being the share of its repetitions that pass, and SHALL report, for the chosen metric over pairs where both values exist, n, both pass rates, the mean paired difference, its standard error and the 95% interval from Student's t with n − 1 degrees of freedom, and the verdict `improved` (lower bound above 0), `worse` (upper bound below 0), `no-difference`, or `too-few-pairs` when n is below 2; and the mean paired differences of model time and cost (over pairs with both costs known, with their count) and the differing configuration fields. Runs on different datasets, job kinds or partitions, with different sample keys, or not complete SHALL be a setup error.

#### Scenario: Different datasets
- **WHEN** the two runs name different dataset hashes
- **THEN** the command exits with 3 and writes no comparison

#### Scenario: One pair
- **WHEN** the runs have one item each
- **THEN** the verdict is `too-few-pairs` and no interval is given

### Requirement: Certificates gate unattended dispatch per job kind
`npm run eval -- certify --run <runId> --metric <m> --min-pass <rate>` SHALL issue a certificate for the run's job kind only when the run is complete, ran on the `test` partition, the lower bound of the 95% Wilson interval of the metric's pass rate over items (the repetitions of an item count once) is at least the rate and, with `--max-mean-cost-usd`, every sample's cost is known and their mean is at most the limit. The certificate SHALL name the job kind, provider, model, effort, prompt version, run, dataset hash and partition, metric, counts, rate, interval and thresholds, and SHALL replace the job kind's earlier certificate in the certificates folder. A refused certificate SHALL print every reason, write nothing and exit with 1.

#### Scenario: Too few samples for the threshold
- **WHEN** a run passed 3 of 3 items and `--min-pass 0.8` is asked
- **THEN** the certificate is refused because the interval's lower bound is below 0.8

#### Scenario: Development partition
- **WHEN** the run ran on the `development` partition
- **THEN** the certificate is refused
