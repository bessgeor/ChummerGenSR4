# Verification

## Task 1.1: trigger and state

### Commands and results

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `node --import tsx --test workflow/tests/tuning-auto.test.ts` | 9 tests, passed. |
| `npm run workflow:test`, output kept | 517 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` after the runs | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, unchanged. |

### Fixture-tested scope

`workflow/tests/tuning-auto.test.ts` runs `tune auto` over a store of fixture hypothesis records and proves:

- not due: the count and the threshold are printed, the exit status is 0, and nothing is written (the state's folder is not even created);
- only succeeded workflow hypothesis records count: failed records, eval-run records and other job kinds do not;
- due: `tune auto` records the tuning as in progress in `auto.json`, written by renaming a temporary file, with the tuning ID, the records it counted (also marked counted) and no dataset or cycle yet, then ends with the setup error status 3 because it freezes no dataset and runs no cycle, so it has not tuned; a second call finds the tuning in progress and changes nothing;
- `--force`: a tuning is due whatever the count and is recorded as forced, and an unknown option is refused and writes nothing;
- records added during a tuning are not counted by it, nothing is counted while it is in progress, and they count toward the next tuning once it has ended;
- every hypothesis record is counted from one search of the store, over more records than a page holds, on the in-memory and the SQLite store;
- the start is made under an exclusive lock file: a held lock refuses the start and writes nothing, the lock is released afterwards, and a second start from the same trigger, or one whose records another tuning has counted since, is refused;
- an invalid `autoTuning` in the profile (`every` zero, fractional or a string, a malformed dataset name, `minPass` above 1, `candidates` 0 or 4, an unknown key) is a setup error naming the profile, and `tune auto` counts nothing.

### Live evidence

None needed for this task: no model job runs.

### Unverified

- Freezing the automatic dataset and running the cycle from `tune auto`, and resuming a tuning in progress.
- The tuning's worktree, commit and merge into the branch.
- A `tune auto` with real tune and eval jobs.
