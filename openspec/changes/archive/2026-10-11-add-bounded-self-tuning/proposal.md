# Proposal

## Why

Evaluation can freeze datasets, run a prompt on them, compare two runs with a confidence interval and certify a job kind's configuration. But the only configuration it can measure is the prompt in the code, and the only way to change a prompt is to edit the code by hand. Nothing lets a measured improvement reach the jobs the workflow dispatches without a code change, nothing keeps an improvement found on a dataset from being confirmed on the same items it was tuned on, and nothing undoes a change that turns out badly.

## What Changes

- **Tuning configurations.** A job kind that evaluation scores (`hypothesis`, `challenge`, `rank`, `scenario`) can be dispatched with a tuning configuration: up to six lines of extra guidance, shown in a section of their own before the context, and whether the context is printed in the prompt or only named as a file to read. Nothing else is tunable: not the instructions in the code, the answer schema, the validation, the agent choice, the tools or any threshold. A configuration is identified by the hash of its content and names the prompt version it extends; its jobs record the prompt version `<prompt version>+tuned-<id>`.
- **Candidates.** A candidate is a tuning configuration under evaluation. A person can add one from a file, and a new `tune` job proposes one from a complete run on a dataset's development partition: it sees that run's answers, failures, scores and gold, the prompt as a job sees it and the earlier candidates, and never anything of the test partition.
- **Eval runs of a configuration.** `npm run eval -- run` runs the active configuration by default, the code's prompt with `--tuning none`, or a candidate with `--tuning <id>`; the run records the configuration it ran.
- **A guarded holdout.** A candidate's run on the test partition is started only by `tune holdout`, and only when the candidate beat the active configuration on the development partition in a paired comparison (higher mean, or the same mean in less model time). Each exposure is recorded in a ledger before the run starts; a test item is shown to a candidate at most once and to at most three candidates, whatever the dataset's name, version or seed, after which a dataset with test items that no candidate has seen is needed.
- **Certified activation.** `tune activate` makes a candidate the job kind's active configuration only when its test run is not worse than the active configuration's on the same items and meets the certificate threshold; it issues the certificate for the tuned prompt version and keeps the previous state.
- **Rollback.** `tune rollback` restores the previous active configuration of a job kind together with its certificate.
- **Dispatch.** `npm start` and `npm run discover` read the active configurations when a thread starts and keep them when it resumes; diagnosis and discovery jobs are prompted with them, and unattended runs need certificates for the tuned prompt versions.
- **Cycle.** `tune cycle` runs the whole sequence (development baseline, up to three proposed candidates, holdout, activation) with its state in a file, so a stopped cycle resumes.

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests for the configurations, the prompts, the gates, the ledger, activation and rollback; a live tuning cycle on a frozen dataset with the deltas and their 95% intervals; a live `npm start` run and a live `npm run discover` thread started with the activated configuration, whose scenario jobs dispatch with it, with the canonical hash before and after and execution outcomes apart from visual results.

## Capabilities

### New Capabilities

- `bounded-self-tuning`: tuning configurations, candidates and the `tune` job, eval runs of a configuration, the holdout ledger and its gate, certified activation, rollback, dispatch with the active configurations and the tuning cycle.

### Modified Capabilities

- `agent-evaluation`: eval runs record their tuning configuration, and the unattended gate compares certificates with the prompt version a run dispatches.

## Impact

- New files under `workflow/src/tuning/` and their tests. The active configurations and the holdout ledger live in a tuning folder (the profile's `tuning`, else `workflow/evals/tuning/`) that a first activation creates; this change commits none.
- Edited files: the diagnosis and discovery prompts and services, the eval run, its settings and the certificate gate, the agent job kinds and profile (`agents.jobs.tune`, `tuning`), the run and discovery options, `eval-commands.ts`; `AGENTS.md` and `README.md`.
- No capture, compare or contract change; canonical cache entries stay valid.
