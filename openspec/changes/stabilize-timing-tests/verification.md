# Verification

## Commands and results

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `node --import tsx --test --test-name-pattern="a build still running at the deadline" workflow/tests/repair-service.test.ts` | 1 test, passed. |
| `node --import tsx --test --test-name-pattern="stopping a desktop command also stops" workflow/tests/host.test.ts` | 1 test, passed. |
| `node --import tsx --test --test-name-pattern="a change seen after a long gap" workflow/tests/lane-agent.test.ts`, 30 times, six at a time (before the assertion change) | 30 of 30 passed; the failure seen once in a full run was not reproduced. |
| `npm run workflow:test`, runs 1 to 4, one after another, output kept | 485 tests, 485 passed in each run. |
| `npm run openspec:validate` | Passed after the archive. |

## Fixture-tested scope

Only tests changed. The repair deadline test still proves that a hanging build is stopped at the deadline (on real timers) and that a stopped run stays a setup error; the host stop test still proves that a desktop command's stop also stops the apps of its run folders and a cpu command's does not, and that a failing app stop is reported; the retention test still proves that an uncollected answered request's files are removed and logged.

## Live evidence

None needed: no workflow code changes and `bin/ChummerGenSR4.exe` was not run, built or touched.

## Unverified

The cause of the single failure of `a change seen after a long gap between looks does not count as a heartbeat heard now` is unknown: it was not reproduced. If it fails again, its assertion now reports the error the run gave.
