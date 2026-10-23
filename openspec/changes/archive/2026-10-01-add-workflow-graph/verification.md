# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), .NET SDK 10.0.401, Node 22.17.0. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

The fixture-tested checks below ran on the tree of the commit "Pin CRLF line endings for the parity and generated C# sources so every checkout builds the same tool assemblies", the last commit that changes code, specs or docs of this change. The commits after it add this file and archive the change; they change no source, case, fixture or setting.

Three small workflow changes were made after the live runs, and unit tests cover them: the per-case report no longer runs in the path that prints a resume hint (results that cannot be read after the graph finished give status 3 without it), the build commands carry the run's abort signal, and a derived triage identity that already names another stored identity gets a different id instead of overwriting it. None changes what a run without an interrupt, an unreadable result or an id collision does, which is every run below, so the live evidence still applies. The wording of two comments and of this file also changed.

The live runs were collected in two sets. Set 1 (L1 to L6) ran on an earlier state of the workflow code. Since then only workflow code changed (the desktop lane's refresh and wait handling, aborting and Ctrl+C, the comparer's step key, the capture step's check of the cases it covered, triage's identities, `package.json`); the capture runner, the comparer, the cases, the fixtures, the settings and the app did not. Set 1's capture and compare results therefore still describe the same tools and inputs. The parts of the evidence that the later workflow changes can change were collected again as set 2 (R1 to R6), and R4 and the Ctrl+C attempts ran on the final code of the host runner.

## Fixture-tested scope

These checks use no desktop and no live app.

| Command | Result |
|---|---|
| `npm ci` | exit 0, `found 0 vulnerabilities` (an earlier run on the same lock file printed `added 232 packages, and audited 234 packages in 23s`) |
| `npm run openspec:validate` | `✓ change/add-workflow-graph`, `✓ spec/development-process`, `✓ spec/parity-contracts`, `✓ spec/visual-parity-capture`, `✓ spec/visual-parity-compare`, `Totals: 5 passed, 0 failed (5 items)` |
| `npm run workflow:typecheck` | no output, exit 0 |
| `npm run workflow:test` | `# tests 67`, `# pass 67`, `# fail 0` |
| `dotnet build parity/Parity.slnx -c Release` | `0 Warning(s)`, `0 Error(s)` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 185, Skipped: 0, Total: 185` |

The rows run in the order of the CI job (`npm ci`, type check, tests, parity build, contract drift), followed by the contract and parity tests. Every commit of the branch was also type-checked and tested on its own while the history was assembled (`tsc` and `workflow:test` passed at each commit that has the workspace, 67 of 67 tests at the tip).

### What the workflow tests cover

- Options (`options.test.ts`): capture, compare and workflow options are parsed; `--canonical-exe`, `--candidate-exe`, `--runs-dir`, `--run-folder-file` and `--repo-root` are rejected as set by the workflow; unknown options, missing values, a threshold outside 0–1, an unknown `--only` node and `--live-canonical` with `--canonical-cache` are setup errors; `--recapture` is accepted alone and with `--only capture` and is a setup error with `--only compare` or `--only triage`; `--resume` takes a thread and nothing else; the cache folder comes from the option, then `PARITY_CANONICAL_CACHE`, then the profile, then local app data, and `--live-canonical` turns it off; the command line's overlay wins over the profile's; the profile is optional, strict and read from `PARITY_WORKFLOW_PROFILE`.
- Case planning (`case-plan.test.ts`): case names match the capture runner's (`<mode>-<fixture name>`), `include` sequences are expanded, cases are selected by name, file name or stem case-insensitively in case file order, an unmatched name is a setup error, each case gets its subset of requested captures and a case with none is excluded, an unknown capture name and an invalid case file are setup errors.
- Host (`host.test.ts`): the desktop lane is created, released and taken again; a running owner is waited for and announced once; a lock of a dead process on this host is taken over; a lock that its owner no longer refreshes is taken over even when a process with its ID exists, and a fresh lock of a running owner is not; the owner refreshes the lock while it holds the lane; a lock of another host is never taken over; a waiter that judged a lock abandoned does not remove a live lock created after it read the lock, and leaves no guard file behind; a takeover guard that stays in place is a setup error naming it; a wait for the lane ends when the run is stopped; a lock that stays unreadable is a setup error naming the file; release refuses a lock another owner replaced, and a release failure after a failed child is printed beside the child's error instead of replacing it; the CPU pool never exceeds its size; children report their exit status with prefixed output on either resource; a child that cannot start is a setup error and the lane is released; a child that ends from a signal (a fake process, since Windows reports no signal for an external kill) is a setup error and the lane is released; an aborted child is stopped, the run is a setup error, the lane is released, and a command whose signal had already aborted is not started; the abort of a desktop command also stops the apps started from the run folders, a cpu command does not, and a failure to stop them is printed; a real process running from a folder is stopped by that function while one running from elsewhere is left alone.
- Steps (`steps.test.ts`, a fake host that plays both tools): the capture key changes with every input it lists, including the environment fingerprint, and not with the cache folder's path, the stat fingerprint or the comparer's assemblies; the compare key changes with each of its inputs including the contents of a `--tessdata` folder; the comparer's fingerprint covers its native libraries and language data but not debug symbols; a completed capture and compare are reused by a later thread, which runs no command; a changed output, a changed screenshot and a deleted screenshot each make the step run again and say why; `--recapture` runs the step again, records the new run and a later thread reuses it; a changed environment is a different step; steps with status 2 are not recorded; tool status 3, a compare status that does not match its report and a compare status of 3 are setup errors and nothing is recorded; a reuse-only step without a record is a setup error naming the case; a capture fails when the candidate, the capture runner's assemblies, the canonical executable, the canonical support files or the overlay changed since the thread started, and a compare fails when the comparer or the tessdata folder changed; a capture whose coverage lists a second case is a setup error and is not recorded; triage's check rejects a compare report that another run replaced.
- Graph (`graph.test.ts`, fake steps with delays, `MemorySaver`): compare of case *k* starts before capture *k+1* ends and ends after it starts, and triage runs last; the exit status is the highest capture and compare status; a setup error ends the run with 3 and prints the resume command, no later case is captured, and `--resume` continues with the failed case without capturing case 1 again; a finished and an unknown thread cannot be resumed and run no step; `--only capture`, `--only compare` and `--only triage` run their node, reuse the nodes before it and skip the nodes after it, and only `--only capture` builds the candidate; each case prints an execution line apart from a visual line (invalid coverage, contiguity, failures, canonical source, results, compare status, report counts and completeness), and a case that was not compared prints its compare outcome as not run; a setup error in one step of a super-step aborts the signal its sibling step received; an interrupted run (the external signal aborts) ends with 3, prints `Interrupted` and the resume command, and resumes to exit 0.
- Triage and store (`triage.test.ts`, run folders built from the contract examples): the same change in two cases is one cluster and the same hash far away is another; a later thread on a reopened store gets the stored identity for the same change four pixels away, and a new change gets a new `d-<16 hex>` identity; a triage run again in the same thread keeps its identity and still reports it as new; missing, failed and execution-lost captures are listed apart from the clusters; a report that does not match its schema is a setup error; the position rule matches the comparer's (exactly 97 % at the boundary); the canonical source of a case is `live`, `cache` or `mixed`; the store gets, puts, deletes and searches by namespace prefix with limit and offset, and rejects filters and namespace listing.
- Capture runner (`CaptureRunTests`): `--environment-fingerprint-file` needs a value; with it the run writes one SHA-256, exits with 0 and creates no run folder; the fingerprint of equal lines is equal and of different lines differs.
- Contract drift (`contracts/tests/generated-drift.test.ts`): a copy of the generated code passes the check; generated TypeScript with CRLF endings still passes; generated C# with LF endings fails the check, which names the file as stale.

### CI job, run locally

`.github/workflows/ci.yml` has not run on GitHub. Its steps ran locally on this tree, in the job's order, with the results in the table above.

### Line endings and the tool assemblies

`git ls-files --eol` lists the parity C# sources and `contracts/generated/csharp/*.cs` as `i/lf w/crlf attr/text eol=crlf`. `npm run contracts:check` passes on the tree, so the checked-in generated C# has the CRLF endings the generator writes, byte for byte. The tool assemblies built in this checkout are stable across rebuilds: runs L5 and R6 below rebuilt the tools and found every recorded step with the same key, which includes the assemblies' hashes. That the same commit compiles to the same assemblies in two different checkouts was not compared (see below).

## Live evidence

All runs were started from the repository root with `npm.cmd` (or `node` for the Ctrl+C runs, see R3) in PowerShell, with `--settings-overlay out/overlays/fixture-books`. The overlay holds one file, `settings/default.xml`: `bin/settings/default.xml` (UTF-16) with the books `AR`, `AT`, `AU`, `DG`, `GH`, `RC`, `RW`, `SA`, `SDN`, `SG`, `SM`, `TOD`, `UCL`, `UN`, `WA` and `WAR` added to `<books>`, SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`. The candidate was `out/candidate/bin/ChummerGenSR4.exe`, SHA-256 `7fe7750f1ed1c88b2b72a2b0978bf400baa277a9de1a5f026641e32df027f66d`, built by the workflow's build node in every run that does not use `--only`. `PARITY_CANONICAL_CACHE` named a cache folder outside the repository, so the default cache came from the environment. The runs' logs are under `out/logs/` (git-ignored).

### Canonical hash per run

`Get-FileHash -Algorithm SHA256 bin/ChummerGenSR4.exe` printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before the first run and after every run. Each run's capture runners and the candidate build also printed `Canonical SHA-256 before` and `after` with that value, all equal: L1 14 pairs (13 captures and the build), L3 2, L2 first process 2 pairs plus a `before` of the capture that was killed, L2 resumed 1, L4 2, L6 2; R1 first process 2 pairs plus a `before` of the killed capture, R1 resumed 1, R2 2, R3 1 pair (the candidate build) plus the killed capture's `before`. A killed capture cannot print `after`; the hash checked by hand after each such run was unchanged.

## Set 1

### L1: the whole suite with the default cache

`npm.cmd start -- --settings-overlay out/overlays/fixture-books`, thread `wf-20261001T154620Z-1761b105`, 19:46 to 20:26 local time (about 40 minutes), exit 1.

The capture runner's assemblies changed in this change (the environment option), so the cache keys of the entries stored earlier no longer match: every canonical side was a miss and ran live (13 misses, 13 stored, 0 hits, `cachedSides` 0 in every coverage). Both sides of every case ran live in this run.

Execution (from each case's `coverage.json`; none of this is a visual result): coverage valid for all 13 cases and every side's action indexes contiguous (`contiguous` true for all 26 sides); 26 sides, 1448 actions, 0 failures, 0 startup failures; 78 optional tabs absent with 156 actions skipped with them, listed apart from failures; 0 filtered, 0 not run; 211 of 250 planned captures on both sides. Every capture exited with 0 or 1; none exited with 2 or 3.

Visual and compare, per case (the workflow printed these lines for each case at the end of the run):

| Case | Capture | Results passed / failed | Compare | Discrepancies | Completeness planned / reported / optional absent |
|---|---|---|---|---|---|
| build-Diego_v_alpha2_by_bessgeor | 0 | 13 / 0 | clear | 0 | 16 / 13 / 3 |
| career-Шпала - карьера | 1 | 19 / 1 | differences | 1 | 23 / 20 / 3 |
| build-facemage_Sam | 0 | 14 / 0 | clear | 0 | 16 / 14 / 2 |
| career-facemage_Sam_career | 0 | 20 / 0 | clear | 0 | 23 / 20 / 3 |
| build-rigger | 0 | 14 / 0 | clear | 0 | 16 / 14 / 2 |
| career-rigger_career | 0 | 20 / 0 | clear | 0 | 23 / 20 / 3 |
| build-hacker4boegspriet | 0 | 13 / 0 | clear | 0 | 16 / 13 / 3 |
| build-technotest | 0 | 13 / 0 | clear | 0 | 16 / 13 / 3 |
| career-technotest - career | 0 | 19 / 0 | clear | 0 | 23 / 19 / 4 |
| career-test_adept | 0 | 19 / 0 | clear | 0 | 23 / 19 / 4 |
| build-spirit | 0 | 14 / 0 | clear | 0 | 16 / 14 / 2 |
| build-Skull Carver - precareer | 0 | 13 / 0 | clear | 0 | 16 / 13 / 3 |
| career-Skull Carver - career | 0 | 19 / 0 | clear | 0 | 23 / 19 / 4 |

Every report is complete: 0 analysis-failed, 0 filtered, 0 execution-lost, 0 unaccounted. Totals: 211 reported, 1 discrepancy in 1 comparer group.

Triage (`out/workflow/threads/wf-20261001T154620Z-1761b105/triage.json`): 1 discrepancy in 1 cluster, `d-809dbc1c843f2265`, new, member `career-Шпала - карьера/adept-powers#1`; 0 other findings. The comparer's report for that case has 1 group with that one member, so the cluster matches the comparer's grouping. Every case's triage entry has `canonicalSource` `live`.

Pipelining (from file times, run folders `20261001T154624Z-e496d451` to `20261001T162021Z-27f018a7`): in each of the 12 pairs, case *k*'s `compare/report.json` was written within 0.2 s of the creation of case *k+1*'s run folder, and 140 to 208 seconds before case *k+1*'s capture ended. A compare of a clear case takes about a second, so it overlaps only the start of the next capture; the point is that no compare waits for the end of the suite. The last compare finished in the same second as the last capture.

**Finding: a paint race in `career-Шпала - карьера/adept-powers`.** The discrepancy (core 66×12 at 261,79, 444 differing pixels) is in the tab strip: OCR read the canonical strip as `… Martial Arts Spells and Spirits Adept Powers …` and the candidate's as `… Marial Ats Spells and Spirks …`, text that was not completely painted when the capture was taken. Re-running only that case once with `--recapture` (L3) passed with 20 of 20 results, so this is a nondeterministic paint race and not a difference between the executables. Runs: L1 `20261001T154852Z-23d5f14c` (difference), L3 `20261001T162750Z-93b1f9ee` (pass).

### L2: an interrupted run resumed

`npm.cmd start -- --settings-overlay out/overlays/fixture-books --case Diego_v_alpha2_by_bessgeor,spirit --threshold 0.00004`, thread `wf-20261001T162942Z-91c47afa`. The explicit default threshold gives the steps new keys, so both cases are captured again, while the capture runner's cache key does not include the threshold, so the canonical sides hit L1's entries.

- First process: `build-Diego_v_alpha2_by_bessgeor` was captured (run `20261001T162945Z-662cdb61`, canonical side from the cache) and compared (clear). Six seconds after `build-spirit`'s capture started, `taskkill /T /F` ended the whole process tree. The lock file was left behind with the dead process ID 35084, and no Chummer process was left running.
- `npm.cmd start -- --resume wf-20261001T162942Z-91c47afa`, exit 0: it printed `Resuming thread …` and `Taking over the desktop lane from process 35084, which is no longer running.`, did not capture or compare `build-Diego_v_alpha2_by_bessgeor` again (its run folder is still `20261001T162945Z-662cdb61`), and captured `build-spirit` in run `20261001T163113Z-eabad815` with the canonical side from the cache.
- Execution: both cases' coverage valid and contiguous, 0 failures. Visual: both passed (13 of 13 and 14 of 14), both compares clear. Triage: 0 clusters. The lock file was gone afterwards.

### L3: `--recapture` on the case with the difference

`npm.cmd start -- --settings-overlay out/overlays/fixture-books --recapture --case "Шпала - карьера"`, thread `wf-20261001T162747Z-59d511be`, exit 0. The step with the same inputs was recorded by L1, and the run printed `capturing again (--recapture)` and captured it again. The canonical side came from the cache (`1 hits, 0 misses, 0 stored`, entry stored by L1); the candidate ran live. Execution: coverage valid and contiguous, 0 failures. Visual: 20 of 20 passed; compare clear, completeness 23 planned / 20 reported / 3 optional absent; triage 0 clusters. The new run replaced the record of that step, so later threads reuse the passing run.

### L4: waiting for a running owner, then taking over

A hidden process (ID 36292) held the desktop lane: its ID, this host's name and a token were written into `desktop-lane.lock`. `npm.cmd start -- --settings-overlay out/overlays/fixture-books --case spirit --threshold 0.00005`, thread `wf-20261001T163237Z-d5805404`, printed `Waiting for the desktop lane, held by process 36292 on DESKTOP-6J766BQ since 2026-10-01T16:32:36Z` once, and 12 seconds later had not started the capture. After the holder was stopped it printed `Taking over the desktop lane from process 36292, which is no longer running.`, captured `build-spirit` (run `20261001T163256Z-6c7cddef`, canonical side from the cache) and exited 0: coverage valid and contiguous, 14 of 14 passed, compare clear, lock file gone afterwards.

### L5: unchanged inputs in a new thread (no desktop use)

`npm.cmd start -- --settings-overlay out/overlays/fixture-books --only triage`, thread `wf-20261001T163724Z-bae63793`, exit 0 (no discrepancy: the record of the `career-Шпала - карьера` step points to the passing run of L3). The tools were rebuilt by the build node, the environment was read for every case, and all 26 steps (13 captures and 13 compares) were reused, each reported with the thread it came from; no candidate build, capture or compare ran. Triage: 13 cases, 0 clusters, 0 other findings.

### L6: one case with `--live-canonical`

`npm.cmd start -- --settings-overlay out/overlays/fixture-books --case test_adept --live-canonical`, thread `wf-20261001T163418Z-4a72f062`, exit 0. The thread printed `canonical cache off (--live-canonical)`; the summary of run `20261001T163421Z-7f786eba` has no cache block and both sides have source `live`. Execution: coverage valid and contiguous, 0 failures, 8 optional absent. Visual: 19 of 19 passed; compare clear, completeness 23 planned / 19 reported / 4 optional absent. Triage: 0 clusters.

## Set 2: after the later workflow changes

### R1: kill and resume, with the lock refreshed while held

`npm.cmd start -- --settings-overlay out/overlays/fixture-books --case Diego_v_alpha2_by_bessgeor,spirit --threshold 0.00006`, thread `wf-20261001T165837Z-6100dcc6`. While `build-spirit` was captured the lock file's modification time advanced from 16:59:55 to 17:00:15 UTC (25 seconds apart), the owner's refresh. The process tree was then killed with `taskkill /T /F` (abandoned run folder `20261001T165955Z-e6e736aa`, no summary; Diego's run `20261001T165841Z-d331247c` completed). `npm.cmd start -- --resume wf-20261001T165837Z-6100dcc6` printed `Taking over the desktop lane from process 11944, which is no longer running.`, did not capture Diego again, captured `build-spirit` in run `20261001T170030Z-8ef34364` (canonical side from the cache, `1 hits, 0 misses`) and exited 0. Execution: both cases' coverage valid and contiguous, 0 failures. Visual: 13 of 13 and 14 of 14 passed, both compares clear; triage 0 clusters. The lock file was gone afterwards and no Chummer process was left.

### R2: a running owner, then a lock nobody refreshes

A hidden process held the lane (ID 28664, with this host's name in the lock). `npm.cmd start -- --settings-overlay out/overlays/fixture-books --case spirit --threshold 0.00007`, thread `wf-20261001T170153Z-e4c0af08`, printed `Waiting for the desktop lane, held by process 28664 …` once and had not started the capture 8 seconds later. The lock file's modification time was then set three minutes into the past while the holder process kept running, standing in for a process ID reused by another program; the run printed `Taking over the desktop lane from process 28664, which has not refreshed the lock for 182 s (the process ID may belong to another program now).`, captured `build-spirit` (run `20261001T170207Z-fe761471`) and exited 0 with coverage valid, 14 of 14 passed and a clear compare. The holder was still running when the run ended and was stopped by hand.

### R3: Ctrl+C

A real Ctrl+C was sent to the workflow's console with `AttachConsole` and `GenerateConsoleCtrlEvent` from a helper process, because the shell this session runs in starts its children with Ctrl+C ignored. The workflow ran as `node --import tsx workflow/src/main.ts … --case spirit --threshold 0.00010` in a hidden console, started by a launcher that enabled Ctrl+C for it. Thread `wf-20261001T170746Z-0b1f8210`, during the capture of `build-spirit` (run `20261001T170749Z-e7683944`): the run printed `Ctrl+C: stopping the running steps...`, `Interrupted: the running steps were stopped.` and `Thread … stopped; resume it with: npm start -- --resume wf-20261001T170746Z-0b1f8210`, and exited with status 3. The capture runner and the Chummer window were gone and the lock file was released. `npm.cmd start -- --resume wf-20261001T170746Z-0b1f8210` then captured `build-spirit` (run `20261001T170806Z-d56e740c`, canonical side from the cache) and exited 0: coverage valid and contiguous, 14 of 14 passed, compare clear.

Two earlier attempts at this check sent the event to processes that ignored it (the ignore setting is inherited from the shell): the runs of threads `wf-20261001T170339Z-ae4262fa` and `wf-20261001T170504Z-7f727182` simply finished with exit 0 and are not Ctrl+C evidence. A third attempt, with a launcher that itself ended on Ctrl+C and left the workflow writing to a closed pipe, ended the workflow without stopping the apps: the capture runner had received Ctrl+C too and ended first, so the kill of its process tree found nothing and the Chummer window stayed open (stopped by hand afterwards). That led to stopping every process that runs from `out/runs` when a desktop command is aborted, and to treating a closed console (SIGHUP) and Ctrl+Break like Ctrl+C.

### R4: Ctrl+C with the runner ending first, on the final host code

The same arrangement with a launcher that ends on Ctrl+C (and the workflow's output going to a file), `--case spirit --threshold 0.00012`, thread `wf-20261001T171334Z-22c9771b`, run `20261001T171337Z-90de7e41`: one Chummer window before the event and none after; no capture runner, no workflow process; the lock file was gone; the log shows `SIGINT: stopping the running steps...` and `Interrupted: the running steps were stopped.` The launcher ended with the console, so the workflow's exit status was not captured in this run; status 3 was observed in R3.

### R5 and R6: the full workflow without a desktop

`npm.cmd start -- --settings-overlay out/overlays/fixture-books` (no `--only`), thread `wf-20261001T170928Z-66e65893`, exit 0. All 13 capture steps were reused (12 from L1's thread, the `career-Шпала - карьера` step from L3's), and all 13 compare steps ran again, because the comparer's step key now covers its whole output folder; every compare was clear, 0 discrepancies, triage 0 clusters. `npm.cmd start -- --settings-overlay out/overlays/fixture-books --only triage`, thread `wf-20261001T170946Z-e02d1df8` (R6), exit 0: all 26 steps reused, no candidate build, capture or compare ran.

## What remains unverified

- The GitHub Actions job has not run on GitHub; only its commands ran locally.
- A second workflow run holding the desktop lane while capturing was not started; the wait on a running owner and the takeover of a lock nobody refreshes were observed with a stand-in holder process (L4, R2) and are unit-tested.
- An abort of a running capture because a sibling step failed (a compare ending with status 3 next to a running capture) was not observed live; it is unit-tested with fake steps and a real child process. A step that waits for the lane while a sibling fails is unit-tested only.
- A child process that ends from a signal is tested with a fake process; on Windows an external kill is reported as an exit code, so a real signal was not observed.
- Ctrl+C was observed through a console control event sent to a hidden console (R3, R4), not typed in an interactive terminal; other terminal hosts were not tried.
- That one commit compiles to byte-identical tool assemblies in two different checkouts was not compared; only rebuilds in this checkout were (L5, R6).
- A cache hit for every case of the full suite was not shown in one run: L1 stored the entries, and L2 to L4 and R1 to R3 hit three of them. Hits for the other cases are expected from the same keys but were not run.
- Triage on real reports had a single discrepancy, so clustering across cases and identity reuse for shifted cores are shown only by the unit tests.
- A changed screen scale or Windows colour or text setting forcing a new capture is shown by the key tests with a fake environment fingerprint, not by changing the machine's settings.
- The comparer's step key was exercised live only by its change (R5 recompared every case); a replaced OCR library or language file was tested with files in a temporary folder.

## Archive

`npm run openspec:validate` before the archive: `Totals: 5 passed, 0 failed (5 items)`. `npx openspec archive add-workflow-graph -y` printed `+ 1 added` for `development-process`, `+ 1 added` for `parity-contracts`, `+ 7 added` for `parity-workflow` (created), `+ 1 added` and `~ 1 modified` for `visual-parity-capture`, `~ 1 modified` for `visual-parity-compare`, and `Change 'add-workflow-graph' archived as '2026-10-01-add-workflow-graph'.` It counted 7 of 8 tasks because task 4.2 is this archive step; the archived `tasks.md` has every task checked. The new spec's Purpose was the placeholder the archive writes and was replaced with a description of the capability. `npm run openspec:validate` after the archive and the Purpose edit printed `✓ spec/development-process`, `✓ spec/parity-contracts`, `✓ spec/parity-workflow`, `✓ spec/visual-parity-capture`, `✓ spec/visual-parity-compare` and `Totals: 5 passed, 0 failed (5 items)`.

## Remaining risks

- A capture step that ended with visual differences (status 1) is recorded and reused, even when the difference came from a paint race, as `career-Шпала - карьера` shows. `--recapture` collects it again; without it only inputs that change its key do.
- The compare step writes into its capture's run folder, which another thread may share. Triage detects a report that another run replaced (a setup error), but two threads recomparing the same capture with different options still overwrite each other's `compare/` folder.
- Aborting a desktop command stops every process whose executable lives under this checkout's `out/runs`, including apps started by another workflow instance in the same checkout; the desktop lane allows only one capture at a time, so such an instance would be waiting rather than driving an app.
