# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), .NET SDK 10.0.401, Node 22.17.0, Claude Code CLI 2.1.284 (named in a local profile), `@openai/codex-sdk` 0.159.3. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Fixture-tested scope

These checks use no desktop, no model and no live app. They ran on commit "Test that an earlier widening's execution failure counts in the exit status", which holds all of the change's code and tests.

| Command | Result |
|---|---|
| `npm ci` | `found 0 vulnerabilities` |
| `npm run openspec:validate` | `Totals: 10 passed, 0 failed (10 items)` |
| `npm run workflow:typecheck` | no output, exit 0 |
| `npm run workflow:test` | `# tests 264`, `# pass 264`, `# fail 0` |
| `dotnet build parity/Parity.slnx -c Release --nologo` | `0 Warning(s)`, `0 Error(s)` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 185, Skipped: 0, Total: 185` |

The change touches no C# source, schema or generated file, so the parity build, the parity tests and the contract checks only show that nothing else moved. The first implementation commit was also type-checked and tested on its own (`# tests 256`, `# pass 256`).

### What the new tests cover

- Retry rules, dispositions and outcome (task 1.1; `loop-rules.test.ts`): a rejection at each repair stage (`model`, `deadline`, `patch`, `build`, `check`) and at the widening stages `build`, `narrow`, `character`, `mode` and `suite` is followed by a next attempt; a narrow check with status 2 or invalid coverage, a widening rejected as an execution failure or at `apply` or `promote`, a promoted or passed attempt, a failed repair job, a cluster out of budget, and the widening of an earlier attempt give none; the attempt limit stops a second attempt at 2 and allows it at 3, and a spent budget moves the cluster to the budget list; `retryLimits` reads the profile's limit and the budget boundary (59 999 ms of 60 000 not spent, 60 000 spent), and a thread whose stored options lack the limit, or that has no repair, has 1; a next attempt sets the cluster `pending` with the latest attempt (by repair or by widening, with stage and reason) among the earlier ones and sets its widening aside; a repair stored without the `earlier` field counts its attempt and gets the field from the next attempt's update; every disposition from its stage results, with the attempts, stage and commit, and an inconsistent state (a diagnosis or repair still pending, a widening still verified) is an error; every outcome rule (no cluster, all fixed, a capture with status 2, other findings, an open cluster, a cluster out of budget with and without other open findings). The profile accepts `repair.maxAttempts` and refuses 0 and 1.5 (`agents.test.ts`); the run options default it to 2 and take it from the profile (`options.test.ts`).
- Earlier attempts in the prompt (task 1.2; `repair-patch.test.ts`, `loop-graph.test.ts`): a first attempt's prompt has no `EARLIER ATTEMPTS` section and carries `repair-v2`; a next attempt's prompt lists the earlier attempt's number, `rejectedBy`, stage, reason and its patch text from `patch.diff`; both attempts' source copies held the snapshot's `class frmCreate { int moved; }`, so the second holds none of the first's change; each attempt has its own record and `repair/<cluster>/attempt-<n>/`; `repair.json` and the report list the earlier attempt.
- Widening per attempt (task 1.3; `loop-graph.test.ts`, `widening-graph.test.ts`): a cluster rejected at the `character` level with an `introduced` row gets a second attempt, which is promoted; `widening/<cluster>/attempt-1/widening.json` holds the rejection and `attempt-2/widening.json` the promotion, the thread's `widening.json` lists the earlier widening apart from the current one with totals over both (2 attempts, 1 cluster, 1 promoted, 1 rejected), and the report prints both; an earlier widening whose level had execution failures makes the exit status 2 like a current one; a cluster rejected at its narrow check in the first round is widened in the second on the source promoted for the other cluster in the first, and the promoted cluster gets no further repair job. The C5 tests run unchanged apart from the new folder.
- Graph, document and report (task 1.4; `loop-graph.test.ts`, `graph.test.ts`): a cluster fixed by its second attempt ends `fixed` after 2 attempts with its commit, `outcome.json` holds `verified_for_scope`, the scope, the measures (1 cluster, 1 fixed, fix rate 1, 2 attempts, 4 000 ms model time, 2 h elapsed from the thread's start to its conclusion) and the report prints `Loop <cluster>: fixed after 2 attempts; <commit>` and the `Outcome:` line after the widening lines while the exit status stays 1; a narrow check with status 2 gives no next attempt, exit 2 and `findings_remaining`; two rejected attempts end `repair_rejected` after 2 attempts; a budget of three job-seconds ends with `budget_exhausted` and the stage of the last rejection; `--no-diagnosis` and `--only triage` give `not_diagnosed`, `--no-repair` `not_repaired`, `--no-widening` `not_widened` (also after a next attempt without widening); two refuted clusters give `findings_remaining` without scope problems; a run killed during the second attempt's narrow check resumes with only that attempt (no diagnosis job, a new record, attempt 3 after the interrupted 2) and is fixed; a thread whose stored options lack the limit and that records no start concludes with one attempt and `elapsed unknown`; a run that triaged concludes once and one that ended at capture or compare (`--only capture`, `--only compare`) has no outcome.

## Live evidence

Both runs ran on commit "Describe the next attempts and the thread outcome" (`4c58f9a`); the later commits add one unit test and change `openspec/` (this file, the tasks and the archive), so they do not change what the runs show. Command: `npm.cmd start -- --settings-overlay out/overlays/fixture-books …`, with `settings/default.xml` holding the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`), the canonical cache from `PARITY_CANONICAL_CACHE` (a folder outside the repository shared by the worktrees) and `PARITY_WORKFLOW_PROFILE` naming a profile that sets only `agents.executables.claude`, so `repair.maxAttempts` was the default 2. `Get-FileHash` printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before and after each run, and every capture runner call and build of both runs printed that hash as `Canonical SHA-256 before` and `after`. Every canonical side of both runs came from the cache (entries stored by earlier runs of the same inputs); no canonical side ran live.

### Run 1: the whole suite on the current source

Thread `wf-20261002T041858Z-ffbff298`, `npm.cmd start -- --settings-overlay out/overlays/fixture-books`, 13 cases, 19.0 min.

- Execution: each of the 13 cases' capture exited with 0, coverage valid and contiguous, 0 failures (2 to 8 optional absent per case); run folders `20261002T041906Z-8d458846` to `20261002T043616Z-d907b8fc`.
- Visual: 211 rows, 211 passed; every compare `clear` with 0 discrepancies; completeness complete for every case (0 analysis-failed, 0 execution-lost, 0 unaccounted).
- Triage: `0 discrepancies in 0 clusters (0 new), 0 other findings`. Diagnosis, repair and widening ran with nothing to do (`0 clusters`, `0 attempts`, no accepted branch).
- Outcome: `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min, elapsed 19.0 min`; exit 0.

The candidate built from this branch matches the canonical executable on every capture of the suite, so the source has no discrepancy for the loop to work on.

### Run 2: a seeded discrepancy through the loop, with a kill and a resume

As in run 1 nothing differs, the candidate source was changed for this run only, without committing, with the same two edits as the widening change's evidence:

- Seed A, the discrepancy in the thread's scope: in `Chummer/frmCreate.Designer.cs` the location of `lblMetatypeSourceLabel` (the "Source:" caption on the Common tab of the build form) went from `(628, 32)` to `(640, 32)`; file SHA-256 `b793470b…4911` before, `805b5d14…264c` while seeded.
- Seed B, a difference outside the thread's scope that the fix does not touch: in `Chummer/frmCareer.Designer.cs` the location of `cmdAddWeek` (the "Add Week" button on the career form's Calendar tab) went from `(8, 6)` to `(20, 6)`; `dc5df96d…fc84` before, `96ec251d…d0c7` while seeded.

Both edits were reversed byte for byte after the run; the files' hashes were `b793470b…4911` and `dc5df96d…fc84` again and `git status` was clean.

Thread `wf-20261002T044028Z-6ce809b5`, `npm.cmd start -- --settings-overlay out/overlays/fixture-books --case Diego_v_alpha2_by_bessgeor --capture common`:

- Capture, execution: run `20261002T044032Z-77483f92`, capture 1, coverage valid (contiguous, 0 failures, 6 optional absent), canonical side from the cache. Visual: 0 passed, 1 failed; compare `differences`, 1 discrepancy in 1 group; completeness 16 planned, 1 reported, 15 filtered, 0 unaccounted. Triage: 1 cluster `d-14297e69d59676fd`, 0 other findings.
- Diagnosis: the hypothesis (Claude) named `lblMetatypeSourceLabel` at (640,32); the challenge (Codex) found no alternative. Check run `20261002T044747Z-5a341350`: execution status 1, coverage valid, 0 failures; observations `build-facemage_Sam/common differs, build-Diego_v_alpha2_by_bessgeor/skills matches, build-rigger/common differs`; the cluster was confirmed.
- Repair: attempt 1 changed `Chummer/frmCreate.Designer.cs` (1 line added, 1 removed); narrow check run `20261002T045106Z-9348069c`: execution status 0, coverage valid, 0 failures; visual 1 passed, 0 failed. The attempt passed, so no next attempt was due.
- Widening, first process: `narrow` run `20261002T045155Z-e4288067` (status 0, valid; 1 passed) and `character` run `20261002T045242Z-ab04a3de` (status 0, valid; 13 passed) passed. While the `mode` run `20261002T045357Z-f9171376` was capturing its first case, `taskkill /T /F` ended the process tree of `npm start`; no Chummer process was left.
- Resumed process, `npm.cmd start -- --resume wf-20261002T044028Z-6ce809b5`: it printed `Taking over the desktop lane from process 34480, which is no longer running.` and went on at the `mode` level without repeating the capture, compare, diagnosis, repair, widened build, `narrow` or `character`. `mode` run `20261002T045519Z-b9c07bd0`: status 0, coverage valid, 0 failures; visual 81 passed, 0 failed. `suite` run `20261002T050303Z-4c7280b5`: status 1, coverage valid, 0 failures; visual 111 passed, 6 failed, the `calendar` capture of each of the six career cases (seed B). The accepted source was built and captured for them: baseline run `20261002T051242Z-df603654`, status 1, coverage valid, 0 failures; all six rows were attributed `pre-existing`, and the level passed.
- Promotion: `attempt 1 PROMOTED as 777cc99cf31677afb04c6ffe3f65e07e118a4786 on accepted/wf-20261002T044028Z-6ce809b5`. The branch held, on `4c58f9a`, the commit `Source captured by thread wf-20261002T044028Z-6ce809b5` (`71fe8f5`, the two seeded lines) and the fix commit, which moved `lblMetatypeSourceLabel` from `Point(640, 32)` back to `Point(628, 32)` with the trailers `Workflow-Thread`, `Discrepancy` and `Repair-Record: wf-20261002T044028Z-6ce809b5/d-14297e69d59676fd/repair/1`. HEAD stayed `4c58f9a` and `git status` listed only the two seeded files during the run. After these values were recorded the branch was deleted with `git update-ref -d` and its expected value, since its source commit holds the seeded edits.
- Loop: `Loop d-14297e69d59676fd: fixed after 1 attempts; 777cc99…` and `Outcome: verified_for_scope; 1 of 1 clusters fixed, 1 attempts, model time 6.8 min, elapsed 38.2 min`. `outcome.json` held the scope (`build-Diego_v_alpha2_by_bessgeor`, `common`), no scope problems, the cluster `fixed` with its commit, the accepted branch and commit, and the measures (1 cluster, 1 fixed, fix rate 1, 1 attempt, 408 379 ms model time, 2 290 543 ms elapsed including the time the thread was stopped). The six `calendar` rows, outside the scope, stay listed as pre-existing findings of the `suite` level and did not change the outcome. Exit 1, from the thread's own capture, as the outcome does not change the exit status.

No usage limit was reached, so no quota wait happened.

## What remains unverified

- A live next attempt: the only live attempt passed its narrow check and its widening, so the route back to repair, the earlier attempts in a real prompt, the per-attempt widening of a second attempt and a second-round widening on a promoted source are fixture-tested only.
- Live dispositions other than `fixed`, and the live outcomes `findings_remaining` and `budget_exhausted`: fixture-tested only.
- A benchmark item from a live fix: `benchmark add` takes an accepted fix of a discrepancy in the source's history; on the current source the suite has no discrepancy (run 1), and the only fix the loop made live was of a seeded discrepancy whose commits were removed with the accepted branch, so no item was written. The measures in `outcome.json` of the two runs above are the loop's recorded numbers.
- A kill between a next attempt's start and its checkpoint on the real host: fixture-tested (a run killed during a second attempt's narrow check resumes only that attempt).
