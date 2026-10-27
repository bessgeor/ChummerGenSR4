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

## Task 2.1: tuning graph, freeze and cycle

### Commands and results

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `node --import tsx --test workflow/tests/tuning-graph.test.ts workflow/tests/tuning-auto.test.ts workflow/tests/tuning-cycle.test.ts` | 30 tests, passed. |
| `npm run workflow:test`, output kept (first run, before the review fixes) | 526 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:test`, output kept (after the review fixes) | 529 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:test`, output kept (after the second review round, first run) | 534 tests, 533 passed, **1 failed**: `a run whose samples are all written but whose summary is not is finished when its tuning continues` (the new test): `Expected values to be strictly equal: true !== false` at `tuning-graph.test.ts:330`. The test copied one of the two development samples, so the run still had one sample to run and a tuned job ran on the development cluster. The test was corrected to copy both samples. |
| `npm run workflow:test`, output kept (after the second review round, second run) | 534 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `node --import tsx --test workflow/tests/tuning-graph.test.ts workflow/tests/tuning-auto.test.ts` (first run after the locks moved to lock databases) | **Failed**: `a tune auto while another runs a tuning is a setup error that counts nothing`: `error: 'Missing expected rejection.'` at `tuning-graph.test.ts:352`. The test helper that holds a lock in a child process dropped its database object, which closed it and released the lock; the helper now keeps it. The run did not end in its 400 s time limit and was moved to the background. |
| `node --import tsx --test` of the same two files (second run) | 27 tests, 1 failed: `a due tuning is recorded as in progress with the records it counts, in a file renamed into place`: the folder held `auto.json` and `auto.json.lock` where the test expected only `auto.json`. The test now expects the lock database beside the state. |
| `npm run workflow:test`, output kept (after the fourth review round) | 535 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run eval -- tune auto` on this checkout's empty store | Printed `Automatic tuning: 0 of 12 new hypothesis records; not due.`, exit status 0. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, unchanged; no run launched it. |

### Fixture-tested scope

`workflow/tests/tuning-graph.test.ts` runs `tune auto` over the records of two diagnosed fixture threads, with fake eval runs and tune jobs, and tuning and certificates folders outside the repository. It proves:

- activated: a due tuning records itself, freezes `auto-hypothesis` v1 (seed `auto`, 50 % test, reason `automatic tuning <tuning ID> after <n> new hypothesis records`, one cluster in each partition), runs a cycle with the first metric, `minPass` and `candidates` of the profile, activates the candidate, ends with status 0, moves to `tunings` with outcome `activated` and leaves its thread finished; the next `tune auto` is not due, and a forced one freezes v2;
- no improvement (status 0, nothing activated, no exposure), rejected (status 1, the ledger keeps the exposure) and a failed tune job (status 2);
- stopped while its candidate's development run runs: the thread waits at `propose` in its SQLite checkpoints, and a new `tune auto` with a fresh checkpointer continues it without a tune job, without the baseline's development samples, without another dataset version and without counting a record added meanwhile;
- killed during its holdout run: the thread waits at `holdout`; the resumed run makes no tune job and no development sample, resumes the holdout run under its ID and adds only the test baseline run;
- a freeze stopped after it put its version in place continues on that version, while a version at the recorded folder that another command froze (its reason does not name the tuning) is not run on: the tuning freezes the next version;
- a tuning continued after the profile's `autoTuning` changed keeps the settings it recorded when it started (dataset name, `minPass`, `candidates`, `every`);
- a `tune auto` after a killed one removes the run and state lock files whose owner (host and process ID) is a process of this machine that no longer runs and continues the tuning; the lock of a running process stays and is a setup error naming it;
- the run lock and the state lock are exclusive locks on lock databases that the operating system holds on an open transaction, so a lock ends with the process that held it: a process holding both locks makes 	une auto and a start a setup error, also against the same process, and after that process is killed a 	une auto continues the stopped tuning and finishes it;
- an `auto.json` written before tunings kept their settings is read, and its tuning in progress continues with the profile's settings, which it then records;
- a run whose samples are all written but whose summary is not is resumed, which writes the summary, without running a sample again;
- a second `tune auto` while one runs a tuning is a setup error; `tune cycle --resume` refuses an automatic tuning's cycle;
- `tune cycle` runs as a thread under its cycle ID that neither counts nor freezes, and the cycle tests of `tuning-cycle.test.ts` pass on the graph unchanged;
- the graph compiles from steps that refuse to run, with the nodes `count`, `freeze`, `baseline`, `propose`, `holdout`, `test_baseline`, `activate` and `conclude`;
- a due tuning whose tuning or certificates folder lies inside the repository is a setup error that counts nothing: `tune auto` runs its cycle on the folders in place, outside the repository only.

### Live evidence

None for this task: the cycle's model jobs are faked.

### Unverified

- The tuning's worktree, commit and merge into the branch; until then `tune auto` refuses tuning and certificates folders inside the repository, the default ones included.
- A `tune auto` with real tune and eval jobs.
