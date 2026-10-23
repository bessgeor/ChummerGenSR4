# Proposal

## Why

Every diagnosis job is recorded with its output and the check outcome of its cluster, but nothing uses the records. Whether a prompt change, another model or another effort makes hypotheses and challenges better cannot be told: there is no ground truth beyond the check label, no fixed set of cases to run a configuration on, no way to compare two configurations on the same cases, and nothing that says a configuration is good enough to run without somebody watching. The check label alone is exact but partial: a hypothesis can predict the right captures for the wrong reason. A person has to look at a sample of the answers, and the known root cause of a fixed discrepancy has to grade the answers given before the fix.

## What Changes

- **Labels.** The eval record gets four label kinds beside each other: the `check` outcome (automatic, as before), a `hindsight` grade (automatic, from a benchmark item's accepted fix: right symbol, right file, right mechanism only, wrong, or abstained), a `review` verdict (a person's, the only label besides hindsight that counts as gold) and an advisory `grader` score (a model's, used only to order the review queue). Records carry their origin, so jobs of eval runs never mix with the workflow's own, and a challenge record names the hypothesis it challenged.
- **Benchmark items.** A JSON format for replayable accepted fixes in `workflow/evals/benchmark/`: the discrepancy cluster, the commit before the fix, the fix commit with its patch, the touched files, line ranges and symbols, the mechanism class, and the captures that show the discrepancy. A fix whose patch closely matches the inverse of the change that caused the discrepancy is marked `revert`, not `fix`. `npm run eval -- benchmark add` writes one from git and `benchmark check` verifies that it still replays.
- **Advisory grader.** A new job kind `grade` runs through the existing agent runner and profile (Claude by default) on a record's sealed context and answer, and stores a score with a rationale. It never creates gold.
- **Review queue and page.** The queue holds every hypothesis whose check and hindsight labels disagree, plus a stratified sample per job kind and check outcome, ordered by the grader's uncertainty. `npm run review` serves a local page: the canonical crop, the candidate crop and their pixel difference side by side, the answer, the gold patch when one exists, and one-click verdicts with an optional note.
- **Frozen datasets.** `npm run eval -- freeze` copies the contexts, snapshots, observed captures and gold root causes of a job kind's records into a versioned, content-hashed dataset under `out/evals/datasets/`, divided into development and test partitions by cluster, so that one discrepancy never lies in both.
- **Eval runs and paired comparison.** `npm run eval -- run` runs the current prompt with a profile's agent choice on every item of a dataset partition, scores each answer by its predictions against the observed captures and, where gold exists, by its root cause, and can be resumed after a kill. `npm run eval -- compare` pairs two runs on the same dataset and reports the paired difference of pass rates with a 95% confidence interval, and the differences in cost and time.
- **Certificates.** `npm run eval -- certify` issues a certificate for a job kind when the lower bound of the 95% interval of an eval run's pass rate on the test partition meets the threshold. `npm start -- --unattended` refuses to start unless every job kind it would dispatch has a certificate for its current provider, model, effort and prompt version.

Area: tooling only (the `workflow/` workspace, its scripts and docs). The Chummer app, `bin/`, the capture runner, the comparer and the contracts are untouched. Evidence: unit tests with fake agents, a temporary git repository and fixture threads (label upgrade, hindsight grading, revert detection, the queue's selection and order, the review page's routes, dataset freezing and partitions, scoring, resume, the paired statistics, certificates and the gate), and live runs on the records of real workflow threads: the grader and eval runs on the Claude and Codex subscriptions (one eval run killed and resumed), the review page served and used, a paired comparison, a refused and an issued certificate, and `npm start -- --unattended` refused without certificates and run on one case with them, with the canonical hash recorded before and after.

## Capabilities

### New Capabilities

- `agent-evaluation`: labels of the eval records, benchmark items with hindsight grading, the advisory grader, the review queue and page, frozen datasets, eval runs, paired comparison and certificates.

### Modified Capabilities

- `discrepancy-diagnosis`: the eval record gets its origin and the four label kinds; the profile chooses the `grade` job kind too.
- `parity-workflow`: `--unattended` gates diagnosis on certificates.

## Impact

- New files: `workflow/src/evals/` (labels, benchmark, hindsight, grader, queue, datasets, runs, comparison, certificates, the `eval` command), `workflow/src/review/` (the review page), `workflow/evals/benchmark/` and `workflow/evals/certificates/` (empty, with a README each), their tests.
- Edited files: the eval record, the agent job kinds and profile, the diagnosis service (record version), the options and graph start (`--unattended`), `package.json` (`eval` and `review` scripts), `AGENTS.md`, `README.md`.
- No new dependency. Output stays in the git-ignored `out/` (`out/evals/`); grader and eval-run records go to the existing store under `out/workflow/`.
