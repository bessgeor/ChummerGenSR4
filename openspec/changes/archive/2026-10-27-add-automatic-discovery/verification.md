# Verification

## Commands and results

### Task 2.1: shared discovery composition

| Command | Result |
| --- | --- |
| `node --import tsx --test workflow/tests/discovery-graph.test.ts` | 20 tests, 20 passed (the discovery graph, run through the shared composition in `tests/discovery-harness.ts`). |
| `node --import tsx --test workflow/tests/discovery-runner.test.ts` | 3 tests, 3 passed: start, resume and read of a finished thread by ID, one test for each. |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test`, run 1 | Failed: 481 tests, 480 passed, 1 failed: `stopping a desktop command also stops the apps started from the run folders, and a cpu command does not` (`workflow/tests/host.test.ts`). The failure output of this run was not kept and the failure did not recur (see the reruns below), so only the test name and counts are recorded; this row is a failure without output. |
| `node --import tsx --test workflow/tests/host.test.ts` | 20 tests, 20 passed, including the test that failed in run 1. |
| `npm run workflow:test`, run 2 | 481 tests, 481 passed. |
| `npm run workflow:test`, run 3 | 481 tests, 481 passed. |
| `npm run workflow:test`, run 4 | 481 tests, 481 passed. |
| `npm run workflow:test`, run 5 | Failed: 481 tests, 480 passed, 1 failed: `the files of an answered request that no workflow collects are removed after the retention` (`workflow/tests/lane-agent.test.ts:356`). Output: `failureType: 'testCodeFailure'`, `error: 'uncollected: failed: The lane agent was not running when this request was sent, or stopped while it ran it.'`, `code: 'ERR_ASSERTION'`, `expected: true`, `actual: false`, `operator: '=='`, duration 304 ms. |
| `node --import tsx --test workflow/tests/lane-agent.test.ts` | 15 tests, 15 passed, including the test that failed in run 5. |
| `host.test.ts` rerun, 15 times in a row | 15 of 15 passed. |
| `host.test.ts` rerun, 20 times while three full `npm run workflow:test` runs ran at the same time | 20 of 20 passed. The three full runs, started together on the same worktree, each failed `a build still running at the deadline is stopped and rejects the attempt; a stopped run stays a setup error` (`workflow/tests/repair-service.test.ts:149`, `error: 'false == true'`, `expected: true`, `actual: false`, 235 s), and one also failed `a next attempt refused at the run budget keeps the rejection it followed`. These are load-induced timing failures of tests that measure wall-clock deadlines; they are not evidence about the discovery code. |
| `npm run workflow:test`, four more runs, one at a time | 481 tests, 481 passed in each. |
| `npm run workflow:test`, six more runs, one at a time, output kept: run A | Failed: 481 tests, 480 passed, 1 failed: `a change seen after a long gap between looks does not count as a heartbeat heard now` (`workflow/tests/lane-agent.test.ts`, 2259 ms). Output: `failureType: 'testCodeFailure'`, `code: 'ERR_ASSERTION'`, `expected: true`, `actual: false`, `operator: '=='`, `error: The expression evaluated to a falsy value: error.message.includes(\`npm run lane-agent -- --folder "${setup.laneFolder}"\`)`. |
| `npm run workflow:test`, runs B to F of those six | 481 tests, 481 passed in each. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |

Across 15 full runs on this code, three each failed one test, and each time a different one: run 1 (`host.test.ts`; its output was not kept and the failure was not reproduced in 35 isolated reruns), run 5 and run A (both `lane-agent.test.ts`; output recorded above). This task touches none of these files, and each of those tests passed alone or in the other full runs. The failures are recorded as failures that this task does not address; their cause was not investigated. No output exists for run 1 and none is claimed.

### Task 3.1: discovery in the graph

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `node --import tsx --test workflow/tests/graph.test.ts workflow/tests/thread-discovery.test.ts workflow/tests/options.test.ts workflow/tests/discovery-graph.test.ts workflow/tests/discovery-runner.test.ts` | 68 tests, 68 passed. |
| `npm run workflow:test`, run 1 (before the review fixes) | 503 tests, 503 passed. |
| `npm run workflow:test`, run 2 (the branch's code) | 503 tests, 503 passed. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |

The graph tests for this task, in `workflow/tests/graph.test.ts`, run the workflow graph with a fake discovery runner (`workflow/tests/thread-discovery-fixtures.ts`) behind the runner adapter `npm start` uses, and with options resolved as `npm start` resolves them:

- a clean scope discovers: discovery thread `disc-<thread>` starts with the thread as its baseline, `parity/cases/characters.json` as its fixture case file and the profile's targets, the thread records its exit status, admitted and differing scenarios and `discovery.json`, and concludes without diagnosis;
- a scope with a cluster, another finding, a compare with status 1 or a capture with status 2 is diagnosed and does not discover;
- `--no-discovery`, `--no-diagnosis`, `--only triage`, `--only diagnose` and `--case-file parity/cases/discovered.json` do not discover;
- a thread stopped inside its discovery is resumed: the same discovery thread is resumed, nothing is captured again and no second discovery thread starts;
- a discovery setup error ends the run with 3 before the conclusion, and the resumed thread runs its discovery;
- `discovers` is false for a thread whose options have no discovery settings or whose inventory did not run.

`workflow/tests/thread-discovery.test.ts` covers the discovery thread's options, the read of a finished discovery thread without running it, and an unreadable `discovery.json` (setup error). `workflow/tests/options.test.ts` and `workflow/tests/tuning-dispatch.test.ts` cover `--no-discovery`, the profile's `discovery.targets`, the stored rank and scenario configurations and the rank and scenario certificates an unattended thread that may discover needs.

The workflow state records the discovery as `threadDiscovery`: LangGraph refuses a state field with the name of a node, and the stage is `discovery`.

### Task 4.1: status, outcome and report

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `node --import tsx --test workflow/tests/graph.test.ts workflow/tests/loop-service.test.ts workflow/tests/thread-discovery.test.ts workflow/tests/discovery-runner.test.ts` | 38 tests, 38 passed. |
| `npm run workflow:test`, run 1 (before the review fixes) | 507 tests, 507 passed. |
| `npm run workflow:test`, run 2 (the branch's code) | 508 tests, 508 passed. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |

The tests run the workflow graph with the fake discovery runner, as for task 3.1:

- `workflow/tests/graph.test.ts`: a clean scope whose discovery concludes with status 0, 1 or 2 makes `npm start` exit with 0, 1 or 2; the end-of-run report prints, in this order, the triage line, the inventory line, `Discovery: disc-<thread> exit <status>; <n> admitted (<cases>), <m> differing (<cases>); <discovery.json>`, the outcome line and the exit status; the conclusion gets the thread's discovery and the outcome stays `verified_for_scope`. A thread that does not discover prints no `Discovery:` report line and concludes with discovery null. `exitStatus` takes the highest of the capture, compare and discovery statuses (a capture or compare status 2 stays above a discovery status 1).
- `workflow/tests/loop-service.test.ts`: `outcome.json` holds the discovery (thread, exit status, admitted and differing scenarios, `discovery.json`) and the outcome `verified_for_scope` when an admitted scenario differs; without discovery it holds `discovery: null`.
- `workflow/tests/thread-discovery.test.ts`: a discovery conclusion with an exit status other than 0, 1 or 2 is a setup error.

The discovery thread's own report, relayed while the stage runs, ends with a summary line that also starts with `Discovery:`; the end-of-run report's `Discovery:` line is the one after the inventory line.

### Task 5.1: docs

`AGENTS.md` (Parity workflow, Interaction discovery, Loop, Evaluation, Tuning) and `README.md` describe the default suite, the `discovery` stage, `--no-discovery`, the profile's `discovery.targets`, the discovery's place in the exit status, the `Discovery:` report line and `outcome.json`, and the rank and scenario configurations and certificates of a thread that may discover.

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test`, run 1 (before the wording fix in `AGENTS.md`) | 508 tests, 508 passed. |
| `npm run workflow:test`, run 2 (the branch's docs) | 508 tests, 508 passed. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |
| `(Get-FileHash bin/ChummerGenSR4.exe -Algorithm SHA256).Hash` | `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56`, the canonical hash. |

### Task 6.1: live runs

Setup for every run: a local profile (`PARITY_WORKFLOW_PROFILE`) with `settingsOverlay` set to an overlay under `out/` holding `settings/default.xml` with the sixteen fixture books, `discovery.targets` 2 and the Claude Code CLI named in `agents.executables.claude`; the default agent choice (the rank and scenario jobs on Claude); the shared canonical capture cache from `PARITY_CANONICAL_CACHE`. Before the first run `parity/discovery/registry.json` and `parity/cases/discovered.json` did not exist.

| Command | Result |
| --- | --- |
| `(Get-FileHash bin/ChummerGenSR4.exe -Algorithm SHA256).Hash`, before the runs | `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` |
| Run 1: `npm.cmd start -- --case "build-Diego_v_alpha2_by_bessgeor,career-facemage_Sam_career" --capture common`, thread `wf-20261026T192630Z-d64c44e5` | Failed and not finished. Capture run `20261026T192648Z-5551f098` of `build-Diego_v_alpha2_by_bessgeor` had status 2 and invalid coverage: `candidate: FAILED after 34.0 s: action 1 (selectTab:Skills): TimeoutException: Tab 'Skills' was not selected within 5 s. MSAA state=3145728, native current index=0, expected index=1, control=200018, foreground=920882` (`Performed=1, Failed=1, NotRun=44`); its canonical side came from the cache; its compare had status 0 (completeness: 16 planned, 1 reported, 15 execution lost). The session running the thread ended while the capture of `career-facemage_Sam_career` (run `20261026T192725Z-f4b24a94`) was in progress, so the thread has no outcome; it was not resumed. |
| Run 2: the same command, new thread `wf-20261027T123423Z-fe2aa4f4` (the rerun that classifies run 1's failure) | Exit 0, `Outcome: verified_for_scope`, elapsed 14.5 min. See below. |
| Run 3: `npm.cmd start -- --case "build-facemage_Sam@skillcontrol-ef9d2872,career-facemage_Sam_career@frmcareer-tabcharactertabs-selection-455ce0c2" --no-discovery` (no `--case-file`), thread `wf-20261027T124938Z-4e9162ce` | Exit 0, `Outcome: verified_for_scope`, elapsed 2.3 min. See below. |
| `(Get-FileHash bin/ChummerGenSR4.exe -Algorithm SHA256).Hash`, after the runs | `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56` |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test` (with the registry and its case file committed) | 508 tests, 508 passed. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |

Every capture run and the candidate build printed `Canonical SHA-256 before` and `after` as `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, and every staged canonical copy had the same hash.

Run 1's failure passed in run 2 on the same candidate (SHA-256 `ee9f3f4bd9fe9dadc32b6dedeaab8f6596c8dac888e5a425e977249bc82389b3`), canonical cache entry and actions; it is recorded as a nondeterministic execution failure of the candidate's tab selection, whose cause was not investigated.

#### Run 2: a clean scope that discovers

Execution, per planned case:

- `build-Diego_v_alpha2_by_bessgeor`: capture run `20261027T123437Z-7fc1d4bb`, status 0, coverage valid (0 failures, 6 optional absent); canonical side from the cache (entry `c2ed9b23…` stored by run `20261026T150528Z-3cd75381`), candidate side ran.
- `career-facemage_Sam_career`: capture run `20261027T123608Z-494acbef`, status 0, coverage valid (0 failures, 6 optional absent); canonical side from the cache (entry `cb88dca8…` stored by run `20261026T150713Z-04c6733e`), candidate side ran.

Visual, per planned case: `common` passed in both (0 within the threshold); both compares had status 0 (clear, 0 discrepancies), completeness complete (Diego 16 planned, 1 reported, 15 filtered; facemage 23 planned, 1 reported, 22 filtered). `Triage: 0 discrepancies in 0 clusters (0 new), 0 other findings`. `Inventory: 69 classes (10 active), controls observed 240/1419, interactions exercised 0/873, tuples observed 2/2, unresolved 0`.

The thread then discovered: `Discovery thread disc-wf-20261027T123423Z-fe2aa4f4: baseline wf-20261027T123423Z-fe2aa4f4, 2 targets at most.` It found 55 targets (868 bindings out of the actions' reach); one rank job selected `SkillControl/-` and `frmCareer.tabCharacterTabs#selection` (0.85 each) and a scenario job ran for each, all on Claude. Both plans were valid and ran in one capture run:

- Discovery capture run `20261027T124120Z-c196aaa4`: execution status 0, coverage valid, 4 sides, 22 actions, 0 failed, 4 of 4 planned captures on both sides. Both canonical sides ran live (`Canonical capture cache: 0 hits, 2 misses, 2 stored`) and were stored in the cache as `649a114b…` and `b6a597b0…`. Visual: 4 rows, 4 passed (`skills-controls`; `common`, `skills`, `character-info`).
- `Scenario SkillControl/-: proven; case build-facemage_Sam@skillcontrol-ef9d2872; execution executed; visual clear; proved 23 controls and 0 bindings; admitted`.
- `Scenario frmCareer.tabCharacterTabs#selection: proven; case career-facemage_Sam_career@frmcareer-tabcharactertabs-selection-455ce0c2; execution executed; visual clear; proved 65 controls and 1 bindings; admitted` (the binding `frmCareer.tabCharacterTabs.SelectedIndexChanged`).
- `Discovery thread disc-wf-20261027T123423Z-fe2aa4f4 finished: exit 0`; controls observed 240 → 320 of 1419, interactions exercised 0 → 1 of 873, registry 0 → 2 entries.

The end-of-run report printed the triage line, the inventory line and then `Discovery: disc-wf-20261027T123423Z-fe2aa4f4 exit 0; 2 admitted (build-facemage_Sam@skillcontrol-ef9d2872, career-facemage_Sam_career@frmcareer-tabcharactertabs-selection-455ce0c2), 0 differing; …/discovery.json`, then `Outcome: verified_for_scope; 0 of 0 clusters fixed` and `Thread wf-20261027T123423Z-fe2aa4f4 finished: exit 0.` No diagnosis ran. `outcome.json` holds `discovery` with that thread ID, exit status 0, the two admitted cases, no differing case and the `discovery.json` path.

Discovery wrote `parity/discovery/registry.json` and `parity/cases/discovered.json` into the working tree. Both were reviewed (the two entries use the existing fixtures `facemage_Sam.chum` and `facemage_Sam_career.chum`, only `selectTab`, `waitFor`, `wait` and `capture` actions) and are committed together on this branch.

#### Run 3: the default suite captures the admitted scenarios

Without `--case-file` the thread wrote its suite `out/workflow/threads/wf-20261027T124938Z-4e9162ce/suite-cases.json`: the 13 characters of `parity/cases/characters.json` followed by the 2 scenarios of `parity/cases/discovered.json`, with fixture paths relative to the suite. `--case` planned the two scenarios.

Execution:

- `build-facemage_Sam@skillcontrol-ef9d2872`: capture run `20261027T124943Z-08f4bff7`, status 0, coverage valid (0 failures, 1 of 1 planned captures on both sides); canonical side from the cache (entry `649a114b…` stored by run 2's discovery capture run `20261027T124120Z-c196aaa4`), candidate side ran.
- `career-facemage_Sam_career@frmcareer-tabcharactertabs-selection-455ce0c2`: capture run `20261027T125044Z-deba5953`, status 0, coverage valid (0 failures, 3 of 3 planned captures on both sides); canonical side from the cache (entry `b6a597b0…` stored by the same discovery capture run), candidate side ran.

Visual: `skills-controls` passed; `common`, `skills` and `character-info` passed; both compares had status 0 (clear, 0 discrepancies), completeness complete (1 and 3 planned and reported). `Triage: 0 discrepancies in 0 clusters (0 new), 0 other findings`. `Inventory: 69 classes (10 active), controls observed 258/1419, interactions exercised 1/873, tuples observed 4/4, unresolved 2` (the unresolved automation IDs `cmdChangeSpec` and `cmdImproveSkill` in the `skills` capture of the career scenario). With `--no-discovery` on this clean scope no discovery thread started (`out/discovery/threads/disc-wf-20261027T124938Z-4e9162ce` does not exist), the report printed no `Discovery:` line, `outcome.json` holds `discovery: null`, and the thread exited 0.

### Task 6.2: archive

| Command | Result |
| --- | --- |
| `npx openspec archive add-automatic-discovery --yes` | Archived as `2026-10-27-add-automatic-discovery`; specs updated: `interaction-discovery` + 1 requirement, `parity-workflow` + 2, `self-fixing-loop` + 1 (totals + 4, ~ 0, - 0, → 0). |
| `npm run openspec:validate`, after the archive | Passed: 22 passed, 0 failed. |
| `npm run workflow:typecheck`, run 1 | Failed before the dependencies were installed in the checkout: `error TS2688: Cannot find type definition file for 'node'.` |
| `npm run workflow:test`, run 1 | Failed before the dependencies were installed in the checkout: 58 tests (one per test file), 0 passed, 58 failed, each with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from <checkout>`, for example `not ok 1 - workflow\\tests\\agents.test.ts` with `error: 'test failed'`. |
| `npm ci` | Installed the dependencies. |
| `npm run workflow:typecheck`, run 2 | Passed. |
| `npm run workflow:test`, run 2 | 517 tests, 517 passed. |
| `(Get-FileHash bin/ChummerGenSR4.exe -Algorithm SHA256).Hash` | `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56`, the canonical hash. |

## Fixture-tested scope

The runner (`composeDiscovery`, `discoveryRunner`, `hostDiscovery`) is tested with the discovery harness's fake jobs and capture runner: starting a new thread (an ID that already has a thread is refused), resuming an unfinished thread without running its finished jobs again (a finished or absent thread is refused), and reading a finished thread's conclusion by ID without running anything (an absent thread is refused). The discovery graph tests run on the same composition as the entry points.

The suite's setup errors (a registry without its case file or the other way round, a case file that is not the registry's rendering, differing timings, a duplicate case name), a resumed thread that resumes its discovery, a discovery setup error, the discovery's exit statuses 1 and 2 and an admitted scenario that differs are tested with fixtures only (tasks 1.1, 3.1 and 4.1).

## Live evidence

Task 6.1: runs 2 and 3 above. In run 2 the canonical sides of the two planned cases came from the cache and the two canonical sides of the discovery capture ran live; in run 3 both canonical sides came from the cache entries run 2's discovery capture stored. Every candidate side ran live. Run 1 ended with an execution failure and without an outcome (recorded above).

None for task 6.2: it moves this change into the archive and applies its spec deltas, and `bin/ChummerGenSR4.exe` was not run, built or touched.

None for task 5.1: it changes only `AGENTS.md`, `README.md` and this change's files, and `bin/ChummerGenSR4.exe` was not run, built or touched; its SHA-256 at the end of task 5.1 is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

None for task 4.1: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched; its SHA-256 at the end of task 4.1 is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

None for task 3.1: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched; its SHA-256 at the end of task 3.1 is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

None for task 2.1: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched. Its SHA-256 at the end of this task is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Unverified

Not shown by a live run in task 6.1: a discovery that admits a scenario that differs (exit status 1) or ends with status 2; a thread resumed inside its discovery; a discovery setup error ending a thread; a scenario rejected by validation or without proof; `--unattended` with rank and scenario certificates; a default run that captures the whole suite (run 3 planned only the two scenarios with `--case`); a discovery with Codex jobs. These are covered by the fixture tests named above only. Run 1's tab selection timeout is classified as nondeterministic by a single rerun; its cause is not known.

The rows below were written by the earlier tasks, before task 6.1's live runs.

`npm run discover` against a real thread, with real jobs and a live capture run, is not part of this task's evidence.

A workflow thread that discovers through the real discovery runner, real jobs and a live capture run is not part of task 3.1's evidence. In task 3.1 the workflow's exit status and `outcome.json` do not include the discovery.

The exit status, `outcome.json` and the `Discovery:` report line of task 4.1 are tested with the fake discovery runner only; no thread has discovered through the real runner and a live capture run.
