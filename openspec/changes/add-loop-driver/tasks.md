# Tasks

Each task names the tasks it builds on as `(after: …)`, by number in this list or as `<change>#<number>` for a task of another change; `[desktop]` marks a task that needs a live run on the desktop.

## 1. Shared composition

- [x] 1.1 (after: add-automatic-discovery#4.1, add-repair-worktrees#2.1) Move the workflow's composition out of `main.ts` into a function that runs or resumes a thread, and let a start take the thread ID chosen before it. Evidence: the existing workflow tests and a test of a start with a given ID and with an ID that exists.

## 2. The driver

- [ ] 2.1 (after: 1.1, add-automatic-tuning#3.1) Add `npm run loop` with its arguments and the loop graph (`buildLoopGraph`, checkpointed in `out/loop/checkpoints.sqlite`) with `loop.json`, the iteration and its decisions. Evidence: workflow tests with a fake runner and tuning for converged, limit, failed after status 2, a merged fix, an admitted scenario and an activated tuning that go on, and the options each thread gets.

## 3. Stop and resume

- [ ] 3.1 (after: 2.1) Add `--stop` and `--resume`, checked before each step, and resume an interrupted thread or tuning. Evidence: workflow tests for a stop between steps, a resume after a setup error in a thread and in a tuning, and a resume of a loop that ended.

## 4. Pause, state and activity

- [ ] 4.1 (after: 2.1) Add `workflow/src/loop/loop-control.ts` (control file schema, reader, atomic writer), `--pause` and `--unpause` with `--lane`, `pausable` nodes that call `interrupt()` while the loop is paused and a resume with `Command({ resume: true })`, paused time kept out of budgets, deadlines and timing, and lanes that take no new command while paused. Evidence: workflow tests for a loop paused during a job, a lane paused while it captures, every lane paused, an invalid control file, and a budget that does not count paused time.
- [ ] 4.2 (after: 4.1) Write the four graphs' structure under `out/loop/graphs/`, `state.json` with each lane's flag and task, and `activity.jsonl` from the graphs' task events, with exported schemas, and record each thread's kind, times and reason in `loop.json`. Evidence: workflow tests for two cases on two lanes, a discovery and a tuning task, and the schemas against written files.
- [ ] 4.3 (after: 2.1) Open every checkpoint database (loop, workflow, discovery, tuning) in WAL mode with a busy timeout, so that a reader such as a dashboard can open it while a graph writes. Evidence: a workflow test that reads a checkpoint database through a second saver while a graph writes it, with every write committed and no reader error.

## 5. Docs

- [ ] 5.1 (after: 3.1, 4.2, 4.3) Document `npm run loop` in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck`, `npm run workflow:test` and `npm run openspec:validate` pass (recorded in `verification.md`).

## 6. Verification and archive

- [ ] 6.1 (after: 5.1) [desktop] Run `npm run loop` live for at least two threads with a pause and unpause of the loop and of a lane; record in `verification.md` the canonical hash before and after, each thread's execution outcomes apart from its visual results, the tuning step, how the loop ended, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 6.2 (after: 6.1) Archive the change with `openspec archive add-loop-driver`. Evidence: `npm run openspec:validate` passes after the archive.
