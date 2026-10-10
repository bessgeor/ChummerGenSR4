# Tasks

## 1. Configurations and prompts

- [x] 1.1 Add the tuning configuration (schema, canonical ID, staleness check) and prompt the four evaluated job kinds with it: the tuned guidance section, the `file` context layout and the tuned prompt version. Evidence: workflow tests for the schema's bounds and forbidden fields, the ID, a stale base, and each job kind's prompt with and without a configuration.

## 2. State and dispatch

- [x] 2.1 Read and write the tuning folder (active files, holdout ledger, candidates) and dispatch the active configurations in `npm start` and `npm run discover` threads, with the unattended gate on the dispatched prompt version. Evidence: workflow tests for new and stored threads' options, a stale active file, the records' prompt versions and the unattended gate.

## 3. Evaluation of configurations

- [x] 3.1 Run, resume and compare eval runs of a configuration (`--tuning`), refusing a candidate's test run outside the holdout. Evidence: workflow tests for the stored settings, an old run without a configuration, a stale configuration at resume and the refused test run.
- [x] 3.2 Add candidates with `tune add` and propose them with the `tune` job (`tune propose`). Evidence: workflow tests with a fake agent runner for the context (development samples only), an equal proposal as `invalid_output`, an abstention, and the record kept out of the queue.

## 4. Holdout, activation and rollback

- [x] 4.1 Gate and record holdout exposures (`tune holdout`), activate certified candidates (`tune activate`) and roll back (`tune rollback`). Evidence: workflow tests for the development gate, the ledger limits, a killed holdout run, refused and certified activation, and rollback with and without an earlier certificate.

## 5. Cycle and docs

- [x] 5.1 Run the tuning cycle (`tune cycle`, `--resume`) and document tuning in `AGENTS.md` and `README.md`. Evidence: workflow tests with a fake agent runner for the stage order, `no_improvement`, `rejected`, `activated` and a resume after a kill; `npm run workflow:typecheck` passes and every workflow test file passes (in two invocations, recorded in `verification.md`).

## 6. Verification and archive

- [x] 6.1 Run a tuning cycle live on a frozen dataset, then a live `npm start` run and a live `npm run discover` thread started with the configuration it activated (the discovery thread's scenario jobs dispatch with it); record in `verification.md` the cycle's runs, the paired deltas with n and 95% intervals, the holdout and activation outcome, the dispatched prompt versions, a deliberate kill and resume, the canonical hash before and after, execution outcomes apart from visual results, fixture-tested scope apart from live evidence, and what remains unverified.
- [x] 6.2 Archive the change with `openspec archive add-bounded-self-tuning`. Evidence: `npm run openspec:validate` passes after the archive.
