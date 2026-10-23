# Proposal

## Why

A repair attempt passes when its narrow check shows the cluster's own cases and captures within the threshold. That says nothing about the rest of the suite: a patch that moves a label back on the build form may move it on the career form too, or change a tab the narrow check never opened. Nothing turns a passed attempt into a change of the source that others can take either; the patch stays in the attempt's archive. Accepting a patch needs a wider check that no model takes part in, a rule for telling the differences the patch brought from those that were there before, and a place where accepted patches are kept as commits, while a rejected patch leaves no trace in what is accepted.

## What Changes

- **Widening ladder.** After repair, every passed attempt is widened, one cluster at a time, through four levels: `narrow` (the cluster's cases and captures), `character` (every capture of the cluster's cases), `mode` (every other case of the same modes) and `suite` (every remaining case of the case file). Each level is one capture runner call on the desktop lane with the widened candidate; a level that adds no case passes without a run. No model job runs during widening.
- **Widened candidate.** The attempt's patch is applied to the accepted source (the thread's source snapshot plus the patches promoted before it in the thread) only when every file it changes still has the content the patch was made from; otherwise the attempt is rejected at stage `apply`. The widened source is built with the candidate build script in the CPU pool, in the thread's folder.
- **Attribution of new differences.** Every capture of a level that is not within the threshold is classified against a baseline of the accepted source at the same case and capture: `target` (a capture of the cluster that still differs), `introduced` (the baseline passed), `changed` (the baseline differed and the candidate's pixels changed beyond the threshold), `pre-existing` (the baseline differed with the same candidate pixels) or `unattributed`. The baseline comes from the thread's own captures and earlier widening runs of the accepted source; a capture without one is captured on the accepted build first. Only `pre-existing` differences let a level pass; they stay listed as remaining findings.
- **Promotion and rollback.** An attempt whose four levels pass is promoted as a commit on the thread's accepted branch `accepted/<thread>`, which starts at the commit the snapshot was taken on (with a commit holding the snapshot's `Chummer/` when the working tree differed); the commit names the thread, the cluster and the repair record. Its widened source becomes the accepted source for the next cluster. A level that fails rolls the attempt back: its widened source and build are removed, the accepted branch and source stay as they were, and the next cluster widens from them.
- **Reporting.** `widening/<cluster>/widening.json` and the thread's `widening.json` hold every level's selection, run folder, execution outcome, visual result and attribution, the outcome, the rejection stage and reason, and the commit. The end-of-run report prints each level's execution outcome apart from its visual result. A level or baseline capture with execution failures makes the run's status 2. The repair record of a widened attempt gets a new automatic `widening` label. `--no-widening` ends the run after repair.

Area: tooling only (the `workflow/` workspace and docs). The Chummer app, `bin/`, the capture runner, the comparer and the contracts are untouched; the canonical executable is only read, through the build script and the capture runner. Evidence: unit tests with a fake host and real folders, PNG files and a real git repository (ladder, patch application, attribution, baseline capture, promotion and its idempotent resume, rollback, graph routing, report and exit status), and a live `npm start` run with a seeded discrepancy whose repair is widened through all four levels and promoted, with a second, independent seeded discrepancy that the suite level must attribute as pre-existing, a kill during widening and a resume, and the canonical hash before and after.

## Capabilities

### New Capabilities

- `deterministic-widening`: the ladder of levels after a passed repair attempt, the widened candidate, the attribution of differences against the accepted source, promotion on the accepted branch, rollback, and the widening documents.

### Modified Capabilities

- `parity-workflow`: the graph widens passed attempts after repair (`--no-widening`), the exit status covers widening, and the report prints each level.
- `agent-evaluation`: repair records get the automatic `widening` label.

## Impact

- New files: `workflow/src/widening/` (ladder, PNG pixels, attribution, patch application, accepted branch, service, report), their tests.
- Edited files: the graph, its state and run report, the options and arguments, the eval record labels and the record summary, the composition root, `AGENTS.md`, `README.md`.
- No new dependency. Output stays in the git-ignored `out/` (the thread's folder and the capture run folders); the repository gets a local branch `accepted/<thread>` only when an attempt is promoted, and neither the working tree, the index nor the checked-out branch changes.
