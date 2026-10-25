# Design

## Context

`npm start` composes the workflow in `main.ts` and runs or resumes one thread; it prints the thread's ID only once it chose it, and its conclusion is in `outcome.json` (dispositions, merges, discovery). `npm run eval -- tune auto` runs an automatic tuning when due and resumes one in progress. Both are long, interruptible and resumable on their own.

## Goals / Non-Goals

**Goals:**

- Keep improving without a person: run, merge, discover, tune, run again, and stop when the next pass would see nothing new.
- A loop interrupted at any point continues where it was, without starting a second thread or tuning for the same step.

**Non-Goals:**

- No parallel threads: the desktop is the bottleneck and threads already shard across lanes.
- No new decision about what to fix: every thread runs the workflow as `npm start` does.

## Decisions

### Composition

`main.ts` keeps its command line and moves its composition into `composeWorkflow(repositoryRoot, profile, log, signal)`, which returns `run(command, { threadId? })` and `close()`. The start can be given the thread ID to use, which must be new. The driver composes the workflow once per loop process and calls `run` for each thread. The automatic tuning is called through the same function the eval CLI's `tune auto` uses.

### The loop graph

The driver is a checkpointed LangGraph graph, `buildLoopGraph` in `workflow/src/loop-driver/loop-graph.ts`, saved in `out/loop/checkpoints.sqlite` under the loop ID:

```
START → start_thread → run_thread → decide_thread ─┬→ tune → decide → start_thread
                                                    └→ end (failed, stopped, limit)
                                     decide ────────→ end (converged, stopped, limit)
```

- `start_thread` picks the thread ID (a new one, recorded in the state before the thread starts) or keeps the unfinished one.
- `run_thread` runs or resumes the workflow thread through the shared composition; its discovery runs inside it. A setup error there fails the node, so `--resume` repeats it, and the workflow thread resumes.
- `decide_thread` records the thread's exit status and outcome summary: status 2 ends `failed`; a stop request ends `stopped`; the limit ends `limit` after tuning.
- `tune` runs or resumes the tuning graph (see the automatic tuning), recorded before it starts.
- `decide` ends `converged` when the thread merged nothing, admitted nothing and the tuning activated nothing; otherwise it goes back to `start_thread`.

The options of each thread are the loop's arguments; the default suite of each new thread includes the scenarios admitted so far, and each thread builds the source its predecessor merged.

### State

`loop.json` holds `loopId`, the arguments, the threads in order with their graph kind, start and end times and the reason the next one started, `maxRuns`, `status` (`running`, `converged`, `limit`, `stopped`, `failed`), and `iterations`, each with the thread ID, its status, the summary read from its `outcome.json`, and the tuning (`not_due`, or the tuning's cycle and outcome). It is written to a temporary file and renamed after every change. `--resume <loop>` refuses a loop that is not `running`. The stop request is a file `stop` in the loop's folder; `--stop` writes it and exits with 0, and the driver checks it before each step.

### Pause and unpause

`workflow/src/loop/loop-control.ts` holds the zod schemas of `control.json`, `state.json` and an activity line, `readControl(folder)` (a missing file is nothing paused) and `writeControl(folder, control)` (temporary file and rename), and `pausable(node)`, the wrapper every node of the four graphs is built with. The wrapper reads the control file named in the invocation's `configurable.loopControl` (absent outside a loop, so `npm start` never pauses) and, when the loop is paused, calls `interrupt({ paused: true })` before the node does anything. Tasks already running in the super-step finish and keep their writes; the interrupted ones appear as interrupts in `getState()`. The driver sees every graph it runs reach the interrupt, marks `paused`, and on unpause invokes it again with `new Command({ resume: true })`, which runs the interrupted tasks from their start. A paused loop graph is resumed the same way. The run budget, an attempt's deadline and a job's time limit are measured from model time and from the moment a job gets its place, so paused time is never inside them; the activity records it apart (`pausedMs`).

A lane's flag is read by the lane pool when it picks a lane, so a paused lane gets no new command while one it runs finishes; an agent lane's flag is also written to `paused.json` in its folder.

### The graphs' structure

The four builders (`buildLoopGraph`, `buildWorkflowGraph`, `buildDiscoveryGraph`, `buildTuningGraph`) compile from inert step objects, so a reader can compile them read-only. At startup the driver writes `out/loop/graphs/<graph>.json` (from `drawJson()` of `getGraphAsync()`) and `<graph>.mmd` (`drawMermaid()`) for all four.

| Graph | Builder | Checkpoints | Thread ID |
| --- | --- | --- | --- |
| loop | `buildLoopGraph` (`workflow/src/loop-driver/loop-graph.ts`) | `out/loop/checkpoints.sqlite` | `loop-…` |
| workflow | `buildWorkflowGraph` (`workflow/src/graph/workflow-graph.ts`) | `out/workflow/checkpoints.sqlite` | `wf-…` |
| discovery | `buildDiscoveryGraph` (`workflow/src/discovery/discovery-graph.ts`) | `out/discovery/checkpoints.sqlite` | `disc-…` |
| tuning | `buildTuningGraph` (`workflow/src/tuning/tuning-graph.ts`) | `out/evals/tuning/checkpoints.sqlite` | `tune-…` |

### State and activity

`state.json` is `{ paused, pausing, lanes: { <lane>: { paused, busy } }, updatedUtc }`; a reader derives running tasks from the checkpoints. Every graph the loop runs is streamed with `streamMode: ["tasks", "values"]`; task start and result events give the lanes' `busy` entries (the lane the host runner reports for the task) and one `activity.jsonl` line per finished task with its duration and the paused time that passed while it ran.

## Risks / Trade-offs

- A loop can run for hours; each thread's run budget still limits its model time, and `--max-runs` bounds the number of threads.
- A thread that keeps ending `findings_remaining` without merging anything ends the loop as `converged`: the next pass would see the same source and cases.

## Fixture and live evidence

Workflow tests with a fake workflow runner and a fake tuning prove the decisions, the state file, stop and resume. Only a live loop proves that a second thread captures a merged fix's source and admitted scenarios; it records the canonical hash before and after and each thread's execution outcomes apart from its visual results.
