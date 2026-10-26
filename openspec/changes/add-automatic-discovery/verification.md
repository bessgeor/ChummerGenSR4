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

## Fixture-tested scope

The runner (`composeDiscovery`, `discoveryRunner`, `hostDiscovery`) is tested with the discovery harness's fake jobs and capture runner: starting a new thread (an ID that already has a thread is refused), resuming an unfinished thread without running its finished jobs again (a finished or absent thread is refused), and reading a finished thread's conclusion by ID without running anything (an absent thread is refused). The discovery graph tests run on the same composition as the entry points.

## Live evidence

None for task 4.1: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched; its SHA-256 at the end of task 4.1 is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

None for task 3.1: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched; its SHA-256 at the end of task 3.1 is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

None for task 2.1: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched. Its SHA-256 at the end of this task is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Unverified

`npm run discover` against a real thread, with real jobs and a live capture run, is not part of this task's evidence.

A workflow thread that discovers through the real discovery runner, real jobs and a live capture run is not part of task 3.1's evidence. In task 3.1 the workflow's exit status and `outcome.json` do not include the discovery.

The exit status, `outcome.json` and the `Discovery:` report line of task 4.1 are tested with the fake discovery runner only; no thread has discovered through the real runner and a live capture run.
