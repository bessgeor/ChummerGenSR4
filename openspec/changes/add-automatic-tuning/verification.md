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
| `npm run workflow:test`, output kept (after the fifth review round, first run) | 537 tests, 535 passed, **2 failed**, both in `tuning-auto.test.ts`: `a due tuning is recorded as in progress before its freeze; with nothing to freeze it is a setup error and the tuning stays in progress` and `records added during a tuning are not counted by it, nothing is counted while it is in progress, and they count toward the next one`. Each failed a deep-equal on the tuning's recorded `dataset`: the tests expected the folder of `v1`, actual `null`. A freeze now records the version it chose once it chose one, so a freeze with nothing to freeze records none; the tests were corrected to expect `null`. |
| `npm run workflow:test`, output kept (after the fifth review round, second run) | 537 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:test`, output kept (after the polish round) | 538 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run eval -- tune auto` on this checkout's empty store | Printed `Automatic tuning: 0 of 12 new hypothesis records; not due.`, exit status 0. |
| `npm run openspec:validate` | Passed: 23 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, unchanged; no run launched it. |

### Fixture-tested scope

`workflow/tests/tuning-graph.test.ts` runs `tune auto` over the records of two diagnosed fixture threads, with fake eval runs and tune jobs, and tuning and certificates folders outside the repository. It proves:

- activated: a due tuning records itself, freezes `auto-hypothesis` v1 (seed `auto`, 50 % test, reason `automatic tuning <tuning ID> after <n> new hypothesis records`, one cluster in each partition), runs a cycle with the first metric, `minPass` and `candidates` of the profile, activates the candidate, ends with status 0, moves to `tunings` with outcome `activated` and leaves its thread finished; the next `tune auto` is not due, and a forced one freezes v2;
- no improvement (status 0, nothing activated, no exposure), rejected (status 1, the ledger keeps the exposure) and a failed tune job (status 2);
- stopped while its candidate's development run runs: the thread waits at `propose` in its SQLite checkpoints, and a new `tune auto` with a fresh checkpointer continues it without a tune job, without the baseline's development samples, without another dataset version and without counting a record added meanwhile;
- stopped (by an abort signal, in process) during its holdout run: the thread waits at `holdout`; the resumed run makes no tune job and no development sample, resumes the holdout run under its ID and adds only the test baseline run;
- a freeze stopped after it put its version in place continues on that version, while a version at the recorded folder that another command froze (its reason does not name the tuning) is not run on: the tuning freezes the next version;
- a tuning continued after the profile's `autoTuning` changed keeps the settings it recorded when it started (dataset name, `minPass`, `candidates`, `every`);
- the run lock and the state lock are exclusive locks that the operating system holds on an open transaction of a lock database, so a lock ends with the process that held it and nothing names an owner: while a child process holds both, `tune auto` is a setup error naming the run lock and a start is refused, also against the same process; after the child is killed, `tune auto` continues the stopped tuning and finishes it (the test does not check what the lock database files look like afterwards);
- an `auto.json` written before tunings kept their settings is read, and its tuning in progress continues with the profile's settings, which it then records;
- a run whose samples are all written but whose summary is not is resumed, which writes the summary, without running a sample again;
- a second `tune auto` while one runs a tuning is a setup error; `tune cycle --resume` refuses an automatic tuning's cycle, also when the tuning has not yet recorded its cycle in `auto.json`;
- `tune cycle` runs as a thread under its cycle ID that neither counts nor freezes, and the cycle tests of `tuning-cycle.test.ts` pass on the graph unchanged;
- the graph compiles from steps that refuse to run, with the nodes `count`, `freeze`, `baseline`, `propose`, `holdout`, `test_baseline`, `activate` and `conclude`;
- a due tuning whose tuning folder lies inside the repository, and one whose certificates folder lies inside it, are each a setup error that counts nothing: `tune auto` runs its cycle on the folders in place, outside the repository only;
- a tuning whose thread concluded but whose tuning was not yet ended (as after a stop between the two) is ended by the next `tune auto` with its cycle's outcome (here rejected, status 1), without a job, a run or a count, and a tuning ends only after its thread concluded;
- a freeze chooses its version, announces it and puts it in place under an exclusive lock per dataset name, and the tuning records the announced version: a second freeze of the name started while the first holds the version is a setup error and leaves `v1` alone, and the next freeze after the release takes `v2` (`eval-dataset.test.ts`).

### Live evidence

None for this task: the cycle's model jobs are faked.

### Unverified

- The tuning's worktree, commit and merge into the branch. `tune auto` refuses tuning and certificates folders inside the repository, the default ones included.
- A `tune auto` with real tune and eval jobs.

## Task 3.1: worktree and merge

### Commands and results

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts` (first run) | 10 tests, 3 passed, **7 failed**, each with `Error: commit is already being used as a state attribute (a.k.a. a channel), cannot also be used as a node name.` from `StateGraph.addNode` in `buildTuningGraph`. The state channels `commit` and `merge` had the names of the graph's nodes; they are now `tuningCommit` and `mergeCommit`. |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts` (second run) | 10 tests, all passed. |
| `npm run workflow:test`, output kept (first implementation) | 573 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:test`, output kept (the commit and merge nodes reworked so that the commit needs the worktree) | 574 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts workflow/tests/git-integration.test.ts` (after the review fixes, first run) | 20 tests, 10 passed, **10 failed**. Every test that checks the ignore rules failed with `git check-ignore --no-index -z -- workflow/evals/tuning/holdout.json … failed: fatal: -z only makes sense with --stdin`, and the tests that expected a setup error reported `Caught error:`. The files are now given on standard input. |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts` (second run) | 12 tests, 7 passed, **5 failed**: the activation, rejected, conflict, stopped-holdout and only-tuning-folder tests. For example, the rejected test failed with `fatal: ambiguous argument 'null': unknown revision`, because the recorded commit was `null`, and the conflict test with `Missing expected rejection.` In the linked worktree, `git add --all -- <folders> ':(exclude,glob)**/*.tmp'` left the tuning folder untracked (`?? workflow/evals/tuning/` after the add), so nothing was committed. Staging now adds the folders and then removes staged `.tmp` files from the index. |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts` (third run) | 12 tests, all passed; with the merge test added, 13 tests, all passed. |
| `npm run workflow:test`, output kept (after the review fixes) | 576 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts` (after the commit check was tightened) | 14 tests, all passed. |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (after the commit check was tightened) | Typecheck passed; 577 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts workflow/tests/git-integration.test.ts` (after a tuning commit the branch has already gets a merge commit) | 22 tests, all passed. |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (after a tuning commit the branch has already gets a merge commit) | Typecheck passed; 577 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `git rebase master` | Conflicts in `workflow/src/git/integration.ts` (master now has its own `userSettings` option and its own merge commit for a change the branch has already). Resolved by keeping master's versions; the branch adds only the restoring of the item's branch and the trailer check of the merge commit. `processCheckoutGit` and the `checkoutGit` fields were removed in favour of `userSettings`. |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (after the rebase, the guard of the tuning commands, the narrow worktree and the review fixes) | Typecheck passed; 593 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `node --import tsx --test workflow/tests/tuning-worktree.test.ts` (ledger guard under the lock, first run of the new race test) | 20 tests, 19 passed, **1 failed**: `a cycle run by hand that reaches its holdout after an automatic tuning took the tuning files into its worktree is stopped before it writes the ledger` with `Missing expected rejection.` The test's agents were right on every cluster for the code's prompt too, so the cycle ended `no_improvement` before its holdout. The test now uses agents wrong for the code's prompt and right for the candidate. |
| The same test with the guard call in `openHoldout` removed | Fails; with the guard in place it passes (the test detects the guard). |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (after the guard moved under the ledger's lock) | Typecheck passed; 595 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:test`, output kept (after `certify` took the guard, the repository itself was refused as a folder and the replay's branch reset became a compare-and-swap, first run) | 596 tests, 594 passed, **2 failed**: `the owner refreshes the lock while it holds the lane` (`host.test.ts:232`, `equal(JSON.parse(readFileSync(path, "utf8")).processId, 1000)` falsy; a timing test of the lane lock, untouched by this change) and `the tuning commands that change the tuning files in the checkout wait while an automatic tuning works on them in its worktree` (`certify --run r --metric prediction --min-pass 0.5`: the test ran `certify` as `tune certify`, an unknown subcommand). The test now runs `certify` on its own. The lock test passed alone with `tuning-worktree.test.ts` (41 tests, all passed). |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (second run) | Typecheck passed; 596 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (after links to folders inside the repository were followed) | Typecheck passed; 645 tests, all passed (0 failed, 0 cancelled, 0 skipped). The new link test fails with the links not followed. |
| `npm run openspec:validate` | Passed: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, unchanged; no run launched it. |

### Fixture-tested scope

`workflow/tests/tuning-worktree.test.ts` runs `tune auto` with fake eval runs and tune jobs over the records of two diagnosed fixture threads, on a temporary git repository on `main` that ignores `/out/` and holds `workflow/evals/certificates/`. It proves:

- merged activation: with the tuning and certificates folders inside the repository, the cycle works in a worktree on `tuning/<cycle>`. While the holdout runs, the ledger is in the worktree and not in the checkout. `main` moves on in another file meanwhile, and a temporary file is left in the worktree. When the cycle ends, `Tune hypothesis: activated` (with `Tuning-Cycle: <cycle>`) holds exactly the active file, the ledger and the certificate; it is rebased onto the moved tip, kept on `tuning/<cycle>` and merged with `Merge tuning/<cycle>: hypothesis activated`, which carries `Merged-Tuning: <cycle>` and `Tuning: <tuning ID>`. The checkout was fast-forwarded and holds the three files, with nothing uncommitted. The worktrees are removed, and `auto.json` records the branch, the commit and the merge. A repeated merge finds the trailer and leaves the branch where it is;
- a refused activation (`rejected`, status 1) commits and merges the ledger's exposure;
- a cycle that changes nothing (`no_improvement`) commits and merges nothing, and its worktree is removed;
- uncommitted tuning files: a modified tracked `holdout.json`, and an untracked file in the certificates folder, are each a setup error naming the file. Nothing is counted, no job runs and no branch is made;
- a detached `HEAD` is a setup error that counts nothing, and so are a tuning folder whose files git ignores and a tuning folder that is the repository itself;
- a merge conflict with a resume: `main` gets a ledger of its own during the cycle, and `tune auto` ends with a setup error naming `tuning/<cycle>` and `holdout.json`. The tuning stays in progress at its `merge` node, and running it again gives the same error. After a person rebases `tuning/<cycle>` onto `main` and keeps the tuning's ledger, `tune auto` merges without a job and ends `activated`;
- a tuning stopped during its holdout run resumes in its worktree and merges; one whose worktree was removed meanwhile is a setup error, and the tuning stays in progress;
- a checkout made with `core.autocrlf=true`, whose committed ledger is CRLF in the working tree and whose time is newer than the index's, is not reported as changed. After the fast-forward its ledger is CRLF, with nothing uncommitted. The test was not run against the code before the fix;
- a tuning commit whose changes the branch has already: the rebase drops it as empty, and the merge still gets a merge commit with the branch's tree, the tuning's own commit as its second parent and `Merged-Tuning: <cycle>`. `tuning/<cycle>` keeps that commit, `main` is advanced to the merge commit, and asking for the merge again finds the trailer and changes nothing;
- a `prepare-commit-msg` hook that strips the `Tuning-Cycle` trailer from the commit message: `commit` ends with a setup error naming the branch and the trailer, `main` does not move and the files stay on `tuning/<cycle>`; the cycle is never reported finished without its merge;
- a `prepare-commit-msg` hook that strips `Merged-Tuning` from the merge commit: `merge` ends with a setup error naming the trailer and the branch does not move;
- `tune holdout`, `tune activate`, `tune rollback`, `tune cycle` (also with `--resume`) and `certify` end with a setup error naming the tuning and its branch while an automatic tuning has its worktree and has not merged; after it merged, `tune rollback` runs. The check is made again holding the checkout ledger's lock, where the holdout, the activation and the rollback read and write, and the tuning adds its worktree and records its branch holding the same lock. A `tune cycle` that passed its start check and reaches its holdout after the tuning added its worktree ends with a setup error naming the tuning and its branch, and the checkout's ledger is not written and its lock released (the tuning was started by writing the state the worktree step writes, in the middle of the cycle's proposal run); `activate` and `rollback` run their guard holding the lock and release it when it refuses. A ledger a command wrote before the tuning added its worktree is uncommitted and refused when the tuning adds it;
- the cycle's worktree holds only the tuning and certificates folders (not `README.md` or `.gitignore`), and its commit changes nothing else;
- a staged rename in the tuning folder is reported with the full paths of both files, and tracked tuning files that an ignore pattern matches are not refused.
- folders that lie outside the repository by name but are junctions (symbolic links elsewhere) to its tracked tuning and certificates folders are inside: the tuning works in a worktree and merges its files, and the checkout ends clean. With the links not followed the test fails;
- external folders: with both folders outside the repository, the cycle uses them in place. No branch is made, `main` does not move and the checkout stays clean. With only the tuning folder inside, the certificate is written in place and only the tuning files are merged;
- the graph has the nodes `worktree`, `commit` and `merge` beside the earlier ones (`tuning-graph.test.ts`), and the tests of `tuning-graph.test.ts` pass with folders outside the repository.

### Live evidence

None for this task: the cycle's model jobs are faked, and the repository is a temporary one.

### Unverified

- A `tune auto` with real tune and eval jobs, and its merge into this repository's branch.

## Task 4.1: docs

`AGENTS.md` lists `autoTuning` among the profile's settings. Its Tuning section describes `tune auto`: the trigger, the freeze, the cycle as a tuning graph thread, the resumption, the worktree with its commit and merge, the setup errors with what to do about each, and the commands it holds back. `README.md` describes `tune auto` in its summary of tuning, and says the merge commit is made only when the cycle changed the tuning or certificate files.

### Commands and results

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed. |
| `npm run workflow:test`, output kept (first run, before the review fixes to the text) | 645 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:typecheck` and `npm run workflow:test`, output kept (after the review fixes to the text) | Typecheck passed; 645 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run workflow:test`, output kept (after the README correction on the merge) | Failed: 645 tests, 644 passed, 1 failed. `not ok 349 - a next attempt refused at the run budget keeps the rejection it followed` (`workflow/tests/loop-graph.test.ts:197`): `Expected values to be strictly equal: 1 !== 2` (expected 2, actual 1, `ERR_ASSERTION`), after 24.7 s. The task changes no code. |
| `node --import tsx --test workflow/tests/loop-graph.test.ts` (same tree, alone) | 15 tests, all passed. |
| `npm run workflow:test`, output kept (same tree, run again) | 645 tests, all passed (0 failed, 0 cancelled, 0 skipped). |
| `npm run openspec:validate` | Passed: 20 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`, unchanged; no run launched it. |

### Live evidence

None for this task: it changes only documentation.

### Unverified

- A `tune auto` with real tune and eval jobs, and its merge into this repository's branch.
