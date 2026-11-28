# Verification

## Task 1.1: worktrees for attempts, subtasks and widenings

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Passed: 499 tests, 499 passed, 0 failed (exit 0), before the review fixes. |
| `npm run workflow:test`, run 2 | Passed after the review fixes: 500 tests, 500 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Passed on the final source (run 2's source with one test renamed): 500 tests, 500 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 4 | Passed with the source check at widening, all snapshot folders in the source commit and the accounting of a subtask's link and submodule entries: 503 tests, 503 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 5 | Passed with the source branch's content checked against the sealed snapshot: 504 tests, 504 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 6 | Passed with a snapshot without `Core/` refused before an existing source branch is looked at: 504 tests, 504 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 7 | Passed with a change of only a file's mode rejected by the patch guard: 505 tests, 505 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 8 | Passed, with byte-exact staging and checkout, a rebase failure without a conflict reported as an error, and a widened worktree with a foreign commit refused at promotion: 508 tests, 508 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 9 | Passed, with attributes in the repository's `info/attributes` that convert a compiled file refused: 509 tests, 509 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 10 | Passed on the final source, with `info/attributes` read as text so a pattern that matches only files added later is refused and unset attributes are accepted: 509 tests, 509 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 11 | Failed on the CI runner (3 of 534 tests failed, exit 1; its log names no test in the part kept). Reproduced locally with the temporary folder set to its 8.3 short name (`TEMP=C:\CI-SHO~1`, as on the runner), for `git-integration.test.ts`, `repair-*.test.ts` and `widening-*.test.ts`: 89 tests, 86 passed, 3 failed (exit 1). `not ok 28 - a subtask that commits in its worktree itself ends the run as infra, and nothing is joined or built`: `Missing expected rejection.` (`repair-planned.test.ts:218`). `not ok 46 - a job that changes its context copy or its worktree's git state, or adds to the scratch folder, ends the run as infra before any commit or build`: `Missing expected rejection: own commit` (`repair-service.test.ts:273`). `not ok 80 - a source branch that moved after the attempts were made is a setup error before any widening`: `Expected values to be strictly equal: 1 !== 3` (`widening-graph.test.ts:220`). Cause: `git worktree list` names a worktree by its long path and the code compared it with the short path it had made, so a worktree was not found and its git state read as unchanged. |
| `npm run workflow:test`, run 12 | Passed on the final source with the same short temporary folder: 535 tests, 535 passed, 0 failed, 0 skipped (exit 0); the new test in `git-integration.test.ts` fails without the fix. |
| `npm run workflow:test`, run 13 | Passed on the final source with the 8.3 short temporary folder: 537 tests, 537 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 14 | Passed on the final source with the 8.3 short temporary folder: 539 tests, 539 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 15 | Passed on the final source with the 8.3 short temporary folder: 539 tests, 539 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 16 | Passed on the final source with a file git tracks although an ignore rule matches it staged into the source commit, and a subtask join that refuses a file added where the join has a folder or inside a file: 542 tests, 542 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 17 | Passed on the same source with the 8.3 short temporary folder: 542 tests, 542 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 18 | Passed on the final source, with a join written into a worktree where a folder becomes a file and a file becomes a folder, and the 8.3 short temporary folder: 543 tests, 543 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 23 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

Every test below runs on temporary git repositories made by the test (the fixture repository has a commit, then an uncommitted edit, an untracked file, a deletion and an ignored file), with fake model jobs, builds and captures.

| Evidence named by the task | Tests |
| --- | --- |
| A clean snapshot | `widening-branch.test.ts`: a snapshot equal to its commit is the source commit itself (and a snapshot without `Core/` is a setup error). |
| A dirty snapshot | `widening-branch.test.ts`: the thread's source commit holds the snapshot's uncommitted edits on the snapshot's commit (the ignored file is left out; HEAD, index and status unchanged; an existing source branch is used as it is). `repair-service.test.ts`: the attempt's worktree holds the snapshot's uncommitted edits, and the repository's status does not change. |
| An edit | `repair-service.test.ts`: a passed attempt edits only its own worktree (branch `workflow/<thread>/repair/<cluster>/attempt-1`, attempt commit on the source commit with the `Repair-Attempt` trailer, `branch` and `commit` in `attempt.json`, worktree removed and branch kept). `repair-patch.test.ts`: the patch from the source and attempt commits. |
| An empty change; ignored files | `repair-service.test.ts`: a job that changes nothing, or writes only ignored files, makes no attempt commit and is rejected at stage `patch`. `repair-patch.test.ts`: an unchanged worktree makes no commit and an empty patch, and ignored files are no change. |
| An edit outside `Chummer/` and `Core/` | `repair-service.test.ts`: an edit outside `Chummer/` and `Core/` is committed on the attempt's branch and rejected by the guard; the stage rejections test. |
| Two attempts side by side | `repair-service.test.ts`: two attempts side by side work in their own worktrees on their own branches (both jobs running at once; neither worktree shows the other's file). |
| Planned attempts: independent and dependent subtasks | `repair-planned.test.ts`: independent subtasks run together, a blocked one starts on their changes (each subtask's branch, subtask 3's start commit holding the changes of 1 and 2, the attempt commit holding all three). |
| Planned attempts: a conflict | `repair-planned.test.ts`: a subtask that changed a file of another it does not wait for rejects the attempt at stage `patch` before a build. |
| Planned attempts: a mislisted change | `repair-planned.test.ts`: a subtask whose changes differ from its answer ends the attempt at stage `patch`. |
| A stale file at apply | `widening-branch.test.ts`: an attempt commit applies only where the accepted commit still has what it changed (an edited and an added file listed; an unrelated promotion leaves it applicable). `widening-graph.test.ts`: a patch on a file an earlier promotion changed is rejected at stage `apply`. |
| Nothing to commit | `widening-branch.test.ts`: a widened worktree that stages the accepted tree has nothing to commit. `widening-graph.test.ts`: a widened source that stages the accepted tree is rejected at stage `promote` and the next cluster is widened. |
| A fix change | `fix-promotion.test.ts`: with fix changes the fix commit holds the archived fix change beside `Chummer/`, and the working tree stays as it was. `widening-branch.test.ts`: a fix change beside an unchanged `Chummer/` makes no commit. |
| A resumed promotion | `fix-promotion.test.ts`: a promotion resumed after its commit takes the commit and archives nothing again, killed after the accepted branch moved and killed before it moved. `widening-graph.test.ts`: a run killed after the promotion's commit resumes without a second commit. `widening-branch.test.ts`: a promotion killed after its commit and before the branch moved takes the worktree's commit. |

Also covered:

- The source commit represents all four snapshot folders: `widening-branch.test.ts`, a snapshot folder whose files were all deleted is deleted in the source commit too.
- An existing source branch is used only when its tree is the sealed snapshot's, at repair and at widening: `widening-branch.test.ts`, an existing source branch whose content is not the snapshot's is a setup error, also a sibling commit with the same parent and message; a snapshot without `Core/` is refused before an existing branch is looked at.
- Widening starts only from the source the attempts were made on: `widening-graph.test.ts`, a source branch that moved after the attempts were made is a setup error before any widening.
- A subtask's link or submodule entry is accounted for: `repair-planned.test.ts`, a subtask that also changed a submodule entry it did not report is rejected at stage `patch`.

- Promotion and rollback in worktrees: `widening-branch.test.ts` (first promotion on the source commit, a second stacked on it, a moved branch is a setup error, a widened worktree without `Core/`), `widening-graph.test.ts` (each fix commit on its widening branch; a rolled-back worktree unregistered while its branch stays; a rollback without the accepted branch).
- The integration of commits into a branch: `git-integration.test.ts` (rebase and merge commit per commit with its trailers, fast-forward of the checked-out branch, a resumed integration skipping merged commits, a conflict and the commit after it, a branch not checked out moved by compare-and-swap, a branch moved meanwhile, a refused fast-forward).
- A job that changes its worktree's git state (its `.git` file, or commits on its branch) fails as `infra` before anything is committed: `repair-service.test.ts` (the tampering test) and `repair-planned.test.ts` (a subtask that commits in its worktree).
- Staged and checked-out bytes are the snapshot's whatever the line-ending settings and attributes: `widening-branch.test.ts`, a repository with `core.autocrlf=true` and `* text eol=crlf` still gets an LF-only edit into the source commit and the worktree byte for byte.
- A rebase that stops without a conflict is an execution error, not a `conflict` item: `git-integration.test.ts` (a failing commit signing during the replay).
- A widened worktree whose branch holds a commit that is not the promotion's (or has another parent than the start) is a setup error at promotion and moves nothing: `widening-branch.test.ts`.
- Attributes of `info/attributes` (the one attribute source the git runner cannot pin away) that set or give a value to `text`, `crlf`, `eol`, `filter`, `ident` or `working-tree-encoding` for any pattern, also one that matches only files added later, are a setup error before the source commit is made: `widening-branch.test.ts`, refused lines of several forms, and unset, reset and nonconverting attributes accepted.
- A change of only a file's mode is rejected by the patch guard: `repair-patch.test.ts`, an executable-bit change of a source file has equal blobs and no changed lines and is named by the guard.
- A worktree is found by its folder whatever name the folder is given (a Windows 8.3 short name or the long one git lists): `git-integration.test.ts` (state and removal by the short name).
- A file the attempt adds where the accepted commit has a folder (or inside a file) makes the attempt stale, so it is rejected at stage `apply` instead of failing in the cherry-pick: `widening-branch.test.ts` (both orders of `Chummer/New.cs` and `Chummer/New.cs/Nested.cs`).
- A worktree git refuses to remove is reported with git's message when it stays registered, and removed without error when its folder could be deleted and pruned: `git-integration.test.ts` (a refusing git, a locked worktree).
- A worktree that stays registered after its removal fails the attempt or the subtask instead of being logged, and a run already failing keeps its own error with the leftover logged beside it: `repair-service.test.ts` and `repair-planned.test.ts` (git refusing the removal of a locked worktree).
- A widening rejected at stage `apply` keeps its widening branch (at the accepted commit it started from) and has no worktree left: `widening-graph.test.ts`, a patch on a file an earlier promotion changed.
- A file git tracks although an ignore rule matches it (staged with `git add --force`) is in the snapshot and in the thread's source commit, and a resumed thread finds the same commit: `widening-branch.test.ts`.
- A join of subtasks refuses a file added where the join has a folder, or inside a path where it has a file, as a conflict rejected at stage `patch` (the order of the changes within one subtask does not matter, and a subtask may replace a file by a folder): `repair-planned.test.ts` (two independent subtasks adding `Chummer/New.cs` and `Chummer/New.cs/Nested.cs`; the join itself; a join that replaces a folder by a file and a file by a folder is written into a worktree and commits to the changed tree).
- Resumed threads keep using the thread's source branch: `repair-graph.test.ts`, a run killed during a narrow check resumes with a new attempt.

## Fixture-tested scope

All of the above runs on temporary repositories with fake model jobs, builds, narrow checks and level captures. No model job, build or capture ran.

## Live evidence

None for this task. `bin/ChummerGenSR4.exe` was not run, built or touched.

## Unverified

That a real repair job edits its worktree, that the worktree builds with the candidate build script, and that a widened worktree builds and is promoted in a live `npm start` run.

## Task 2.1: merging the fixed clusters at conclude

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Passed: 550 tests, 550 passed, 0 failed, 0 skipped (exit 0). |
| `node --import tsx --test` on `git-integration`, `loop-graph`, `graph`, `suite` and `steps` tests, after the review fixes | Failed: 76 tests, 75 passed, 1 failed (exit 1). `not ok 51 - a fast-forward refused for a local edit of a merged file is a setup error, and once the edit is committed the resumed thread merges each fix once`: `Expected values to be strictly equal: + 'class frmCreate {\r\n  int restored;\r\n}\r\n// one\r\n// two\r\n// local edit\r\n' - 'class frmCreate {\n  int restored;\n}\n// one\n// two\n// local edit\n'` (`loop-graph.test.ts:394`). Cause: the fast-forward now writes the checkout with the machine's git settings (`core.autocrlf=true` here), and the test compared the bytes with LF line endings; it now compares the text with its line endings normalized and still requires a clean `git status`. |
| `npm run workflow:test`, run 2 | Passed on the final source: 551 tests, 551 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 (after the merge of uncommitted source edits and of an already-held fix) | Passed: 553 tests, 553 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 4 | Passed before the second parent of a merge commit for a fix at the branch's tip: 555 tests, 555 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 5 | Passed on the final source, run alone: 555 tests, 555 passed, 0 failed, 0 skipped (exit 0). Two earlier runs of this source overlapped other test runs on the same machine; the log of one of them also holds the summary of an overlapping run (`# pass 554`, `# fail 1`) whose failing test the log does not name, and neither is counted as evidence. |
| `npm run workflow:test`, runs 5 and 6 (after that change) | Failed both times (exit 1): `# tests 555`, `# pass 554`, `# fail 1`, `# skipped 0`. The TAP output of both runs holds no `not ok` line and no error text: every one of the 555 tests is printed as `ok`, so the failing test is not named in the log and the cause is unknown. The same suite with the spec reporter (555 passed, 0 failed, exit 0) and runs 7 and 8 passed (555 tests, 555 passed, 0 failed, 0 skipped, exit 0), also the two files that hold the merge tests (`git-integration` and `loop-graph`: 28 passed). The failure is not explained; it did not recur in three further runs. |
| `npm run workflow:test`, runs 7 and 8 | Passed on the final source: 555 tests, 555 passed, 0 failed, 0 skipped (exit 0) both times. |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed (on the final source). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

Every test below runs on temporary git repositories made by the test, with fake model jobs, builds and captures; the thread repairs, widens, promotes and concludes through the workflow graph.

| Evidence named by the task | Tests |
| --- | --- |
| Two merged fixes | `loop-graph.test.ts`: two promoted fixes are merged into the branch the thread started on, one merge commit each, in the order of the promotions (`workflow/<thread>/fix/<cluster>` branches, `Merge fix for discrepancy <cluster>` with the `Workflow-Thread` and `Merged-Fix` trailers, the branch's working tree holding both fixes, `merge` in `outcome.json` and the `Merge:` line). |
| A conflicting fix and the one after it | `loop-graph.test.ts`: a fix that does not rebase onto the moved branch is not merged, nor the fix promoted after it (both `merge_failed` at stage `merge`, the first naming `Chummer/frmCreate.cs`, the second naming the first; the branch keeps its commit). |
| A moved base branch | `loop-graph.test.ts`: a branch that moves while the fixes are merged is a setup error naming the integration branch, and the resumed thread merges onto its new tip. |
| A refused fast-forward with a resume | `loop-graph.test.ts`: a fast-forward refused for a local edit of a merged file is a setup error naming `workflow/<thread>/integration`; once the edit is committed the resumed thread merges each fix once. |
| A branch that is not checked out | `loop-graph.test.ts`: a branch no worktree has checked out when the thread concludes is advanced by a ref update, and the checkout stays as it is. |
| A detached `HEAD` at start | `loop-graph.test.ts`: a thread that repairs and widens refuses a detached `HEAD` before the build and stores nothing (no checkpoint, no thread folder prepared, no job); one without widening records it. |

Also covered:

- A thread stored before its start branch was recorded concludes its promoted fix as `fixed` without merging and says why in `merge.skipped`: `loop-graph.test.ts`.
- `fixed` only with a merge, `merge_failed` with stage `merge`, the reason and the fix's commit, and `merge_failed` keeping the outcome at `findings_remaining`: `loop-rules.test.ts`.
- The branch `HEAD` names is read by its full ref, so a tag with the branch's name does not make it ambiguous: `git-integration.test.ts`, headBranch names the checked-out branch, or none when HEAD is detached.
- Fixes verified on a source that held uncommitted edits are not merged (all end `blocked`, then `merge_failed`, naming the edited files) into a branch that lacks them, and are merged once the branch has them: `git-integration.test.ts`.
- A resumed merge checks the source edits against the last fix merged before (a fix that changed an edited file itself does not block the next one; an edit the branch lost since blocks it): `git-integration.test.ts`.
- A fix whose commit the branch holds in its history already (the branch was advanced to it, with or without later commits) gets a merge commit with the branch's tree, the `Merged-Fix` trailer and two parents (the tip and the fix commit, or the commit the fix was made on when the tip is the fix commit): `git-integration.test.ts`.
- A fix whose change the branch has already (the rebase drops it) gets a merge commit of its own with the branch's tree and the `Merged-Fix` trailer, and is skipped as merged before when asked again: `git-integration.test.ts`.
- The fast-forward writes the person's checkout with the repository's line-ending settings (`core.autocrlf=true` gives CRLF) and leaves `git status` clean: `git-integration.test.ts`.

## Fixture-tested scope

All of the above runs on temporary repositories with fake model jobs, builds, narrow checks and level captures. No model job, build or capture ran.

## Live evidence

None for this task. `bin/ChummerGenSR4.exe` was not run, built or touched.

## Unverified

That a live `npm start` thread merges a real promoted fix into the branch it started on and advances that branch's checkout.

## Task 3.1: docs for worktrees, branches and the merge

`AGENTS.md` describes the thread's source branch, the attempt, subtask and widening worktrees and their branches, the patch from the source and attempt commits, promotion from the widened worktree, `merge_failed`, the new Merge section (the start branch, a detached `HEAD`, the rebase and merge commit per fix, conflicts and uncommitted source edits, the integration branch, the fast-forward or ref update, `merge` in `outcome.json`) and which branches may be deleted. `README.md` describes the attempts' worktrees and branches and the merge into the branch a run started on.

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0). |
| `npm run workflow:test` | Passed: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 20 passed, 0 failed (run after the branch was rebased onto the current master and the docs merged with its parallel-tries text). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

## Fixture-tested scope

None added: this task changes only documentation.

## Live evidence

None for this task.

## Unverified

That the documented behaviour holds in a live `npm start` thread.

## Task 4.1: a live thread through repair, widening, conclude and the merge

### Setup

The live threads ran in a separate worktree of this repository, on a local branch that adds one commit to this change's branch: `Move the metatype source caption for a live repair run` moves `lblMetatypeSourceLabel` in `Chummer/frmCreate.Designer.cs` from (628, 32) to (640, 32), so that the build-mode Common tab has one discrepancy to fix. A thread merges into the branch it starts on, so each started on that branch, whose checkout was clean and has `core.autocrlf=true`. The settings overlay held `settings/default.xml` with the fixture books. A local workflow profile set every job kind to Claude.

Command, in PowerShell: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --case Diego_v_alpha2_by_bessgeor --capture common`.

Run 5 below is the live run of this change's code. It ran with that commit (`9cffd595ddbb2152bafd930ae76d9ce99d085d9b`) on the change's final source; the only later difference in the change's code and tests is one test added to `workflow/tests/loop-graph.test.ts`. Runs A, B and 1 to 4 ran on earlier states of the change and are kept as its history.

### Earlier threads

| Run | Thread | Result |
| --- | --- | --- |
| A | `wf-20261028T222819Z-765bb7a7` | Exit 2, outcome `findings_remaining`, 0 clusters. An execution failure: `candidate: FAILED after 15.8 s: startup: window-activation: window 69716 was not in the foreground after 10 attempts 200 ms apart`, the foreground held by a window of another `ChummerGenSR4` process. Coverage invalid; completeness 16 planned, 16 execution-lost; nothing was compared. |
| B | `wf-20261028T222952Z-a819b1d0` | Exit 1: the cluster was confirmed, repaired, widened and promoted, then nothing was merged: `Loop d-14297e69d59676fd: merge_failed after 1 attempt; merge: the thread's source held edits of Chummer/clsMTRNG.cs, bin/data/armor.xml, bin/data/armor.xsd, …, bin/lang/language.xsd that live/add-repair-worktrees-4.1 lacks; commit them first (the fixes were verified on top of them)`, then `Merge: live/add-repair-worktrees-4.1 961228f1… -> 961228f1…; 0 of 1 fixes merged`. The checkout held none of these edits: the thread's source commit holds the checkout's bytes, which are CRLF under `core.autocrlf=true`, while the branch's blobs of those files are LF. The merge now stages the thread's commits as the person's own `git add` would before it compares or replays them. |
| 1 | none | Exit 3 before any thread: `Setup error: The workflow profile … cannot be read: Bad escaped character in JSON at position 393 (line 13 column 21)`. The local profile's executable path had unescaped backslashes; it was rewritten with forward slashes. Nothing was launched. |
| 2 | `wf-20261127T224508Z-68d4d6a3` | Exit 2, outcome `findings_remaining`. The cluster `d-ef565e590889cef8` was confirmed, its repair attempt passed the narrow check, and the widening passed its narrow level, then failed at the character level as an execution failure: `widen d-ef565e590889cef8 character: failed: execution failure in the level run: capture status 2, coverage invalid (failure:build-Diego_v_alpha2_by_bessgeor/candidate)`, caused by `candidate: FAILED after 3.2 s: startup: window-activation: window 1514030 was not in the foreground after 10 attempts 200 ms apart (foreground: window 6033636 'C:\Windows\system32\cmd.exe ' of class 'ConsoleWindowClass' in process 1244 (pwsh))` (capture run `20261127T230020Z-8d784441`). The cluster ended `widening_rejected` after 1 attempt; nothing was promoted or merged. |
| 3 | `wf-20261127T230154Z-94dff1af` | Exit 2, outcome `findings_remaining`. Re-run to classify the failure: the same execution failure, this time in the diagnosis check (`candidate: FAILED after 3.3 s: startup: window-activation: window 1643740 …`, same foreground window, capture run `20261127T230246Z-fc89b193`), so the cluster ended `undecided` after 0 attempts. The window belonged to another program on the desktop. It was then minimized (its process was not touched), and it no longer held the foreground. |
| 4 | `wf-20261127T230805Z-bf58a06e` | Exit 1, outcome `verified_for_scope`: 1 of 1 clusters fixed after 1 attempt, every capture run with valid coverage, widening 1, 13, 82 and 120 rows passed at its four levels, and the fix merged into `live/add-repair-worktrees-4.1` (`4634ef3f…` -> `d907d6b4…`). The promoted widening's worktree stayed registered after conclude, although the design has the end of the thread remove widening worktrees; fixed since (below). |

The failures of runs A, 2 and 3 are execution failures on the desktop (a window that kept the foreground), not visual differences; none of those threads promoted or merged anything. Between run B and run 1, with the line-ending change of the merge, `npm run workflow:typecheck` passed, `npm run workflow:test` passed 647 of 647 tests and `npm run openspec:validate` passed 20 of 20.

### Changes after run 4

The merge now reads a source's uncommitted edits against the commit the source was captured on (before, a file the branch changed during the thread could count as an edit), leaves a conflicting fix's branch at the fix commit, names the replayed files literally, stages them whatever `core.safecrlf` says, keeps their modes whatever `core.filemode` says, stages a file the branch's tip lacks on its entry of the captured commit (before, a fix of a CRLF-stored file the branch renamed conflicted on every line), and removes its worktree before its temporary folder. `conclude` removes the promoted widenings' worktrees. The branch was rebased onto `master`, which had gained the loop driver.

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final code. |
| `npm run workflow:test`, first full run on the rebased branch | Failed: 685 tests, 683 passed, 2 failed (exit 1); output below. |
| `npm run workflow:test`, after the two tests read the fix commit | Passed: 685 tests, 685 passed, 0 failed (exit 0). |
| `npm run workflow:test`, with the renamed-file change and its test | Passed: 686 tests, 686 passed, 0 failed (exit 0). |
| `npm run workflow:test`, final code and tests | Passed: 687 tests, 687 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 20 passed, 0 failed. |

The failures of the first full run (paths shortened to `<temp>` and the repository root):

```
not ok 661 - passed attempts are widened one after the other through the levels and promoted as commits on the accepted branch
  error: "ENOENT: no such file or directory, open '<temp>\\workflow-diagnosis-UQq7RS\\threads\\wf-20261001T120000Z-a0d97ce8\\widening\\d-0000000000000400\\attempt-1\\source\\Chummer\\frmCreate.cs'"
  code: 'ENOENT'
  TestContext.<anonymous> (workflow\tests\widening-graph.test.ts:80:9)
not ok 679 - of an attempt with two passed tries only the selected one is widened and promoted, and widening.json and the report name it
  error: "ENOENT: no such file or directory, open '<temp>\\workflow-diagnosis-NwTf4H\\threads\\wf-20261001T120000Z-8f80cf9a\\widening\\d-0000000000000100\\attempt-1\\source\\Chummer\\frmCreate.cs'"
  code: 'ENOENT'
  TestContext.<anonymous> (workflow\tests\widening-tries.test.ts:65:9)
```

Both tests read the promoted widening's worktree after the thread had concluded, which now removes it.

Before that run, four runs of the suite on the working tree were stopped partway because the source was edited under them; they are not results of the suite. Their logs list failures of `git` and other child processes that could not start (`Command failed: git … init -q`, exit code 3221225794), assertions that received that exit code or its consequence, and in the last of them the same two `ENOENT` failures as above.

The new tests fail without their change: against the previous merge code, the tests of the moved branch, the conflicting converted fix, the staging and the temporary folder failed; removing the literal pathspecs, the `core.safecrlf` setting or the mode keeping one at a time failed the staging test; without the captured commit's entry the renamed-file test ends with a conflict.

### Run 5: execution outcomes

Thread `wf-20261128T004948Z-2757148c`: exit 1, outcome `verified_for_scope`, 1 of 1 clusters fixed after 1 attempt, model time 1.0 min, elapsed 24.9 min. Every capture run had valid coverage and no failed action or side.

| Step | Capture run | Execution | Canonical side |
| --- | --- | --- | --- |
| Initial capture (reused from thread `wf-20261127T224508Z-68d4d6a3`) | `20261127T224516Z-3f12f9f0` | status 1, coverage valid (contiguous, 0 failures, 6 optional absent) | live |
| Diagnosis check | `20261128T005032Z-90826b1c` | status 1, coverage valid, 0 failures | 2 cases from the cache, `career-facemage_Sam_career` live |
| Repair narrow check | `20261128T005529Z-c5d0efc5` | status 0, coverage valid | cache |
| Widening narrow | `20261128T005615Z-d8aff578` | status 0, coverage valid | cache |
| Widening character | `20261128T005655Z-adfffe77` | status 0, coverage valid | cache |
| Widening mode | `20261128T005756Z-cef8cd3e` | status 0, coverage valid | cache (7 cases) |
| Widening suite | `20261128T010449Z-0dbd7a82` | status 0, coverage valid | cache (7 cases) |

The cached canonical sides came from the shared canonical cache, stored by the live canonical sides of runs 2, 3 and 4. In this run the canonical executable ran for one case, `career-facemage_Sam_career` in the diagnosis check.

### Run 5: visual results

- Initial capture: 0 passed, 1 failed (`build-Diego_v_alpha2_by_bessgeor/common`); the comparer reported 1 discrepancy in 1 group, completeness 16 planned, 1 reported, 15 filtered, 0 analysis-failed, 0 execution-lost, 0 unaccounted. This is the seeded discrepancy and the reason for the exit status 1.
- Diagnosis: hypothesis and challenge on Claude. The challenge found no alternative to the caption's designer location (640, 32); the check confirmed the cluster (`build-facemage_Sam/common` differs, `career-facemage_Sam_career/common` matches, `build-Diego_v_alpha2_by_bessgeor/skills` matches).
- Repair: attempt 1 passed the narrow check (1 passed, 0 failed).
- Widening: narrow 1 passed, character 13 passed, mode 82 passed, suite 120 passed, each with 0 failed and target, introduced, changed, pre-existing and unattributed 0; attempt 1 was promoted.

### Run 5: branches, commits and the merge

| Branch | Commit | Content |
| --- | --- | --- |
| `workflow/wf-20261128T004948Z-2757148c/source` | `3d4df320e0efcecaed877ebc6eafe2e14f48af63` | The thread's source on `9cffd595…`: 86 files differ from it, all by line endings only (the checkout's CRLF bytes). |
| `workflow/wf-20261128T004948Z-2757148c/repair/d-ef565e590889cef8/attempt-1` | `f6c823bf2e78315aebf971f7414a97b514324f3b` | Repair attempt 1. |
| `workflow/wf-20261128T004948Z-2757148c/widening/d-ef565e590889cef8/attempt-1`, `accepted/wf-20261128T004948Z-2757148c` | `c71dd3388fbec9c6413db6dbb706e408b3f32ced` | The fix commit, on the source commit. |
| `workflow/wf-20261128T004948Z-2757148c/fix/d-ef565e590889cef8` | `2aea0442ba68f59a44ec4fa9bea0fd683fc800af` | The fix replayed onto the branch's tip `9cffd595…` (trailers `Workflow-Thread`, `Discrepancy`, `Repair-Record`): only `Chummer/frmCreate.Designer.cs`, 1 line, `Point(640, 32)` to `Point(628, 32)`. |
| `workflow/wf-20261128T004948Z-2757148c/integration` and the start branch `live/add-repair-worktrees-4.1-b` | `0299d756e8ba6217801170985688cb6a7503ca00` | `Merge fix for discrepancy d-ef565e590889cef8`, parents `9cffd595…` and `2aea0442…`, trailers `Workflow-Thread: wf-20261128T004948Z-2757148c` and `Merged-Fix: wf-20261128T004948Z-2757148c/d-ef565e590889cef8`. |

The report printed `Loop d-ef565e590889cef8: fixed after 1 attempt; c71dd338… merged as 0299d756…` and `Merge: live/add-repair-worktrees-4.1-b 9cffd595… -> 0299d756…; 1 of 1 fixes merged, kept on workflow/wf-20261128T004948Z-2757148c/integration`. `outcome.json` holds the same merge (`status: merged`, `reason: null`), the disposition `fixed` with the commit and merge commit, and the measures: 1 cluster, 1 fixed, fix rate 1, 1 attempt. The start branch was advanced by a fast-forward of its checkout: `git diff 9cffd595 HEAD` is that one line, the checkout's `Chummer/frmCreate.Designer.cs` is back to its bytes before the seeded commit (SHA-256 `b793470b8e68abb8215da51bd5cb88a82914db829abb357624b0675466ef4911`), and `git status` is empty. After conclude `git worktree list` held no worktree of the thread, the widening's folder held only its build, build log and `widening.json`, and every branch above was still there. Nothing was pushed.

### Canonical executable

The SHA-256 of the canonical executable was `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` every time it was taken:

| Run | Where it was taken |
| --- | --- |
| A, B, 2, 3 | The `Canonical SHA-256 before` and `after` lines that every candidate build and capture step of the run printed (the capture steps also for the staged copy), including the failed ones. |
| 4, 5 | The same lines of every step, and `bin/ChummerGenSR4.exe` hashed before and after the whole run. |
| 1 | Not taken: the run ended before anything was built or launched. |

## Fixture-tested scope

On temporary git repositories, not in a live thread: a source that captured a checkout that converts line endings holds no edit and its fixes are merged as the branch's own commits hold their files; a converted source's real edit still blocks its fixes; a file the branch deletes or commits with LF during the thread is no edit; a converted fix follows a file the branch renamed; a conflicting fix's branch keeps the fix commit; replayed files named literally, staged under `core.safecrlf=true` with their modes kept under `core.filemode=false`; a temporary folder that cannot be removed; and, in workflow graph tests with fake agents and captures, conclude removing the promoted widenings' worktrees, and a worktree it cannot remove ending the run with a setup error before the merges, which the resumed thread completes.

## Live evidence

Run 5 above: one thread on the desktop, with a confirmed cluster, through diagnosis, repair, widening at all four levels, promotion, conclude with the removal of the widening worktree, and the merge into the start branch, on a checkout that converts line endings. Run 4 is the same path on the earlier code. Runs A, 2 and 3 are recorded execution failures on the desktop.

## Unverified

- A live merge of more than one fix, a live conflicting rebase, a live refused fast-forward and its resume, and a live thread whose source held real uncommitted edits: covered by fixture tests only.
- A live thread during which the branch moved, including a renamed, deleted or renormalized file.
- A live thread with fix changes (`fixes/openspec/changes/archive/…` in the fix commit).
- A live thread with planned subtasks.
- A live merge into a branch whose checkout does not convert line endings.
- In run 5 the canonical sides of every capture run but one case of the diagnosis check came from the cache (see above); they were not captured live in that run.
- A live removal of a widening worktree that another process holds.
