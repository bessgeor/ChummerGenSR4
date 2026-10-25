# Verification

## Commands and results

| Command | Result |
| --- | --- |
| `node --import tsx --test workflow/tests/rename-with-retry.test.ts` | 3 tests, 3 passed: a rename retried after `EPERM`, `EBUSY` and `EACCES` with waits of 50, 100 and 200 ms; `ENOENT` thrown at once; a lock that outlasts three tries thrown after two waits; a real folder rename. |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test`, run 1 | 478 tests, 478 passed. |
| `npm run workflow:test`, run 2 | 478 tests, 478 passed. |
| `npm run workflow:test`, run 3 | 478 tests, 477 passed, 1 failed: `a build still running at the deadline is stopped and rejects the attempt; a stopped run stays a setup error` (repair-service, `false == true`). This test measures a deadline in wall-clock time; it neither renames nor freezes anything and does not touch the changed code. Recorded as an intermittent timing failure that this change does not address. |
| `npm run openspec:validate` | Passed after the archive. |

## Fixture-tested scope

The retry rule (codes, waits, give-up, the error that is thrown) is tested with an injected rename and sleep; the folder rename on disk is tested with a real folder. The three call sites are exercised by the existing dataset, discovery dataset and repair archive tests in the runs above; none of them failed with `EPERM` in these runs, so the runs do not show that the retry was needed, only that nothing else changed.

## Live evidence

None needed: no capture, compare or app behaviour changes, and `bin/ChummerGenSR4.exe` was not run, built or touched.

## Unverified

Whether the retry removes the intermittent `EPERM` on the Windows CI runner is shown only by CI runs over time.
