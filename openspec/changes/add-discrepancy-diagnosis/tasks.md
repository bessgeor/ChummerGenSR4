# Tasks

## 1. Agent runner

- [x] 1.1 Add the agent runner port with typed failures, the failure classification, the model pool and the `agents` part of the local profile (per-job-kind provider, model, effort and time limit, pool size, run budget, executables). Evidence: unit tests for the classification of usage-limit, sign-in, refusal and other texts, the pool's bound, profile defaults and an invalid profile, pass.
- [x] 1.2 Add the Claude CLI adapter. Evidence: unit tests with a fake CLI for the argument list, the environment without API-key variables, the init event's API-key source guard, structured output, an error result, a malformed answer, a timeout and a crash, pass.
- [x] 1.3 Add the Codex SDK adapter with the pinned `@openai/codex-sdk`. Evidence: unit tests with a fake client for the thread options, the environment and config, the sign-in check, images as input, usage, a failed turn, a file change, an MCP call, a web search, an allowed read command and an invalid answer, pass.

## 2. Diagnosis

- [x] 2.1 Add the source snapshot and the sealed context per cluster. Evidence: unit tests for the snapshot's content and identity, the manifest's content, the stable hash, the copied crops and a missing crop, pass.
- [x] 2.2 Add the hypothesis and challenge jobs with their prompts, schemas and semantic validation, the diagnosis nodes with the `Send` fan-out, the `wait_for_quota` route, the run budget, `--only diagnose` and `--no-diagnosis`. Evidence: unit tests with a fake agent runner for the fan-out, abstention, validation failures, an `infra` failure, a quota wait with a fake clock and the delays, the immediate retry after a restart, a resume after a kill that does not repeat a finished job, and the budget, pass.
- [x] 2.3 Add the batched check, the eval records with the check label, `diagnosis.json`, the report lines and the exit status. Evidence: unit tests with a fake host for one capture call with union filters, the observation rules, the three check outcomes, a check run with execution failures, no check run without predictions, the records of succeeded and failed jobs and the labels, pass; `AGENTS.md` and `README.md` describe diagnosis.

## 3. Verification and archive

- [ ] 3.1 Run live `npm start` on a case with a real discrepancy, with the sourcebook overlay, both adapters and the batched check on the desktop lane; kill it once during diagnosis and resume it; record a quota wait if one occurs. Record in `verification.md` the canonical hash before and after, execution outcomes apart from visual results, the triage clusters, each job's record, the check's execution outcome apart from its observations, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 3.2 Archive the change with `openspec archive add-discrepancy-diagnosis`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
