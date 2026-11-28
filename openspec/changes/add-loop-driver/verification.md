# Verification

## Task 1.1: shared composition

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Failed: 580 tests, 579 passed, 1 failed (exit 1). `not ok 304 - stopping the run cancels the request: the agent kills it and stops the apps started from the working folder` (`lane-agent.test.ts:107`): `Expected values to be strictly deep-equal: + actual - expected + [] - [ '<temp>\\workflow-agent-7pUGxv\\repository\\out\\runs' ]`. The test is in a file this task does not touch (the lane agent's handling of a stopped request, timed by an abort 300 ms after the request starts). |
| `npm run workflow:test`, run 2 | Passed on the committed composition: 580 tests, 580 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Passed with the checkpoint database closed when the store cannot be opened: 580 tests, 580 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 4 | Passed on the final source, with the stricter thread ID checks and the tests of the closing: 586 tests, 586 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 5 | Passed with the existence check of a given thread ID reading one thread ID from the checkpoint table instead of listing every checkpoint: 587 tests, 587 passed, 0 failed, 0 skipped (exit 0). `checkpointed-thread.test.ts` finds a stored thread ID with and without regard to case on a real SQLite checkpointer. |
| `npm run workflow:test`, run 6 | Passed with the lookup treating a checkpoint database without its table as holding no thread: 589 tests, 589 passed, 0 failed, 0 skipped (exit 0). Before the guard the two new tests failed with `no such table: checkpoints` (`checkpointed-thread.test.ts` on a database no saver operation touched; `compose-workflow.test.ts`: a start with a given ID on a fresh composed workflow ended in `Setup error: SqliteError: no such table: checkpoints`). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

No live run: the task changes how the workflow is composed and how a start picks its thread ID, not what a thread captures.

| Evidence named by the task | Tests |
| --- | --- |
| The existing workflow tests | Every test of `workflow/tests/` runs against `runWorkflow`, which the composition calls unchanged for a start without a given ID and for a resume. |
| The composition | `compose-workflow.test.ts`: the composed workflow opens its checkpoint database, runs one command after another (two resumes of unknown threads, each a setup error that names the thread), and after `close()` its checkpoint database is closed. |
| A start with a given ID | `graph.test.ts`: a start given a new thread ID runs its thread under that ID (the state's `threadId`, the finished line, the captures). |
| A start with an ID that exists | `graph.test.ts`: a start given the ID of a thread that exists is a setup error (3) before any step, leaves that thread's checkpoint as it was, the thread still resumes where it stopped, and a finished thread's ID is refused too. A given ID that is not one path segment or that git or Windows cannot take (empty, `../wf-x`, `wf x`, `-wf`, `a..b`, `wf.lock`, `wf.`, `CON`, `nul.txt`, `Lpt1`) is refused before anything runs; so is an ID that differs from an existing thread's only in case (the check reads one thread ID from the checkpoint table and loads no checkpoint), an ID whose folders or branches exist (`thread-traces.test.ts` covers the folder of the thread, of its discovery thread and the branches `accepted/<thread>` and `workflow/<thread>/…`, whatever the case), and a resume that is also given a thread ID. |
| The closing of the checkpoint database | `compose-workflow.test.ts`: when the store cannot open (a folder lies where its database belongs), the composition throws and closes the checkpoint database it had opened; with the `close()` of that failure path removed the test fails. |

## Task 2.1: the driver

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Passed: 656 tests, 656 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 2 | Passed on the source before the failed-tuning change: 657 tests, 657 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Failed after the failed-tuning change: 646 tests, 645 passed, 1 failed (exit 1). `not ok 35 - workflow\tests\loop-driver.test.ts` (`error: 'test failed'`, `failureType: 'testCodeFailure'`, location `loop-driver.test.ts:1:1`): the file did not compile (`workflow:typecheck`: `loop-driver.test.ts(157,49): error TS1002: Unterminated string literal`), because a line break had been written inside three string literals. |
| `npm run workflow:test`, run 4 | Passed on the final source, with a failed tuning ending the loop `failed`: 659 tests, 659 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 20 passed, 0 failed. |
| `npm run loop -- --help` | Printed the loop's usage (exit 0). |
| `npm run loop -- --only capture`, `npm run loop -- --max-runs 0` | Setup errors before anything ran (exit 3): `npm run loop does not take --only: every thread of a loop runs the whole workflow.`; no `out/` folder was created. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

No live run: the task's evidence is the loop's decisions over a fake workflow runner and fake tunings, which prove no live loop.

| Evidence named by the task | Tests (`loop-driver.test.ts`) |
| --- | --- |
| Converged | A thread that merged a fix (the branch's tree changed), then one that changed nothing with no tuning due: two threads, `converged`, exit 0. A thread that changed nothing ends `converged` also under `--max-runs 1`; so does a fix merged without changing the branch's tree, and a rejected tuning (exit status 1, not an execution failure). |
| Limit | `--max-runs 1` with a merged fix: the tuning step runs, then `limit`, exit 0. |
| Failed after status 2 | A thread that exits with 2: `failed`, exit 2, no tuning and no further thread; its summary is recorded. A tuning whose cycle failed (exit status 2) ends the loop `failed` with exit 2 and names the tuning in its decision, whether the thread changed nothing or merged a fix; no further thread starts. |
| A merged fix, an admitted scenario and an activated tuning that go on | Four threads: each of the three changes starts the next thread with its reason (`thread wf-1 merged d-1`, `thread wf-2 admitted build-a@s1`, `tuning tune-2 activated a configuration`); a rejected tuning does not; the fourth converges. With this machine's steps, the eval CLI's automatic tuning runs in process: the first, due, activates a candidate and the second thread starts; the second is not due and the loop converges. |
| The options each thread gets | Every thread is started as `{ kind: "start", arguments }` with the loop's options (`--case a,b --no-ocr --settings-overlay o --fix-changes`) under the ID that `loop.json` held before the thread started; with this machine's steps, through the composed workflow's `run` with that ID. Every tuning is in `loop.json` with its ID and cycle before it runs. |
| `npm run loop` arguments | `--max-runs` takes a positive integer; `--only`, `--resume`, an unknown option, a missing or invalid value and contradicting options are setup errors. |
| Checkpoints and `loop.json` | The loop graph is checkpointed under the loop's ID in `out/loop/checkpoints.sqlite`, and `out/loop/<loop>/loop.json` holds the options, the status and every iteration's thread, exit status, summary, tuning and decision. A setup error in a thread or a tuning ends the process with 3 and leaves the loop `running`. |
| A thread's summary | Read from its `outcome.json` (written as the workflow's `OutcomeDocument`): fixed and merged clusters, whether the merges changed the branch's tree, and the admitted cases; a finished thread without `outcome.json` is a setup error. |

## Task 4.1: pause and unpause

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Failed before the tests were adapted: 659 tests, 657 passed, 2 failed (exit 1). `not ok 357 - on this machine's steps, threads start through the composed workflow with a given ID and the automatic tuning runs in process` (`loop-driver.test.ts`): `Expected values to be strictly deep-equal` with `request: { + loopControl: { folder: '<temp>\workflow-loop-8KZakN\out\loop\loop-20261029T090000Z-0000abcd', log: [Function: log] }, threadId: 'wf-20261029T090000Z-ee09808d' }`, because a loop's threads now get the loop's gate. `not ok 358 - a cluster rejected at its narrow check gets a second attempt that sees the first, and is fixed by it` (`loop-graph.test.ts`): `Expected values to be strictly deep-equal` with `+ pausedMilliseconds: 0` in the outcome's measures. Both tests were changed to expect the new fields. |
| `npm run workflow:test`, run 2 | Passed with the new tests: 673 tests, 673 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 3 | Passed after the review's fixes and their tests: 676 tests, 676 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 4 | Passed with the lock of the control file and its tests: 679 tests, 679 passed, 0 failed, 0 skipped (exit 0). |
| `npm run workflow:test`, run 5 | Failed on the same source as run 4: 679 tests, 678 passed, 1 failed (exit 1). `not ok 383 - a lane paused while it captures finishes that case and takes no new one; the other cases go one after the other to the other lane` (`loop-lane-pause.test.ts:80`): `Expected values to be strictly deep-equal: + actual - expected` with `+ []` and `- [ 'capture a' ]`. The test waited a fixed 40 ms for the first command to start, which it had not done under the load of the whole suite. The tests of the file now wait until what they expect to start has started; only what must not happen is still checked after a fixed wait. |
| `npm run workflow:test`, run 6 | Passed on the final source: 679 tests, 679 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 20 passed, 0 failed. |
| `npm run loop -- --pause loop-20261128T000000Z-00000000` | Setup error (exit 3): `There is no loop loop-20261128T000000Z-00000000 (…\out\loop\loop-20261128T000000Z-00000000\loop.json).`; nothing was written. |
| `npm run loop -- --lane vm` | Setup error (exit 3): `--lane goes with --pause or --unpause.` |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

No live run: the evidence the task names is fixture-tested over fake agents, fake lanes and in-memory graphs. A live loop that is paused and unpaused, of the loop and of a lane, is not shown here and remains unverified.

| Evidence named by the task | Tests |
| --- | --- |
| A loop paused during a job | `loop-pause-workflow.test.ts`: a workflow thread run with a loop's gate is paused while its two hypothesis jobs run. Both jobs finish and are recorded (`hypothesized`, one record each), the diagnosis stage shows an interrupt in the thread's state and no challenge starts; after the unpause both challenges run, no finished job runs again, and the thread prints that it is paused and goes on. `loop-control.test.ts`: a task running when the pause is set finishes and keeps its write while the next node is interrupted on entry and runs after the unpause; a paused loop's graph is interrupted at its first node, starts no thread until the unpause and then converges; a pause set again between the unpause and the resumed node's start interrupts that node again. |
| A lane paused while it captures | `loop-lane-pause.test.ts`: lane `vm` is paused while it captures case `a`; `a` finishes on `vm`, and `b` and `c` are captured one after the other on lane `desktop` while `vm`, free and paused, takes neither. Unpaused, `vm` takes the next case. Its flag is written to `paused.json` in its agent folder; a lane the loop set no flag for gets none. |
| Every lane paused | `loop-lane-pause.test.ts`: with both lanes paused a case waits without failing, prints once that every desktop lane is paused, and is captured when one lane is unpaused; a waiting case still ends when the run is stopped. |
| An invalid control file | `loop-control.test.ts`: a control file that is not JSON, that does not match its schema or that has an unknown field is a setup error that names it, both when it is read and when a paused node of a graph reads it (the node does nothing); the writer refuses an invalid control file. `loop-lane-pause.test.ts`: an invalid control file fails a desktop command with a setup error that names it before any lane runs it. |
| A budget that does not count paused time | `loop-pause-workflow.test.ts`: a thread with a 60 min run budget whose hypothesis job reports 25 min of model time is paused for 90 min (the pause's clock) before its challenge: the challenge starts and is recorded, the thread's model time is 50 min, `pauses.json` holds the 90 min pause, and `outcome.json` gives `pausedMilliseconds` 90 min and an elapsed time of 30 min (two hours less the pause); a thread run without a loop records no pause. The run budget, an attempt's deadline and a job's time limit are measured inside a node from model time and from the moment a job gets its place, and a node pauses only on entry, so a pause falls between them; this is shown for the budget, not separately for a deadline or a time limit. |
| The control file, `--pause` and `--unpause` | `loop-control.test.ts`: a missing control file pauses nothing; the writer leaves no temporary file; setting the loop's or a lane's flag keeps the others. `loop-pause-command.test.ts`: `--pause` and `--unpause` with `--lane` parse, other options beside them are setup errors; they write the loop's or the lane's flag and an agent lane's `paused.json`; a loop that does not exist and a lane the profile does not declare are setup errors that write nothing. |
| Changes of the control file at the same time | `loop-control.test.ts`: a change of a flag waits while another writer, on its own thread, holds `control.json.lock`, then keeps the flag that writer set, and no lock stays behind; a lock that is not released is a setup error that names it and leaves the control file as it was. Two `npm run loop` processes started at once are not run. |
| A paused lane and the checks before captures | `loop-lane-pause.test.ts`: a paused lane is still asked for its identity and still runs a command that names it without taking its desktop, as the environment reading of a capture step does. |
| A graph run without a loop | `loop-control.test.ts`: a pausable node of a graph run without a loop's gate never pauses. |
| A graph invoked by another graph's node | `loop-control.test.ts`: a graph invoked inside another graph's node keeps its own checkpointer and thread (the caller's checkpointer holds nothing of it), its pause interrupts only its own invocation, and the calling node waits and resumes it. Without that, LangGraph runs such a graph as a subgraph of the calling node, with its checkpoints in the caller's checkpointer and its interrupts ending the caller's node; workflow threads a loop runs, their discovery threads and tunings are invoked as graphs of their own. `thread-discovery.test.ts`: a workflow thread a loop runs gives its discovery thread the loop's gate, whose pauses are recorded as the workflow thread's. |
