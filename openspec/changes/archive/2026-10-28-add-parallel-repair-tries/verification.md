# Verification

## Task 1.1: several hypotheses per cluster

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Failed before the router test was updated: 576 tests, 575 passed, 1 failed (exit 1). `not ok 84 - the router waits first, then hypothesizes, then challenges, then checks once` (`diagnosis-graph.test.ts`): `Expected values to be strictly deep-equal` with actual `{ kind: 'hypothesize', jobs: [{ clusterId: 'a', variant: 1 }] }` and expected `{ kind: 'hypothesize', clusters: ['a'] }`. Cause: the route now names one job per hypothesis; the test was updated to the new route and extended to several hypotheses. |
| `npm run workflow:test`, run 2 | Passed with the new tests: 586 tests, 586 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 3 | Passed after a whole cluster replaces the one it names in the state and with the merge test: 587 tests, 587 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 4 | Passed on the final source, with a budget-stopped hypothesis ending an unconfirmed cluster as `budget_exhausted` and no quota wait for a failed cluster: 588 tests, 588 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 5 | Passed with a stored record that no hypothesis lists labelled by the hypothesis it names: 589 tests, 589 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 5 | Passed after the third review round (a narrow check of any try that failed to execute allows no next attempt): 618 tests, 618 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

Every test below runs the workflow graph with fake model jobs and fake check captures over fixture run folders. No live run belongs to this task.

| Evidence named by the task | Tests |
| --- | --- |
| Two hypotheses, one confirmed and one refuted | `diagnosis-hypotheses.test.ts`: both hypotheses start side by side, then each is challenged with its own hypothesis only; their records are numbered from one sequence and each challenge record names its own hypothesis; one check run covers the predictions of both hypotheses and both alternatives; hypothesis 1 is `refuted`, hypothesis 2 `confirmed`, the cluster `confirmed`; each record is labelled with its own hypothesis's outcome; `diagnosis.json` lists both hypotheses, and the report line and check line name each outcome. Also: every hypothesis refuted refutes the cluster, and the repair starts from the confirmed hypothesis 2 (its prompt and `hypothesisRecord`). `check.test.ts`: the cluster rule (any confirmed, every predicting one refuted, else undecided) and the plan over every challenged hypothesis. |
| An abstaining variant | `diagnosis-hypotheses.test.ts`: an abstaining hypothesis gets no challenge and no label while the other decides the cluster; a cluster whose every hypothesis abstained is `abstained`, not checked, and concludes `abstained`. Also a failed hypothesis fails its cluster (exit 2). |
| A resumed thread | `diagnosis-hypotheses.test.ts`: a run killed during hypothesis 2's challenge ends with 3; on resume no hypothesis is asked again, only that challenge runs again, record IDs stay distinct and the labels stay per hypothesis. |
| A thread stored with one hypothesis | `diagnosis-hypotheses.test.ts`: a thread whose options lack `hypotheses` and whose clusters lack `variants` and `firstRecords` is killed during its challenge and resumed as one hypothesis; every record gets the cluster's label, as before. `options.test.ts`: `diagnosis.hypotheses` is 1 to 3, 1 by default and in options stored without it. |

Review findings not changed:

- A failed hypothesis ends its cluster's jobs, so the cluster's other hypotheses are not challenged: the cluster is failed whatever they would show, and it is not checked.
- None of the findings about interrupted jobs' records remains: a diagnosis record holds the number of its hypothesis, so the record of a job stored before its hypothesis was checkpointed is labelled with that hypothesis's outcome (`diagnosis-hypotheses.test.ts`: a refuted hypothesis's interrupted challenge stays `refuted` when another hypothesis confirms the cluster).

## Task 2.1: parallel repair tries

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Failed on the implementation before the new tests: 590 tests, 586 passed, 4 failed (exit 1). Every repair test passed; the four failures are lane tests. `not ok 312 - stopping the run cancels the request: the agent kills it and stops the apps started from the working folder` (`lane-agent.test.ts:107`): `Expected values to be strictly deep-equal` with actual `[]` and expected `[ '…\Temp\workflow-agent-lfCaBg\repository\out\runs' ]`. `not ok 313 - a working folder the lane cannot see fails the request with a message naming it` (`lane-agent.test.ts:120`): `SetupError: The lane agent of desktop lane vm is not running; start npm run lane-agent -- --folder "…\Temp\workflow-agent-OOFJc3\lane" in that lane's session.` `not ok 320 - a change seen after a long gap between looks does not count as a heartbeat heard now` (`lane-agent.test.ts:292`): `false == true`. `not ok 327 - two desktop commands run on two lanes at the same time, and a third waits for one of them` (`lanes.test.ts`, `unhandledRejection`): `EPERM: operation not permitted, open '…\Temp\workflow-lanes-bTz2mP\b.lock'`. |
| `node --import tsx --test workflow/tests/lane-agent.test.ts` | Run alone after run 1: 15 tests, 15 passed (exit 0). |
| `npm run workflow:test`, run 2 | Passed with the new tests: 599 tests, 599 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Passed on the final source, after the review fixes (an attempt rejected by the try that ran when the budget stopped another, earlier attempts read before any workspace exists, and a thread stored before attempts had tries): 601 tests, 601 passed, 0 failed, 0 skipped (exit 0). The four lane tests of run 1 passed in runs 2 and 3. |
| `npm run workflow:test`, run 4 | Passed after the second review round (each try goes on to its own build and check as soon as its jobs end; one deadline for the attempt): 604 tests, 604 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

Every test below runs the repair service with fake model jobs, fake builds and fake narrow checks over a fixture repository whose real worktrees and branches each try uses. No live run belongs to this task.

| Evidence named by the task | Tests |
| --- | --- |
| Two passed tries with different sizes | `repair-tries.test.ts`: two confirmed hypotheses, one try each, started side by side (the fake runner saw both jobs at once) in two worktrees on `attempt-1-try-1` and `attempt-1-try-2`, each from the thread's source commit and told only its own hypothesis; the first changes 12 lines, the second 5; both are built and checked; the attempt passes with try 2, whose record, branch, commit, hypothesis record and patch are the attempt's; try 1 is archived as passed and not selected; both records are labelled `passed`. |
| A tie | `repair-tries.test.ts`: two tries of three changed lines each, the first in two files: the second is selected; the same patch twice: the first is selected; and the rule over sizes alone. |
| Every try rejected | `repair-tries.test.ts`: try 1 rejected at `build`, try 2 at `check`: the attempt is rejected at `build` with both tries' stages and reasons, no try selected, each try's record labelled with its own stage; the next attempt's prompt lists both tries, each patch once. |
| A usage limit in one try | `repair-tries.test.ts`: try 1 hits the usage limit while try 2 finishes: the attempt is parked with both records, try 2's job is charged, nothing is built, checked or archived; the attempt starts again as attempt 2 with two new try records and passes. |
| A spent budget | `repair-tries.test.ts`: one job at a time with a budget of one job: the second try never starts and is archived as rejected at `model` with the budget's reason; the attempt passes with try 1, or, when try 1 fails to build, is rejected by try 1; a budget spent before the attempt starts no try (`budget_exhausted`). |
| The archive's `try-<k>/` folders | `repair-tries.test.ts`: each `try-<k>/` holds its own `attempt.json` (try, hypothesis, outcome, record, branch, check), patch, files and build log, the top level keeps the selected try's patch and files and names it in `selectedTry` and `tries`; an attempt of one try keeps the attempt's record and branch and holds `try-1/`. `repair-planned.test.ts`: with fix changes each try plans and implements on its own branches (`attempt-1-try-<k>-task-<j>`), and the selected try's plan and fix draft are the attempt's. |
| One deadline for the attempt, tries judged as they finish | `repair-tries.test.ts`: a try whose job hangs does not hold back a sibling, which is committed, built and checked while the hanging job still runs; one job at a time with a 10-minute deadline and jobs of 4 minutes: the second try's job is given 6 minutes, not a fresh 10; jobs of 11 minutes: the first try is rejected at `deadline` before its build, the second never starts and is archived as rejected at `deadline` (not as the budget), and the attempt is rejected at `deadline`. |
| An execution failure in an unselected try | `loop-rules.test.ts`: one try passed and is selected while a sibling's narrow check had capture status 2: a visual rejection by widening starts no next attempt (`latestRejection` reports an execution failure), the same attempt with every try executed does; a rejected attempt shown by a try that executed has no next attempt either; and the run's repair status is 2 for the first attempt and 0 for the second. Since such an attempt is never followed by another, no earlier attempt holds an execution failure the status could lose. |

Also tested: the tries go round the confirmed hypotheses up to six, an execution failure of any try's narrow check makes the run's status 2, an interrupted attempt's stored try record moves the next attempt to the next number, an earlier attempt that lost a try's patch is a setup error before any workspace is made, and a thread stored before attempts had tries repairs from its first confirmed hypothesis alone (`repair-tries.test.ts`); `repair.tries` is 1 to 3 and 1 by default (`options.test.ts`).

Review findings not changed:

- A try that fails with `invalid_output` or `refused` beside a passed try does not fail the cluster: the attempt passes with the passed try, and the failed try stays in the archive as rejected at `model` with its failure.
- An execution failure of any try's narrow check stands for a rejected attempt, so no next attempt follows it, as after an attempt of one try whose check failed to execute.
- A usage limit in one try does not stop the jobs of the other tries: the attempt waits for them, so no job runs after the attempt ends, and charges the jobs they finished; a sibling whose jobs end after the limit is not built or checked, and one already building finishes its build and check, whose result the parked attempt discards.
- An attempt of one try also writes `try-1/`, as the proposal states; the state lists tries only for an attempt of several.

## Task 3.1: widening the selected try, and tries in the documents and the report

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Passed with the new tests: 622 tests, 622 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 2 | Passed before the review: 622 tests, 622 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Passed on the final source, after the review fixes (the try line ends with its reason, a widening prepared without its try names it when it ends, stricter archive checks): 623 tests, 623 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 4 | Passed on the final source, after the second review round (the report keeps the tries of an attempt that a next attempt followed): 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, CI run on the pushed branch | Failed: 624 tests, 623 passed, 1 failed (exit 1). Failing test, `repair-tries.test.ts` (task 2.1's test, nondeterministic): `a usage limit in one try parks the whole attempt; the finished try's job is charged, and the attempt starts again under a new number`, at line 220 (`deepStrictEqual([setup.host.builds.length, setup.host.checks.length], [0, 0])`): `Expected values to be strictly deep-equal: + actual - expected [ +   1, +   1 -   0, -   0 ]`. The finished try 2 was built and checked before try 1's usage limit was noted, because the test did not order the two tries' jobs. The same commit passed in the pull request's own CI run and in local runs 1 to 4. |
| `npm run workflow:test`, run 5 | Passed after the test held try 2's job until try 1's job ended with the limit and the attempt had time to note it: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

Every test below runs the workflow graph with fake model jobs, fake builds, fake narrow checks and fake level captures over a fixture repository whose real worktrees, branches and accepted branch the tries and the widening use. No live run belongs to this task.

| Evidence named by the task | Tests |
| --- | --- |
| Widening graph tests with a two-try attempt | `widening-tries.test.ts`: one confirmed cluster, two tries, the first changing 13 lines and the second 2: the attempt passes with try 2; only try 2's commit is applied and built (one widening build, holding try 2's file; try 1's file is never built), and the fix commit on `accepted/<thread>` makes try 2's change; the widening's record is try 2's, and the state, the cluster's `widening.json` and the thread's `widening.json` name `selectedTry` 2 of `tries` 2; only try 2's record gets the `widening` label, try 1's keeps its `repair` label `passed` and no `widening` label; `repair.json` lists both tries with their outcome, selection and record. A widening that rejects the selected try (its build fails) rolls back only that try, labels only its record and leaves no accepted branch. An archive whose top level is not its selected try's (another try's commit or record, another `selectedTry`, two tries selected, two tries of one number, a `selectedTry` without tries) is a setup error for widening, and an archive written before attempts had tries is read as before. A thread killed during a level whose widening was checkpointed without its try resumes, and the widening, its `widening.json`, the thread's `widening.json` and the report name try 2 of 2 from the archive. |
| The report lines | `widening-tries.test.ts`: the end-of-run report prints `Repair <cluster>: attempt 1 PASSED the narrow check with try 2 of 2; …`, a line per try with its hypothesis, changed lines and files, branch and archive, then `SELECTED` or `not selected` and its outcome, with the reason last, and each try's narrow check execution line apart from its visual line (no attempt-level check line for an attempt of several tries); `Widening <cluster>: attempt 1 try 2 of 2 PROMOTED as <commit> on accepted/<thread>` and `… try 2 of 2 rejected at build: …`. For a rejected attempt of two tries the report gives the attempt's stage with every try's stage and reason, each try's line, and the execution line (capture status 2, coverage INVALID) apart from the visual line of the try whose check ran. For an attempt that a next attempt followed, the report keeps its tries too: `latestRejection` carries them into the cluster's `earlier` list, and each earlier try gets its line and its own narrow check execution line apart from its visual line, under `Repair <cluster>: attempt <n> try <k>`. An attempt of one try keeps the report lines it had (the existing repair and widening graph tests pass unchanged). |

Review findings not changed:

- An attempt of one try also names `selectedTry` 1 of `tries` 1 in `widening.json`, as its archive does, while the state and `repair.json` list tries only for an attempt of several; the report names the try only for an attempt of several.
- Widening reads the archive's `attempt.json` when it prepares, builds and promotes, as it read it before when it built and promoted; the file is small and the archive is the source of the commit it applies.
- The repair service's log line for a try and the report's line for a try are written apart, as the attempt's log and report lines were before.

## Task 4.1: hypotheses and tries in `AGENTS.md` and `README.md`

`AGENTS.md` documents `diagnosis.hypotheses` and `repair.tries` in the profile, the hypotheses of a cluster with their challenges, the check over every hypothesis and the labels per hypothesis (Diagnosis and Evaluation), the tries of an attempt with their records, branches, selection rule, usage limit, budget, deadline and archive (Repair and Fix changes), the selected try in widening (Widening) and the tries in a next attempt's prompt and the rule on execution failures (Loop). `README.md` describes several explanations per group and the tries side by side with the smallest passed change going on.

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Passed after the first draft of the docs: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 2 | Passed after the first review fixes: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Passed on the final source, after the second review fixes: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

This task changes only documentation; no live run belongs to it.

Review findings changed: the Evaluation section's `check` label is the outcome of the record's own hypothesis; a try whose job failed with `invalid_output` or `refused` fails the attempt when no try passed; a try already building when a usage limit parks the attempt finishes its build and narrow check, whose result is discarded; tries are numbered round by round and those past the sixth are left out; the plan and subtask records of a try; the rule on execution failures stated once; the README checks every explanation given.

Review findings changed after the second review: the Repair section describes the attempt's working folder as each try's git worktree on its branch, the patch as the difference between the try's commit and the thread's source commit, and the `repair` label as on the attempt's record, or with several tries on each try's record.

## Task 5.1: a live run with two hypotheses and two tries

### Checks on the branch

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0). |
| `npm run workflow:test` | Passed: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |

### Setup

Both live threads ran on commit `ca9001bf` (`workflow/` tree `88c897477745ac76cf9fb3b6de1908a4cc48bf61`); this task changes only this file and `tasks.md`.

- No case of the suite differs between the canonical executable and a candidate built from this branch, so the candidate source was changed for the runs only, without committing: in `Chummer/frmCreate.Designer.cs` the location of `lblMetatypeSourceLabel` (the "Source:" caption on the Common tab of the build form) went from `(628, 32)` to `(640, 32)`; file SHA-256 `b793470b…4911` before, `805b5d14…264c` while seeded. After the runs the file was written back from `HEAD`; its hash was `b793470b…4911` again and `git status` was clean.
- Command: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --case Diego_v_alpha2_by_bessgeor --capture common`. The overlay's `settings/default.xml` holds the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). The canonical cache came from `PARITY_CANONICAL_CACHE`, a folder outside the repository that the worktrees share. `PARITY_WORKFLOW_PROFILE` named a profile outside the repository that sets only `agents.executables.claude` (the Claude Code CLI 2.1.308), `diagnosis.hypotheses: 2` and `repair.tries: 2`. Providers, models, efforts, the model pool (2), the deadline (60 minutes) and `repair.maxAttempts` (2) were the defaults.
- Canonical hash: `Get-FileHash bin/ChummerGenSR4.exe` printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before each thread and after the last run. Every build and capture runner call of both threads printed the same value as `Canonical SHA-256 before` and `after`, and each capture runner call printed it for its staged copy too.

### Thread 1: an execution failure at the first capture

Thread `wf-20261028T023537Z-ebe9b556`. Capture run `20261028T023549Z-dcc93d90` exited with 2, and its coverage was invalid: the candidate failed at startup with `window-activation: window 35000288 was not in the foreground after 10 attempts 200 ms apart`. The window in the foreground belonged to another ChummerGenSR4 process, showing a character that is in no fixture; that process was gone right after the run. The canonical side came from the cache. Visual: 0 rows; completeness 16 planned, 16 execution-lost. Triage found 0 clusters and 16 other findings. Outcome `findings_remaining`, exit 2. A foreign window caused this failure, not the change. The same command was run once more as thread 2.

### Thread 2: two hypotheses, four tries, one selected

Thread `wf-20261028T023648Z-52367ef0`, 34.5 min. Exit status 2, outcome `findings_remaining`. The causes are two execution failures, described below; both happened while the desktop was in use.

- Capture. Execution: run `20261028T023653Z-4f6f73f3` exited with 1, coverage valid (contiguous, 0 failures, 6 optional absent); the canonical side came from the cache. Visual: 0 passed, 1 failed; compare `differences` with 1 discrepancy in 1 group; completeness 16 planned, 1 reported, 15 filtered, 0 unaccounted. Triage: 1 cluster, `d-14297e69d59676fd`, and 0 other findings.
- Diagnosis. Two hypothesis jobs ran on Claude with effort medium (`hypothesis d-14297e69d59676fd #1` and `#2`), started side by side. Both named `lblMetatypeSourceLabel` at X=640 in `frmCreate`. Each was challenged on its own by a Codex job (`challenge … #1` and `#2`), and both challenges found no alternative. One check run, `20261028T023955Z-f7d3e3ff`, covered `build-facemage_Sam`, `career-facemage_Sam_career`, `build-Diego_v_alpha2_by_bessgeor` and `build-rigger` (`common`, `skills`) for both hypotheses. Every canonical side of the check ran live. Execution: capture status 1, coverage valid, 0 failures. Observations: `build-facemage_Sam/common` differs, `career-facemage_Sam_career/common` matches, `build-Diego_v_alpha2_by_bessgeor/skills` matches, `build-rigger/common` differs. The report line read `Diagnosis check: d-14297e69d59676fd confirmed (hypothesis 1 confirmed, hypothesis 2 confirmed)`. In `out/workflow/store.sqlite`, the records `…/hypothesis/1`, `…/hypothesis/2`, `…/challenge/1` and `…/challenge/2` each have the `check` label `confirmed`.
- Repair. The log read `running 4 tries side by side (hypotheses 1, 2, 1, 2), each on claude (default model, effort high), deadline 60 min`. Under the model pool of 2, the try records give start times of 02:48:37Z and 02:48:39Z for tries 1 and 2, and of 02:49:10Z and 02:49:12Z for tries 3 and 4. Each try had its own worktree and branch, `workflow/wf-20261028T023648Z-52367ef0/repair/d-14297e69d59676fd/attempt-1-try-<k>`, and its own record, `…/repair/1/try-<k>`. Each try changed `Chummer/frmCreate.Designer.cs` from `Point(640, 32)` back to `Point(628, 32)` (1 line added, 1 removed; the four `patch.diff` files are byte for byte the same). Each try's build exited with 0 in its own folder. The four scratch folders named in the log were gone after the attempt.

| Try | Hypothesis | Narrow check run | Execution | Visual | Outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | `20261028T024915Z-612565ac` | capture status 0, coverage valid, 0 failures | 1 passed, 0 failed | passed, **selected** |
| 2 | 2 | `20261028T025057Z-da0dca0e` | capture status 0, coverage valid, 0 failures | 1 passed, 0 failed | passed, not selected |
| 3 | 1 | `20261028T025006Z-3b1450aa` | capture status 0, coverage valid, 0 failures | 1 passed, 0 failed | passed, not selected |
| 4 | 2 | `20261028T025148Z-feddc83a` | capture status 2, coverage INVALID (`failure:build-Diego_v_alpha2_by_bessgeor/candidate`), 1 failure | 0 passed, 0 failed | rejected at `check` |

  Every narrow check took its canonical side from the cache (entry `c2ed9b23…9ba6`); the candidate side ran live. Try 4's candidate failed at its first action with `pointer: the pointer moved from {X=960,Y=17} to {X=961,Y=17} during the side`. This session gave no input during the run. This is an execution failure of that try's check; it is not a visual result.
- Selection. Tries 1, 2 and 3 passed with the same size: 2 changed lines in 1 file. The tie went to the lowest try number. The report read `attempt 1 PASSED the narrow check with try 1 of 4`, then a line per try, ending `SELECTED, passed` for try 1, `not selected, passed` for tries 2 and 3, and `not selected, rejected at check: execution failure: …` for try 4. Each try line was followed by its narrow check's execution line and then its visual line. The attempt's `attempt.json` has `selectedTry: 1` and lists the four tries in `tries`; its top level holds try 1's record, branch, commit `bb136bc9…` and check. The archive holds `try-1/` to `try-4/`, each with its own `attempt.json`, `patch.diff`, files and build log. In the store, the repair labels are `passed` on `…/try-1`, `…/try-2` and `…/try-3`, and `rejected` at `check` on `…/try-4`.
- Widening. Only try 1 was widened: one widened build (exit 0), and `widening.json` names `selectedTry` 1 of `tries` 4 and record `…/repair/1/try-1`.
  - `narrow`: run `20261028T025209Z-cfce6142`, execution status 0, coverage valid; visual 1 passed, 0 failed.
  - `character`: run `20261028T025259Z-6904be16`, execution status 0, coverage valid; visual 13 passed, 0 failed.
  - `mode`: run `20261028T025534Z-a1be4e59`, execution status 2, coverage INVALID. The canonical side of `build-rigger` failed at startup with `window-activation: … (foreground: window 133398 'Claude' … (claude))`, a desktop app window that took the foreground. Visual: 68 passed, 0 failed. The attempt was rejected at `mode` as an execution failure (`Widening d-14297e69d59676fd: attempt 1 try 1 of 4 rejected at mode`). Nothing was promoted, and `accepted/wf-20261028T023648Z-52367ef0` got no commit. Because the failure was an execution failure, no next attempt followed (`Loop d-14297e69d59676fd: widening_rejected after 1 attempt`). Only `…/try-1` got a `widening` label, `rejected` at `mode`; the other tries have none.
- Classifying the `mode` failure: `build-rigger` was run once more on its own, with `npm.cmd run parity -- --settings-overlay out/overlays/fixture-books --case build-rigger --capture common` and no cache, so the canonical side ran live; the candidate was the thread's seeded build. Run `20261028T031203Z-7fd7d7bf`: both sides `ok`, coverage valid, 0 failures. Visual: `build-rigger/common` failed with 0.000389, the seeded difference (the check run had observed it). The canonical hash was the same before and after. The canonical side starts fine when no other window takes the foreground, so the `mode` failure was caused by the foreground window, not by the code.

### Fixture-tested scope apart from live evidence

Live (thread 2):
- Two hypotheses per cluster, each challenged on its own.
- One check over both hypotheses, a label per hypothesis.
- Four tries, each in its own worktree and branch, with its own build and narrow check.
- The selection rule on a three-way tie (lowest try number).
- One try rejected by an execution failure of its own narrow check, while the attempt passed with another try.
- The archive's `try-<k>/` folders and `selectedTry`, and the report lines per try.
- Only the selected try widened and labelled.
- A widening level's execution failure, which allows no next attempt.

Fixture-tested only (tasks 1.1 to 3.1):
- A refuted or abstaining hypothesis beside a confirmed one.
- Tries of different sizes, and a tie decided by the number of files.
- Every try rejected, and the next attempt's prompt listing every try.
- A usage limit in one try.
- A spent budget or the deadline across tries.
- Resuming a thread during a try or a widening level.
- A promotion of a selected try.
- Fix changes with tries.

### Unverified

- A live promotion of a selected try on `accepted/<thread>`: the `mode` level of thread 2 failed to execute, so the `suite` level, the promotion and the fix commit did not run live.
- A live selection decided by patch size: every live try made the same one-line change.
- A live hypothesis that is refuted or abstains beside another, a live usage limit, budget stop or deadline across tries, and a live resume of a thread with several tries.

## Task 5.2: archive

| Command | Result |
| --- | --- |
| `npx openspec archive add-parallel-repair-tries --yes` | Archived as `2026-10-28-add-parallel-repair-tries`; specs updated: `deterministic-widening` + 1 added, `discrepancy-diagnosis` + 1 added, `isolated-repair` + 1 added and ~ 1 modified (totals + 3, ~ 1, - 0). |
| `npm run openspec:validate` | Passed strict validation after the archive: 20 passed, 0 failed. |
| `npm run workflow:test`, run 1 | Failed before the dependencies were installed in the checkout: 66 tests, 0 passed, 66 failed (exit 1), each with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'`. Cause: no `node_modules`; `npm ci` installed them. |
| `npm run workflow:typecheck` | Passed (exit 0) after `npm ci`. |
| `npm run workflow:test`, run 2 | Passed after `npm ci`: 624 tests, 624 passed, 0 failed, 0 skipped (exit 0). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |
