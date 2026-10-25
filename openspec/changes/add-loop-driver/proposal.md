# Proposal

## Why

A workflow thread is one pass: it captures, repairs and merges what it can, discovers when nothing differs, and ends. Running the next pass, deciding whether tuning is due, and noticing that nothing changes any more are left to a person who starts `npm start` and `npm run eval -- tune auto` again and again, and who has to remember which thread or tuning was interrupted.

## What Changes

- **`npm run loop`.** A driver, itself a checkpointed LangGraph graph, that runs workflow threads one after another with the `npm start` options it was given (except `--only` and `--resume`), and after each thread runs `tune auto` (which tunes only when due). It starts the next thread when the last one changed something the next one would see: a fix merged into the branch, a scenario admitted by discovery, or a configuration activated by tuning. It ends `converged` when a thread changed nothing and no tuning activated anything, `limit` after `--max-runs <n>` threads, `stopped` when a stop was requested, and `failed` when a thread exited with 2 (execution failures need a person) or a setup error stopped a step.
- **State and resume.** Each loop has an ID (`loop-<time>-<suffix>`) and a folder `out/loop/<loop>/` with `loop.json`: the options, every iteration's thread with its exit status and outcome summary, every tuning with its outcome, and the loop's status. A thread's ID is recorded before the thread starts, so `npm run loop -- --resume <loop>` resumes an interrupted thread or tuning instead of starting another, then goes on.
- **Stop.** `npm run loop -- --stop <loop>` writes a stop request into the loop's folder; the driver ends after the step that is running, leaving nothing half done. Ctrl+C stops the running step at once, as in `npm start`; the loop stays resumable.
- **Pause and unpause.** `out/loop/<loop>/control.json` (`{ paused, lanes: { <lane>: { paused } }, updatedUtc }`) pauses the whole loop or single desktop lanes; `npm run loop -- --pause|--unpause <loop> [--lane <lane>]` and any other tool, such as a dashboard, write it atomically through one exported module (`workflow/src/loop/loop-control.ts`). Every node of the loop, workflow, discovery and tuning graphs calls LangGraph's `interrupt()` on entry while the loop is paused: running jobs and captures finish and keep their writes, and unpausing resumes the interrupted tasks with `Command({ resume: true })`. A paused lane takes no new capture; cases go to the other lanes or wait. Paused time does not count toward run budgets, deadlines, job time limits or timing.
- **State for readers.** `out/loop/<loop>/state.json` shows the paused and pausing flags and each lane's flag and the task that holds it; the four graphs' structure is written to `out/loop/graphs/`; `activity.jsonl` gets one line per finished task; both have exported schemas. `loop.json` lists the threads in order with their kind, times and the reason the next one started.
- Exit status: 0 for `converged`, `limit` or `stopped`, 2 for `failed` after a thread with execution failures, 3 for a setup error (resumable).

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests with fake threads and tunings for each way a loop ends, a resume after an interrupted thread and after an interrupted tuning, a stop request between steps, and the options passed to every thread; a live loop of at least two threads, with the canonical hash before and after and each thread's execution outcomes apart from its visual results.

## Capabilities

### New Capabilities

- `workflow-loop`: the driver, its iterations, its stop and resume, how it decides to go on, pause and unpause, and its state and activity files.

### Modified Capabilities

- `desktop-lanes`: a paused lane takes no new desktop command.

## Impact

- New: `workflow/src/loop-driver/` with the `loop` npm script and tests.
- Edited: `main.ts` (the workflow's composition is shared with the driver and the start takes a thread ID chosen before it), the eval CLI's automatic tuning (callable in process); `AGENTS.md` and `README.md`.
