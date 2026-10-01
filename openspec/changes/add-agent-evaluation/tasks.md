# Tasks

## 1. Labels, benchmark and review

- [x] 1.1 Add eval record version 2 (origin, the four label kinds, the upgrade of version 1), record listing and `npm run eval -- records`, the root-cause grading, benchmark items (`benchmark add|check`, revert detection) and `npm run eval -- hindsight`. Evidence: unit tests for the upgrade, label independence, each grade, the earliest-fix rule, records after the fix, revert detection, the setup errors of `benchmark add` and a patch that no longer replays (temporary git repository), pass.
- [x] 1.2 Add the `grade` job kind (profile, prompt, schema, validation) and `npm run eval -- grade`, and the review queue with `npm run eval -- queue`. Evidence: unit tests with a fake agent runner for the grader's scratch copy, label and record, an out-of-range score, a changed context, a usage limit and `infra`, and for the queue's selection, disagreements, strata and order, pass.
- [x] 1.3 Add the review page `npm run review`. Evidence: unit tests over a real HTTP server on a fixture store for the queue page, the record page, the evidence route's refusal of unlisted files, a verdict post, an invalid verdict and an unknown record, pass.

## 2. Datasets, runs and certificates

- [ ] 2.1 Add frozen datasets with `npm run eval -- freeze`. Evidence: unit tests on fixture threads for the items, observations (and conflicting runs), gold from a benchmark item and from a review, partitions by cluster, versions, the content hash, and a changed copy refused on load, pass.
- [ ] 2.2 Add eval runs (`npm run eval -- run`, `--resume`) and the paired comparison (`npm run eval -- compare`). Evidence: unit tests with a fake agent runner for both metrics of both job kinds, failures, the summary and its Wilson intervals, resume after a kill, the t-interval and verdicts against hand-computed values, and the comparison's setup errors, pass.
- [ ] 2.3 Add certificates (`npm run eval -- certify`) and `npm start -- --unattended`; describe evaluation in `AGENTS.md` and `README.md`. Evidence: unit tests for issue and refusal (lower bound, partition, cost) and for the gate (missing, invalid, differing, `--no-diagnosis`, resume), pass; `workflow:typecheck` and `workflow:test` pass.

## 3. Verification and archive

- [ ] 3.1 Run live on the records of real workflow threads: `records`, `grade` (Claude), `queue` and the review page in a browser, `freeze`, eval runs of both job kinds (one killed and resumed), `compare`, a refused and an issued certificate, and `npm start -- --unattended` refused without certificates and run on one case with them. Record in `verification.md` the canonical hash before and after, execution outcomes apart from visual results, the eval deltas with their intervals, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 3.2 Archive the change with `openspec archive add-agent-evaluation`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
