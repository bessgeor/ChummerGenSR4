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

## Fixture-tested scope

The runner (`composeDiscovery`, `discoveryRunner`, `hostDiscovery`) is tested with the discovery harness's fake jobs and capture runner: starting a new thread (an ID that already has a thread is refused), resuming an unfinished thread without running its finished jobs again (a finished or absent thread is refused), and reading a finished thread's conclusion by ID without running anything (an absent thread is refused). The discovery graph tests run on the same composition as the entry points.

## Live evidence

None for this task: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched. Its SHA-256 at the end of this task is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Unverified

`npm run discover` against a real thread, with real jobs and a live capture run, is not part of this task's evidence.
