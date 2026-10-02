# Proposal

## Why

A thread now runs every discrepancy cluster through diagnosis, repair and widening, but it stops after one pass and says nothing about where it got. A cluster whose only attempt estimated a position wrongly, or whose patch broke a capture at a wider level, is left behind even when the run budget would allow another attempt. And when the run ends, a reader has to put the per-stage reports together to learn whether the thread's scope now matches the canonical executable, which clusters are still open and why, and what the thread cost. The loop needs a route from a rejected attempt back to repair, and one outcome per thread that says whether its scope is verified, findings remain, or the budget ran out.

## What Changes

- **Next attempt.** After widening (or after repair when widening is off), each cluster whose latest attempt was rejected, by repair or by widening, gets another repair attempt while it has attempts left (`repair.maxAttempts` in the profile, default 2) and the run budget is not spent. Attempts rejected because of an execution failure, a patch that does not apply to the accepted source, or a patch with nothing left to commit get none. The next attempt starts again from the thread's source snapshot, and its prompt lists the earlier attempts of the cluster with their patch, stage and reason. A passed next attempt is widened on the source accepted so far; widening documents move to `widening/<cluster>/attempt-<n>/`.
- **Routing to an end.** Every triage cluster ends at one disposition: `fixed` (promoted on the accepted branch), or the stage where it stopped (`not_diagnosed`, `diagnosis_failed`, `abstained`, `refuted`, `undecided`, `not_repaired`, `repair_failed`, `repair_rejected`, `not_widened`, `widening_rejected`), or `budget_exhausted`.
- **Thread outcome.** A `conclude` node ends every run that triaged: `verified_for_scope` when every cluster is fixed and the thread's own captures and compares had no execution or analysis failure and triage listed no other findings; `budget_exhausted` when not verified and a cluster stopped because the run budget was spent; otherwise `findings_remaining`. It writes the thread's `outcome.json` with the outcome, the scope, each cluster's disposition, attempts and commit, the scope's problems and the thread's measures (clusters, fixed, fix rate, attempts, model time, elapsed time), and the end-of-run report prints them. The exit status keeps its meaning; the outcome is reported beside it.

Area: tooling only (the `workflow/` workspace and docs). The Chummer app, `bin/`, the capture runner, the comparer and the contracts are untouched. Evidence: graph tests with fake agents and a fake host (a next attempt after a rejection at repair and at widening, no next attempt after an execution failure, at the attempt limit or with the budget spent, the earlier attempts in the prompt, every disposition and outcome, `outcome.json` and the report, a resume), and live `npm start` runs: one over the whole suite on the current source, and one with a seeded discrepancy through diagnosis, repair, widening and promotion to `verified_for_scope`, with a kill and a resume, and the canonical hash before and after each.

## Capabilities

### New Capabilities

- `self-fixing-loop`: the next attempt for a rejected cluster, each cluster's disposition, the thread's outcome and `outcome.json`.

### Modified Capabilities

- `isolated-repair`: a confirmed cluster may get further attempts from the loop, and an attempt's prompt lists the cluster's earlier attempts.
- `deterministic-widening`: widenings of later attempts start from the source accepted so far, and their documents are kept per attempt.
- `parity-workflow`: the graph routes rejected attempts back to repair and ends in `conclude`; the report prints the outcome.

## Impact

- New files: `workflow/src/loop/` (dispositions, outcome, retry route, the loop service and its document), their tests.
- Edited files: the graph, its state and run report, the repair service, prompt and state, the widening service and state, the profile and run options, the composition root, `AGENTS.md`, `README.md`.
- No new dependency. Output stays in the git-ignored `out/`.
