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
| `npm run workflow:test` | Passed: 576 tests, 576 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed (run again after the final wording change to `AGENTS.md`; the typecheck and test results are unchanged, as no code changed). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

## Fixture-tested scope

None added: this task changes only documentation.

## Live evidence

None for this task.

## Unverified

That the documented behaviour holds in a live `npm start` thread.
