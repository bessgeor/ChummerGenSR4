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
