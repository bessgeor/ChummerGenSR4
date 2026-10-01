# Design

## Context

Every hypothesis and challenge job is an eval record in the workflow's LangGraph store (`out/workflow/store.sqlite`, namespace `eval-record/<job kind>`) with its sealed context hash, prompt version, agent choice, usage, result, output and the `check` label of its cluster. The sealed context (`context.json` and the crops) lives in the thread's folder beside a history-less snapshot of the app's source and data; `triage.json` names the capture runs, and `diagnosis.json` the check run. Prompts are built from the manifest only, and the job's semantic validation needs only the manifest and the snapshot. That is enough to run a job again on the same evidence with another prompt or agent choice, and to grade it.

The purpose of evaluation is tuning prompts and the process around them; deterministic code is covered by tests, not evals. `bin/ChummerGenSR4.exe` stays immutable canonical input: evaluation reads recorded evidence only, and the one live `npm start` run of this change goes through the capture runner, which verifies the canonical hash before and after.

## Goals / Non-Goals

**Goals:**

- Labels from four sources, kept apart: the check outcome, hindsight from an accepted fix, a person's review, and an advisory model grade. Only hindsight and review are gold.
- A benchmark item format for accepted fixes that can be replayed from git.
- Frozen, content-hashed datasets with a development and a test partition that never share a discrepancy.
- Eval runs that are repeatable and resumable, a paired comparison with confidence intervals, and certificates per job kind that gate unattended runs.

**Non-Goals:**

- Producing fixes. A benchmark item names a fix commit that a person accepted; nothing here writes or applies patches.
- Replaying a benchmark item end to end (building its base commit and capturing it). The format carries what a replay needs, and `benchmark check` verifies that git still has it.
- Choosing prompts automatically. Eval runs measure the configuration they are given.

## Decisions

### Eval record version 2

The record keeps every field of version 1 and adds `origin` (`workflow` for the graph's jobs, `eval-run` and `grader` for jobs of this change) and three label kinds next to `check`:

```
labels: {
  check:     "confirmed" | "refuted" | "undecided" | null,
  hindsight: { grade: "symbol" | "file" | "mechanism" | "wrong" | "abstained", item, labelledUtc } | null,
  review:    { verdict: "correct" | "wrong" | "unclear", note, reviewer, reviewedUtc } | null,
  grader:    { score (0..1), rationale, record, gradedUtc } | null,
}
```

`subject.kind` gains `eval-record` (the grader's subject is the record it grades). A version-1 record is upgraded when read (`origin: workflow`, the new labels null) and written as version 2 when a label is set; nothing else changes it. Records are listed by paging the namespace prefix `eval-record`, which the SQLite store already supports. The review queue, the grader and datasets use only `workflow` records, so eval runs never feed themselves.

### Root causes and grading

One function grades an explanation against a root cause. A root cause is a mechanism class and a list of files, each with line ranges (in the source the explanation saw) and symbols. An explanation's location matches a file when the paths are equal (with `/` separators); it matches at symbol level when its line lies in one of the file's ranges (widened by 3 lines) or its symbol occurs in the file's symbols or changed lines. The grade is `symbol` when a location matches at symbol level, else `file` when a location's file matches, else `mechanism` when the mechanism class is the same, else `wrong`; an abstention or a challenge without alternative is `abstained`. `symbol` and `file` count as right.

Root causes come from two places. A benchmark item gives one from its fix: the patch's files, the old-side ranges of its hunks (the explanation saw the source before the fix), the hunk headers' context text as symbols and the changed lines. A `correct` review verdict on a record with an explanation gives one from that explanation's locations and mechanism. An `unclear` verdict, a `wrong` verdict and a grader score give none.

### Benchmark items

`workflow/evals/benchmark/<item>.json`, one file per accepted fix, committed:

```
{ schemaVersion: 1, itemId, kind: "fix" | "revert",
  discrepancy: { clusterId, imageHash, cases, captures, members: [{ case, capture }] },
  base:  { commit },                                   // the fix's parent: the source that shows the discrepancy
  fix:   { commit, committedUtc, mechanism, patch, files: [{ path, hunks: [{ oldStart, oldLines, header, removed, added }] }] },
  regression: { commit } | null,                       // the change that caused it, when known
  provenance: { threadId } }
```

`npm run eval -- benchmark add --cluster <id> --fix <commit> --mechanism <class> [--thread <id>] [--regression <commit>]` takes the discrepancy from the thread's `triage.json` (by default the newest thread that has the cluster), the patch from `git diff <fix>^ <fix>` limited to `Chummer/`, `bin/data/` and `bin/lang/`, and refuses an empty patch, a merge commit and an unknown cluster. The item is `revert` when a regression commit is given and at least 90% of the fix's changed lines are the regression's changed lines with the other sign, in files the regression touched. `benchmark check` recomputes the patch from git and fails when a commit is missing or the patch differs. Adding an item labels the records it can grade (below).

### Hindsight labels

`npm run eval -- hindsight` grades, for every benchmark item, each `workflow` record of its cluster that succeeded and finished before the fix was committed: a hypothesis by its explanation, a challenge by its alternative. A record already labelled from another item keeps the label of the item with the earliest fix. A disagreement is a hypothesis record whose `check` is `confirmed` and whose grade is not right, or whose `check` is `refuted` and whose grade is right.

### Advisory grader

A third job kind, `grade`, in the agent runner and the profile (`agents.jobs.grade`, Claude with effort medium by default). It runs in the same kind of scratch copy as a diagnosis job (the record's context and the snapshot from its thread folder; a context whose hash differs from the record is a setup error) with the crops as images, sees the graded answer (and, for a challenge, the hypothesis it challenged) and answers `{ score, rationale }`: the probability that the answer is right. Its record has origin `grader`, the graded record as subject and prompt version `grade-v1`; the score goes into the graded record's `grader` label. `npm run eval -- grade [--limit n] [--record id]` grades succeeded `workflow` hypothesis and challenge records without a grader label. Usage limits wait with the diagnosis quota waiter; `infra` ends the command with status 3; `invalid_output` and `refused` are recorded, leave the label empty and make the status 2.

### Review queue and page

The queue holds succeeded `workflow` hypothesis and challenge records without a review verdict: every disagreement, and per stratum (job kind × check label) the first `--per-stratum` records (default 3) in the order of `sha256(seed:recordId)`. Disagreements come first, then graded records by `|score − 0.5|` ascending (the grader's least certain answers first), then ungraded ones, ties by record ID.

`npm run review [-- --port 4317 --seed review --per-stratum 3]` serves a page on 127.0.0.1 only, with Node's `http` and no dependency. The record page shows each member's canonical crop, candidate crop and their pixel difference (drawn in the browser from the two crops on a canvas: changed pixels red, the rest dimmed), the OCR texts, the answer, the check observations from `diagnosis.json`, and, when a benchmark item covers the cluster, its patch. A form posts the verdict (`correct`, `wrong`, `unclear`) and an optional note; the reviewer is the OS user name. An image is served only when the manifest lists it. An unknown record is 404, an invalid verdict 400, and the store is written only by a valid post.

### Frozen datasets

`npm run eval -- freeze --job <hypothesis|challenge> --name <name> [--seed dataset] [--test-percent 50] [--reason text]` writes `out/evals/datasets/<name>/v<k>/` and never changes an existing version:

- `dataset.json`: name, version, previous version's hash, reason, job kind, seed, test percent, items, and its own `datasetHash` (SHA-256 of the canonical JSON of everything else).
- `contexts/<contextHash>/` and `sources/<identity>/`: copies of the context folders and snapshots; a copy is verified (the manifest's hash, the snapshot's identity recomputed from its files) when frozen and when a run loads the dataset.

An item is one context (for challenges, one context and one hypothesis), from the succeeded `workflow` records of the job kind whose thread folder still holds the context: `itemId`, cluster, context hash, source identity, the hypothesis (challenge items), the source records, the observations and the gold root cause or null. Observations are what the thread's capture runs (`triage.json`) and its check run (`diagnosis.json`) observed for every case and capture, with the diagnosis check's observation rule; two runs that disagree make the capture `not-observed`. Gold is the root cause of the earliest benchmark item of the cluster that covers a source record, else of a `correct` review verdict. The partition is `test` when `parseInt(sha256(seed:clusterId)[0..8], 16) % 100 < testPercent`, else `development`, so a cluster never lies in both. No item is a setup error.

### Eval runs

`npm run eval -- run --dataset <folder> [--partition test|development|all] [--repeat n] [--name text]` runs the current prompt of the dataset's job kind with the profile's agent choice for it (`PARITY_WORKFLOW_PROFILE` selects another profile) on every item of the partition, `repeat` times, through the pooled agent runner. Each job runs in a scratch copy of the item's context and snapshot, is validated like a diagnosis job and is recorded with origin `eval-run`. Each sample is scored by two metrics:

- `prediction`: a hypothesis passes when it gives an explanation, at least one of its predictions was observed and every observed one held. A challenge passes when it says there is no alternative and the hypothesis passes that rule, or gives an alternative that passes it while the hypothesis has an observed prediction that did not hold.
- `rootCause` (null without gold): a hypothesis passes when its grade is right; a challenge passes when it says there is no alternative and the hypothesis is right, or its alternative is right while the hypothesis is not.

`invalid_output` and `refused` fail both metrics and are counted by kind; a usage limit waits and runs the sample again; `infra` ends the command with status 3. `out/evals/runs/<runId>/` holds `run.json` (dataset ID and hash, job kind, partition, repeat, agent choice, prompt version), one file per finished sample, and `summary.json` with each metric's passes, sample count, rate and 95% Wilson interval, the failures by kind, model time and cost (with the number of samples whose cost is unknown). `--resume <runId>` continues with the stored settings and runs only the missing samples; a prompt version that changed since is a setup error.

### Paired comparison

`npm run eval -- compare --baseline <runId> --candidate <runId> [--metric prediction|rootCause]` requires both runs to be complete, on the same dataset hash, job kind and partition, with the same sample keys (item and repetition); otherwise it is a setup error. For the pairs where both values exist it reports n, both pass rates, the mean paired difference `d̄`, its standard error `s/√n` and the 95% interval `d̄ ± t(0.975, n−1)·s/√n`, and the verdict `improved` (lower bound above 0), `worse` (upper bound below 0), `no-difference`, or `too-few-pairs` (n < 2). It also reports the mean paired differences of model time and of cost (over pairs whose costs are both known, with that count) and the configuration fields that differ. The report goes to `out/evals/comparisons/<baseline>--<candidate>.json`.

### Certificates and the unattended gate

`npm run eval -- certify --run <runId> --metric <m> --min-pass <rate> [--max-mean-cost-usd <usd>]` reads a complete run on the `test` partition. It issues a certificate when the lower bound of the Wilson interval of the metric's pass rate is at least `--min-pass` and, when given, the mean cost is at most the limit (an unknown cost refuses it). The certificate (`<job kind>.json` in the certificates folder: `workflow/evals/certificates/` or the profile's `certificates`) holds the job kind, the agent choice (provider, model, effort), the prompt version, the run, the dataset ID, hash and partition, the metric, counts, rate, interval, thresholds and the time of issue. Refused, it prints the reasons, writes nothing and exits 1.

`npm start -- --unattended` (kept by a resumed thread) checks, before any node runs and on every resume, that each job kind diagnosis dispatches (`hypothesis`, `challenge`; none with `--no-diagnosis` or `--only` of an earlier node) has a valid certificate whose agent choice and prompt version equal the thread's. Otherwise the run ends with status 3 naming each job kind and why.

### Command layout

`npm run eval -- <command>` (`records`, `benchmark add|check`, `hindsight`, `grade`, `queue`, `freeze`, `run`, `compare`, `certify`) and `npm run review` have their own composition roots in `workflow/src/evals/eval-main.ts` and `workflow/src/review/review-main.ts`, share the workflow's store, profile and agent runners, and exit with 0, 1 (certificate refused), 2 (a grader job failed) or 3 (setup error).

## Risks / Trade-offs

- [Small datasets give wide intervals] → The intervals and n are always printed, and a certificate uses the interval's lower bound, so a handful of samples cannot certify a high rate.
- [The prediction metric can be gamed by predicting obvious captures] → It is labelled partial; root-cause gold, when present, is reported beside it, and the review queue samples every stratum.
- [Hindsight assumes the fix touched the root cause] → A fix that also touches unrelated code widens the root cause; review verdicts can disagree with hindsight, and disagreements with the check go to the queue first.
- [Dataset copies take space] → Snapshots are shared by identity inside a dataset; datasets live in the git-ignored `out/`.

## What fixture tests prove and what only a live run can

Fixture tests (fake agents, a temporary git repository, fixture threads) prove the label upgrade, grading, revert detection, the queue's selection and order, the page's routes and its refusal of unlisted files, freezing and verification of datasets, scoring, resume, the statistics, certificates and the gate's decisions. Only live runs prove that the grader and eval jobs run on the real CLIs under the subscriptions on real contexts, that a killed eval run resumes, that the page shows real crops in a browser, and that `npm start -- --unattended` refuses and runs on the real host.
