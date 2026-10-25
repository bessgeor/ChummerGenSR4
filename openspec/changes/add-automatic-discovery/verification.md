# Verification

## Commands and results

### Task 2.1: shared discovery composition

| Command | Result |
| --- | --- |
| `node --import tsx --test workflow/tests/discovery-graph.test.ts` | 20 tests, 20 passed (the discovery graph, run through the shared composition in `tests/discovery-harness.ts`). |
| `node --import tsx --test workflow/tests/discovery-runner.test.ts` | 3 tests, 3 passed: start, resume and read of a finished thread by ID, one test for each. |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test`, run 1 | Failed: 481 tests, 480 passed, 1 failed: `stopping a desktop command also stops the apps started from the run folders, and a cpu command does not` (`workflow/tests/host.test.ts`). The failure output of this run was not kept, so only the test name and counts are recorded. |
| `node --import tsx --test workflow/tests/host.test.ts` | 20 tests, 20 passed, including the test that failed in run 1. |
| `npm run workflow:test`, run 2 | 481 tests, 481 passed. |
| `npm run workflow:test`, run 3 | 481 tests, 481 passed. |
| `npm run workflow:test`, run 4 | 481 tests, 481 passed. |
| `npm run workflow:test`, run 5 | Failed: 481 tests, 480 passed, 1 failed: `the files of an answered request that no workflow collects are removed after the retention` (`workflow/tests/lane-agent.test.ts:356`). Output: `failureType: 'testCodeFailure'`, `error: 'uncollected: failed: The lane agent was not running when this request was sent, or stopped while it ran it.'`, `code: 'ERR_ASSERTION'`, `expected: true`, `actual: false`, `operator: '=='`, duration 304 ms. |
| `node --import tsx --test workflow/tests/lane-agent.test.ts` | 15 tests, 15 passed, including the test that failed in run 5. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |

Runs 1 and 5 each failed one test of a different process-handling test file (`host.test.ts`, `lane-agent.test.ts`). This task touches neither file, and each of those tests passed alone and in the other full runs on the same code. The two failures are recorded as failures that this task does not address; their cause was not investigated.

## Fixture-tested scope

The runner (`composeDiscovery`, `discoveryRunner`, `hostDiscovery`) is tested with the discovery harness's fake jobs and capture runner: starting a new thread (an ID that already has a thread is refused), resuming an unfinished thread without running its finished jobs again (a finished or absent thread is refused), and reading a finished thread's conclusion by ID without running anything (an absent thread is refused). The discovery graph tests run on the same composition as the entry points.

## Live evidence

None for this task: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched. Its SHA-256 at the end of this task is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Unverified

`npm run discover` against a real thread, with real jobs and a live capture run, is not part of this task's evidence.
