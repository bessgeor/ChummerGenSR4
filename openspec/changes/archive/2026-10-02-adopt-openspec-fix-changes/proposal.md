# Proposal

## Why

The loop fixes a discrepancy as one opaque repair job and leaves behind a commit and some archives under the git-ignored `out/`. A fix that a person accepts carries no reviewable record of what was wrong, what was believed about the cause and why, how the work was divided and what the widening showed; and a later diagnosis of a similar discrepancy starts from nothing, although an earlier fix of the same kind of defect would be the first lead a person would look at. Whether giving each fix that structure, and feeding past fixes back into diagnosis, makes the loop fix more discrepancies or spend less model time is a question the loop's own measures can answer, but only when the two ways of working can be run side by side on the same discrepancies and compared in pairs.

## What Changes

- **Fix changes.** A separate OpenSpec root, `fixes/`, holds fix changes in a project-local schema `fix` with three artifacts: `proposal.md` (the discrepancy, the hypothesis and its evidence), `tasks.md` (the fix's subtasks with their blockers) and `verification.md` (the narrow check and the widening results), plus `fix.json`, the same facts as a record the workflow reads back. The pinned OpenSpec CLI creates, validates (strict) and archives every fix change; `npm run fixes:validate` checks the archive.
- **`--fix-changes`.** A thread started with `--fix-changes` works in fix changes; without it, nothing changes. The option is stored with the thread and refused together with `--unattended`, since no certificate covers the prompts it adds.
- **Priors for diagnosis.** With the option, each cluster's sealed context gets up to three archived fix changes of the repository, ranked by how much their discrepancy resembles the cluster's (the same image hash, captures, cases, OCR words), copied into the context with the reasons for their rank. The hypothesis prompt presents them as leads to verify in the source, never as evidence; the challenge prompt does not show them, so the challenger stays independent.
- **Planned repair.** With the option, a repair attempt starts with a read-only plan job that splits the fix into at most five subtasks, each with the files it may change and the subtasks that block it. Subtasks whose blockers are done are implemented in parallel, each by its own writable job in its own scratch copy holding the snapshot and its blockers' changes; their changes are joined before the attempt's patch guard, build and narrow check. Two subtasks that changed the same file without one blocking the other reject the attempt at stage `patch`.
- **Fix change on promotion.** With the option, a promoted attempt's fix commit on `accepted/<thread>` also holds the fix change, archived by the CLI into `fixes/openspec/changes/archive/`, so merging the accepted branch brings the record of the fix with it, and later threads retrieve it.
- **Paired thread comparison.** `npm run eval -- compare-threads --baseline <threads> --candidate <threads>` pairs two sets of finished threads by cluster identity and reports, for the fix rate and the model time per cluster, both sides, the mean paired difference with its 95% t interval and a verdict.

Area: tooling only (the `workflow/` workspace, the new `fixes/` root, `package.json` and docs). The Chummer app, `bin/`, the capture runner, the comparer and the contracts are untouched. Evidence: unit and graph tests with fake agents and a fake host (ranking and priors in the context and prompt, plan validation, parallel subtasks and their join, the fix change written and archived by the real CLI and committed on promotion, the comparison), and live `npm start` runs with seeded discrepancies on a reduced case file, with and without `--fix-changes`, including a kill and a resume, compared in pairs with `compare-threads`; the canonical hash before and after each run.

The option stays off by default; `verification.md` records the paired comparison and whether it showed an improvement.

## Capabilities

### New Capabilities

- `fix-changes`: the fixes root and its `fix` schema, the fix change's artifacts and record, their validation and archive by the CLI, and the `--fix-changes` option.

### Modified Capabilities

- `discrepancy-diagnosis`: with fix changes, archived fixes are ranked and sealed into each cluster's context as priors for the hypothesis.
- `isolated-repair`: with fix changes, an attempt is planned as subtasks with blockers, implemented in parallel and joined before the guard.
- `deterministic-widening`: with fix changes, the fix commit holds the archived fix change.
- `agent-evaluation`: finished threads are compared in pairs by cluster.

## Impact

- New files: `fixes/openspec/` (config, the `fix` schema and its templates), `workflow/src/fixes/` (record, rendering, CLI wrapper, retrieval, comparison), `workflow/src/repair/` modules for the plan, the subtasks and the join, their tests.
- Edited files: the argument parser and run options, the diagnosis context, prompts and service, the repair service and archive, the widening service and accepted branch, the eval commands, `package.json`, `AGENTS.md`, `README.md`.
- No new dependency: the OpenSpec CLI is already pinned. Output stays in the git-ignored `out/`, except the fix change a promotion commits on the accepted branch.
