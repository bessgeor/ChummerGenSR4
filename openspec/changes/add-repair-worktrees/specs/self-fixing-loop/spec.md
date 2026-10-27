## ADDED Requirements

### Requirement: Fixed clusters are merged into the branch the thread started on
A thread SHALL record, when it starts, the branch its repository's `HEAD` names and that branch's commit; a thread with repair and widening whose `HEAD` is detached SHALL end with a setup error before the build. When the thread concludes, each cluster whose widening was promoted SHALL be merged into that branch, in the order of the promotions, in a worktree of the thread outside the repository's working tree: its fix commit SHALL be rebased from its parent onto the current tip as the branch `workflow/<thread>/fix/<cluster>`, and merged into the tip with a merge commit of its own whose message names the cluster and carries the trailers `Workflow-Thread` and `Merged-Fix: <thread>/<cluster>`. A rebase that conflicts SHALL be aborted, its cluster SHALL NOT be merged, and every cluster promoted after it SHALL NOT be merged either; so SHALL every cluster when the thread's source held uncommitted edits of files that the branch does not hold in the same state, because the fixes were verified on top of those edits (a resumed merge checks this against the state of the last fix merged before). A fix whose change the branch holds already SHALL still get its merge commit, which records the fix without changing the branch's tree, also when the branch holds the fix commit itself (the commit the fix was made on is then the second parent). The merged tip SHALL be kept on `workflow/<thread>/integration`; then the branch SHALL be advanced to it by a fast-forward of the worktree that has it checked out, or by a compare-and-swap ref update when none has. A branch that is no longer an ancestor of the merged tip, or a fast-forward git refuses, SHALL be a setup error that names the integration branch, and the resumed thread SHALL try the merges again, skipping each cluster whose `Merged-Fix` trailer is already reachable from the branch. No branch SHALL be pushed or deleted. A thread stored before the start branch was recorded SHALL conclude without merging and say so.

#### Scenario: Two fixes merged
- **WHEN** a thread started on `master` promotes the fixes of clusters `a` and `b`, in that order, and `master` did not move
- **THEN** `master` gains a merge commit of `workflow/<thread>/fix/a` followed by a merge commit of `workflow/<thread>/fix/b`, and its working tree holds both fixes

#### Scenario: A fix that does not rebase
- **WHEN** `master` moved during the thread and the rebase of cluster `a`'s fix onto it conflicts in `Chummer/frmCreate.cs`
- **THEN** neither `a` nor the later `b` is merged, `master` keeps its commit, and both clusters end `merge_failed`, `a` naming the file and `b` naming `a`

#### Scenario: Fixes verified on uncommitted edits
- **WHEN** the thread's source held an uncommitted edit of `Core/XmlManager.cs` that `master` lacks, and a cluster's fix changes another file
- **THEN** that cluster and every later one end `merge_failed` naming `Core/XmlManager.cs`, and `master` keeps its commit

#### Scenario: A fix the branch has already
- **WHEN** `master` gained the same change as a cluster's fix while the thread ran
- **THEN** the rebase drops the fix, a merge commit with the `Merged-Fix` trailer and `master`'s own tree is made, and the cluster ends `fixed` with that merge commit

#### Scenario: Local edits in a merged file
- **WHEN** the working tree has an uncommitted edit of a file the merged fixes change
- **THEN** the fast-forward is refused, the run ends with a setup error naming `workflow/<thread>/integration`, and after the edit is committed and the thread resumed, the merges are not made twice

#### Scenario: Detached HEAD
- **WHEN** `npm start` starts a repairing thread while `HEAD` is detached
- **THEN** the run ends with a setup error before the build and no thread state is written

## MODIFIED Requirements

### Requirement: Every cluster ends at a disposition
When the run concludes, every cluster of the thread's `triage.json` SHALL have exactly one disposition: `fixed` when its widening was promoted and its fix was merged into the branch the thread started on (or was promoted in a thread stored before merging existed); `merge_failed` when its widening was promoted and its fix was not merged; else `budget_exhausted` when its diagnosis or repair is `budget_exhausted` or it was retryable but for the spent budget; else `not_diagnosed`, `diagnosis_failed`, `abstained`, `refuted`, `undecided` (also without a check), `not_repaired`, `repair_failed`, `repair_rejected`, `not_widened` or `widening_rejected` after the stage where it stopped. Each disposition SHALL carry the cluster's number of attempts, the stage and reason of its latest rejection or failure (none for a `fixed` cluster, which carries the commit of its fix and its merge commit instead; its earlier rejections stay in `repair.json`); a `merge_failed` cluster SHALL carry the stage `merge`, the reason and the commit of its fix.

#### Scenario: Refuted and fixed clusters
- **WHEN** a thread's check refutes one cluster and another cluster's attempt is promoted and merged
- **THEN** the first cluster's disposition is `refuted` with 0 attempts and the second's is `fixed` with its commit and merge commit

#### Scenario: A next attempt refused at the budget
- **WHEN** a cluster's first attempt was rejected at stage `check` and its next attempt is refused because the run budget is spent
- **THEN** its disposition is `budget_exhausted` with 1 attempt and the stage `check` and reason of the rejection

#### Scenario: Diagnosis turned off
- **WHEN** `npm start -- --no-diagnosis` triages two clusters
- **THEN** both dispositions are `not_diagnosed`

### Requirement: The outcome is documented and reported
`conclude` SHALL write `outcome.json` in the thread's folder with the thread, the outcome, the scope (the planned cases and captures), the scope's problems, each cluster's disposition, attempts, stage, reason, commit and merge commit, the accepted branch and commit, the merge (the branch the thread started on, its commit before and after, and each merged or failed cluster with its fix branch and merge commit or reason; null when nothing was promoted) and the measures: clusters, fixed, fix rate (null without clusters), attempts, the thread's charged model time and the elapsed time since the thread started (null when the thread does not record its start). The end-of-run report SHALL print one line per cluster with its disposition, a `Merge:` line with the branch and its commits before and after when anything was promoted, and an `Outcome:` line with the outcome, the counts and the document's path, after the widening lines.

#### Scenario: Report of a thread with a fix after two attempts
- **WHEN** a cluster is fixed by its second attempt and merged
- **THEN** the report prints that the cluster is `fixed` after 2 attempts with the commit, a `Merge:` line with the branch's commits before and after, and `outcome.json` counts 2 attempts and 1 fixed of 1 cluster
