# Tasks

## 1. Loop

- [x] 1.1 Add the retry rules, the dispositions and the outcome as pure functions over the thread's state, with `repair.maxAttempts` in the profile and the run options. Evidence: unit tests for each retryable and non-retryable rejection (repair stages, widening stages, execution failures, the attempt limit, the budget, a thread without the option), each disposition and each outcome, pass.
- [x] 1.2 Give repair its earlier attempts: the `earlier` list in a cluster's repair, the earlier attempts in the prompt with their patches (prompt version `repair-v2`), and `repair.json` with them. Evidence: tests showing a second attempt's prompt with the first attempt's patch, stage and reason, its source copy without that change, and its own record and archive, pass.
- [x] 1.3 Keep widenings per attempt: `widening/<cluster>/attempt-<n>/`, `earlierWidenings` in the state and the thread's `widening.json`, and `prepare_widening` adding only new passed attempts on the accepted state it finds. Evidence: tests for a cluster rejected at a level and promoted on its second attempt (both documents kept), a second attempt widened on a source promoted in the first round, and the exit status of an earlier widening's execution failure, pass.
- [x] 1.4 Add the loop route, `retry_repair` and `conclude` to the graph, write `outcome.json`, print the dispositions and the outcome, and describe the loop in `AGENTS.md` and `README.md`. Evidence: graph tests for each path to `conclude` (diagnosis, repair or widening off, `--only triage`), a fix after two attempts, no retry after an execution failure, the budget spent, the report lines and unchanged exit statuses, a kill and resume across a retry, and a thread stored without the new fields, pass; `workflow:typecheck` and `workflow:test` pass.

## 2. Verification and archive

- [x] 2.1 Run `npm start` live over the whole suite on the current source, and a scoped run with a seeded discrepancy routed through diagnosis, repair and widening to its outcome, with a kill and a resume. Record in `verification.md` the canonical hash before and after, each case's execution outcome apart from its visual result, each cluster's disposition and the thread's outcome and measures, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 2.2 Archive the change with `openspec archive close-self-fixing-loop`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
