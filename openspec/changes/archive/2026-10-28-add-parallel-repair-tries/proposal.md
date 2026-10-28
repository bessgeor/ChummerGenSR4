# Proposal

## Why

Each cluster gets one hypothesis, and a confirmed hypothesis gets one repair attempt at a time. When the hypothesis is wrong in a way the check cannot tell, or the one patch is clumsy, the cluster spends a whole next attempt (and its deadline) to try something else, and a better patch that a second try would have found is never compared with the first.

## What Changes

- **Several hypotheses.** The profile's `diagnosis.hypotheses` (1 to 3, default 1) sets how many independent hypothesis jobs a cluster gets, each in a fresh session from the same sealed context. Each hypothesis that does not abstain is challenged on its own. The check run covers the predictions of every hypothesis and alternative, and judges each hypothesis by the existing rule. The cluster is `confirmed` when at least one of its hypotheses is; each hypothesis record gets the check label of its own hypothesis.
- **Parallel repair tries.** A repair attempt of a cluster becomes up to `repair.tries` tries (profile, 1 to 3 per confirmed hypothesis, default 1; at most 6 per attempt): one per confirmed hypothesis and try number, started side by side, each in its own worktree and branch (`workflow/<thread>/repair/<cluster>/attempt-<n>-try-<k>`), with its own guard, build and narrow check. The attempt passes when any try passes.
- **Only the best is widened.** Among the passed tries, the attempt selects the one with the fewest changed lines (added plus removed), then the fewest files, then the lowest try number. Only the selected try is widened and can be promoted; the others are archived as `passed` and `not_selected`. When every try is rejected, the attempt is rejected with each try's stage and reason, and the next attempt's prompt lists them all.
- The attempt's archive holds every try in `try-<k>/` and names the selected one; `attempt.json` keeps the selected try's fields at its top level, so widening and the loop read it as before.

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests for two hypotheses (one confirmed, one refuted), labels per hypothesis, tries side by side in their own worktrees, the selection rule, all tries rejected, the budget and deadline across tries, and resumption; a live `npm start` with two hypotheses and two tries on a confirmed cluster, with the canonical hash before and after and each try's execution outcome apart from its visual result.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `discrepancy-diagnosis`: a cluster may get several independent hypotheses, each challenged and judged by the check.
- `isolated-repair`: an attempt runs its tries side by side, each in its own worktree, and selects the best passed one.
- `deterministic-widening`: only the selected try of an attempt is widened.

## Impact

- Edited: the cluster diagnosis state, the check, the diagnosis service and its report, the repair service, archive and report, the profile, the graph's repair fan-out; `AGENTS.md` and `README.md`.
- With the defaults (one hypothesis, one try) a thread behaves as before, apart from the archive's `try-1/` folder.
