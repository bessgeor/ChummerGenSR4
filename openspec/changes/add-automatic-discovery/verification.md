# Verification

## Commands and results

### Task 2.1: shared discovery composition

| Command | Result |
| --- | --- |
| `node --import tsx --test workflow/tests/discovery-graph.test.ts` | 20 tests, 20 passed (the discovery graph, run through the shared composition in `tests/discovery-harness.ts`). |
| `node --import tsx --test workflow/tests/discovery-runner.test.ts` | 3 tests, 3 passed: start, resume and read of a finished thread by ID, one test for each. |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test`, run 1 | 481 tests, 480 passed, 1 failed: `stopping a desktop command also stops the apps started from the run folders, and a cpu command does not` (`workflow/tests/host.test.ts`). The test starts and stops processes and does not touch the discovery code. |
| `node --import tsx --test workflow/tests/host.test.ts` | 20 tests, 20 passed, including the test that failed in run 1. |
| `npm run workflow:test`, run 2 | 481 tests, 481 passed. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |

The failure in run 1 is recorded as an intermittent failure of a process-stopping test that this task does not address; it passed alone and in run 2 without a change.

## Fixture-tested scope

The runner (`composeDiscovery`, `discoveryRunner`, `hostDiscovery`) is tested with the discovery harness's fake jobs and capture runner: starting a new thread (an ID that already has a thread is refused), resuming an unfinished thread without running its finished jobs again (a finished or absent thread is refused), and reading a finished thread's conclusion by ID without running anything (an absent thread is refused). The discovery graph tests run on the same composition as the entry points.

## Live evidence

None for this task: it changes no capture, compare or app behaviour, and `bin/ChummerGenSR4.exe` was not run, built or touched. Its SHA-256 at the end of this task is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Unverified

`npm run discover` against a real thread, with real jobs and a live capture run, is not part of this task's evidence.
