# Proposal

## Why

A workflow run ends with triage: discrepancy clusters with stable identities, crops of both sides and the cases they appear in. Nothing explains them. Somebody has to open the crops, guess which part of the app's source draws that area, form a theory of why the candidate differs from the canonical executable, and think of another capture that would tell that theory apart from a rival one. Model agents can do the first pass of that work, but only under constraints: they must see exactly the evidence the workflow recorded and no more, they must not write anything, their answers must be machine-checkable, a usage limit of the subscription must not end or fail a run, and every answer must be recorded with what produced it and how a check judged it.

## What Changes

- **Agent runner.** One port runs a model job: a job kind, a prompt built from a sealed context, images, a zod output schema, a read-only workspace and a time budget. It returns the validated output with usage and duration, or a typed failure: `invalid_output`, `refused`, `quota_exhausted` or `infra`.
- **Two adapters.** The Claude adapter runs the Claude Code CLI headless (`claude -p` with stream-json output and a JSON schema) with read-only tools only. The Codex adapter runs the Codex SDK with a read-only sandbox, no approvals and no web search. Both run under the user's subscription sign-in: they remove API-key variables from the child's environment, and a job that would be billed to an API key fails as `infra`. Both classify usage-limit responses as `quota_exhausted`.
- **Per-job-kind profile.** The local workflow profile chooses provider, model, effort and time limit for each job kind (`hypothesis`, `challenge`), the size of the model pool, a run budget for model time and the CLI executables. The choice is recorded with every job.
- **Sealed context.** For each cluster the workflow writes a context folder: a manifest (the cluster's members with their cores and OCR text, the fixtures with their hashes, the expanded actions up to each capture, the cases and captures a check may name, and the identity of a source snapshot), copies of the crops, and a history-less snapshot of the app's source and data shared by the thread. The manifest's hash is recorded with every job; prompts are built from the manifest only.
- **Hypothesis and independent challenger.** After triage the graph fans out with `Send`: one hypothesis job per cluster, then one challenger job per cluster with a hypothesis. The challenger runs in a fresh session, may use another provider, sees the hypothesis and must either name an alternative explanation whose predicted observations disagree with the hypothesis on at least one capture, or say why there is none. Outputs are validated against the snapshot (cited files exist, cited lines are inside the file) and the check vocabulary.
- **`wait_for_quota` route.** A job that ends with `quota_exhausted` is not a failure: the graph routes to a `wait_for_quota` node that waits 1, 2, 5, 10 and 15 minutes, then every 15 minutes, and sends the job again. After a restart the first retry is immediate. Waiting time is not counted against job or run budgets, and a quota wait never asks the operator anything.
- **Batched diagnostic checks.** The predictions of every cluster are merged into one capture run on the desktop lane (one call of the capture runner with the union of the named cases and captures). Each prediction is compared with what the run observed, and each cluster gets a check outcome: `confirmed`, `refuted` or `undecided`. Execution failures of the check run are reported apart from its observations.
- **Eval records.** Every model job, also a failed one, is recorded in the LangGraph store with one generic schema: job kind, subject, context hash, prompt version, provider, model and effort, duration, usage, result or failure, output, and labels. The check outcome is added as a label to the jobs of its cluster. The thread's `diagnosis.json` holds each cluster's hypothesis, challenge, check and record IDs.
- **Options and report.** `--only diagnose` runs diagnosis on recorded steps; `--no-diagnosis` ends the run after triage. The run prints each cluster's diagnosis outcome apart from the cases' execution and visual outcomes, and the exit status covers diagnosis failures.

Area: tooling only (the `workflow/` workspace, its dependencies, docs). The Chummer app, `bin/`, the capture runner and the comparer are untouched. Evidence: unit tests with fake agents, fake CLIs and a fake host (adapters' argument lists, event parsing, failure classification and API-key guard; sealing; validation; the `Send` fan-out, the quota route with a fake clock and the restart rule; budget accounting; the batched check; eval records), and a live `npm start` run on a real discrepancy that runs both adapters, waits for quota if that occurs, runs the batched check on the desktop lane and is killed and resumed once, with the canonical hash recorded before and after.

## Capabilities

### New Capabilities

- `discrepancy-diagnosis`: model-based diagnosis of triage clusters: the agent runner and its two adapters, the per-job-kind profile, sealed contexts, hypothesis and challenger jobs with validation, the quota wait, the batched diagnostic check and eval records.

### Modified Capabilities

- `parity-workflow`: the graph continues after triage with diagnosis; the exit status, the end-of-run report, `--only` and the local profile cover it.

## Impact

- New files: `workflow/src/agents/`, `workflow/src/diagnosis/`, `workflow/src/evals/`, their tests.
- Edited files: the workflow graph, state, options, profile, report and composition root, `workflow/package.json`, `package-lock.json`, `AGENTS.md`, `README.md`.
- New dependency in the workspace: `@openai/codex-sdk` (it brings the Codex CLI). The Claude Code CLI is not a package dependency; the profile or `PATH` names it.
- Output stays in the git-ignored `out/`: the source snapshot, the context folders, the agents' logs, `diagnosis.json` and the check's run folder. Eval records go to the existing store under `out/workflow/`.
