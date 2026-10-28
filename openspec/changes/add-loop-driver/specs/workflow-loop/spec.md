## ADDED Requirements

### Requirement: npm run loop runs threads until nothing changes
`npm run loop -- [options]` SHALL accept the options of `npm start` except `--only` and `--resume`, and `--max-runs <n>` (a positive integer, no limit by default); an unknown option, a missing value or an excluded option SHALL be a setup error before anything runs. It SHALL start a loop with an ID it prints, run a workflow thread with those options, then run an automatic tuning, which tunes only when it is due, and start the next thread when the last thread merged a fix, its discovery admitted a scenario, or the tuning activated a configuration. It SHALL end `converged` when a thread and the tuning after it changed none of these, `limit` when it ran `--max-runs` threads, and `failed` when a thread exited with 2 or the tuning after it failed (exit status 2). Each thread SHALL be started with the loop's options as `npm start` would start it then, so it plans the scenarios admitted so far and builds the source merged so far.

#### Scenario: A fix, then nothing new
- **WHEN** the first thread merges a fix and the second thread finds nothing to fix, discovers nothing new and no tuning is due
- **THEN** the loop runs exactly two threads and ends `converged` with exit status 0

#### Scenario: Execution failures
- **WHEN** a thread of the loop exits with 2
- **THEN** the loop ends `failed` with exit status 2 and starts no further thread or tuning

#### Scenario: A failed tuning
- **WHEN** the automatic tuning after a thread fails with exit status 2, whatever the thread changed
- **THEN** the loop ends `failed` with exit status 2, names the tuning in its decision and starts no further thread

#### Scenario: Limit
- **WHEN** `npm run loop -- --max-runs 1` runs and the thread merges a fix
- **THEN** the loop ends `limit` after the tuning step and exits with 0

### Requirement: A loop is recorded and resumes where it stopped
A loop SHALL keep `out/loop/<loop>/loop.json`, written to a temporary file and renamed after every change, with its options, its status (`running`, `converged`, `limit`, `stopped` or `failed`) and every iteration: the thread's ID (recorded before the thread starts), its exit status, the clusters it fixed and merged, the scenarios its discovery admitted, and the tuning step (not due, or the tuning's cycle and outcome, recorded before it starts). A setup error or Ctrl+C in a thread or a tuning SHALL end the loop's process with status 3 and leave the loop `running`. `npm run loop -- --resume <loop>` SHALL continue the loop graph from its checkpoint, resuming the recorded thread or tuning that did not finish, without starting another for that step, and then go on; a loop that is not `running` or does not exist SHALL be a setup error.

#### Scenario: Interrupted during a thread
- **WHEN** a loop's second thread is stopped with Ctrl+C and the loop is resumed
- **THEN** that thread is resumed with `--resume` semantics and no third thread starts in its place

#### Scenario: Interrupted during a tuning
- **WHEN** a loop is stopped while its tuning's cycle runs and is resumed
- **THEN** the tuning in progress continues and the next thread starts only after it

### Requirement: A loop can be asked to stop
`npm run loop -- --stop <loop>` SHALL write a stop request into the loop's folder and exit with 0; a loop that does not exist SHALL be a setup error. The driver SHALL check the request before each thread and each tuning and SHALL end `stopped` with exit status 0 without starting that step; a step that is running SHALL finish first.

#### Scenario: Stop while a thread runs
- **WHEN** `--stop` is written while a loop's thread is capturing
- **THEN** the thread runs to its end, no tuning or further thread starts, and the loop ends `stopped`

### Requirement: A loop and its lanes can be paused and resumed
Each loop SHALL have a control file `out/loop/<loop>/control.json` with `{ paused, lanes: { <lane>: { paused } }, updatedUtc }`, defined by one exported schema with a reader and a writer that writes a temporary file and renames it; any other writer, such as a dashboard, SHALL write it the same way. `npm run loop -- --pause <loop> [--lane <lane>]` and `npm run loop -- --unpause <loop> [--lane <lane>]` SHALL set the loop's or the lane's flag and exit with 0; a loop that does not exist or a lane the profile does not declare SHALL be a setup error. Every node of the loop, workflow, discovery and tuning graphs, the inner nodes of every stage subgraph included, SHALL be wrapped so that, when the loop's control file says the loop is paused, the node calls LangGraph's `interrupt()` on entry before it does anything; a node that runs without a loop never pauses. Tasks that were running when the pause was set SHALL finish and keep their writes; the interrupted tasks SHALL show as interrupts of the thread's state. The loop's state SHALL show `pausing` while a task still runs and `paused` once every running graph is interrupted. When the loop is unpaused, each interrupted graph SHALL be invoked with `Command({ resume: true })` from its checkpoint, and its interrupted tasks SHALL run from their start without repeating a finished task. Paused time SHALL NOT be charged to the run budget, to an attempt's deadline or to a job's time limit, and SHALL be recorded apart from task durations. A missing control file SHALL mean nothing is paused, and one that does not match its schema SHALL be a setup error that names it.

#### Scenario: Paused during a model job
- **WHEN** a loop is paused while a hypothesis job runs
- **THEN** the job finishes and is recorded, the challenge node is interrupted on entry, the state shows `pausing` and then `paused`, and after `--unpause` the challenge job starts

#### Scenario: Pause does not spend the budget
- **WHEN** a thread with a 60 min run budget is paused for 90 min between two jobs
- **THEN** the second job starts after the unpause and the budget counts only the jobs' model time

### Requirement: The loop's state and activity are written for readers
The driver SHALL keep `out/loop/<loop>/state.json`, written by temporary file and rename whenever it changes, as `{ paused, pausing, lanes: { <lane>: { paused, busy } }, updatedUtc }`, where `busy` is `{ thread, node, subject }` of the task that holds the lane, or null. It SHALL append one line per finished task of every graph it runs, taken from LangGraph's `tasks` stream, to `out/loop/<loop>/activity.jsonl`: `{ thread, graph, stage, namespace, node, subject, lane, startedUtc, finishedUtc, pausedMs, status }`, where `graph` is `loop`, `workflow`, `discovery` or `tuning`, `stage` is the stage ID the task belongs to (the workflow graph's `start`, `capture`, `discovery`, `diagnose`, `repair`, `widen` or `conclude`, the loop's `tune`, or the node itself in a graph without stages), `namespace` is the task's checkpoint namespace, `subject` is the case, cluster or job the task works on or null, `lane` is the desktop lane it held or null, and `status` is `succeeded`, `failed` or `interrupted`. The schemas of the control file, the state file and an activity line SHALL be exported from `workflow/src/loop/loop-control.ts`. `out/loop/<loop>/loop.json` SHALL hold `loopId` (always prefixed `loop-`), `startedUtc`, `status` and `threads`, the loop's threads in order, each as `{ thread, graph, startedUtc, endedUtc, reason }` with the reason it started. Every checkpoint database (loop, workflow, discovery, tuning) SHALL be opened in WAL mode with a busy timeout, so a reader can open it while a graph writes it without blocking the writer or losing a write.

#### Scenario: Two cases on two lanes
- **WHEN** a loop's thread captures cases `a` and `b` on lanes `desktop` and `vm`
- **THEN** `state.json` shows each lane busy with its thread, node `capture` and its case, and after both end `activity.jsonl` holds a line for each with its lane

### Requirement: The graphs' structure is written for readers
The loop SHALL be a LangGraph graph built by `buildLoopGraph` in `workflow/src/loop-driver/loop-graph.ts`, checkpointed in `out/loop/checkpoints.sqlite` with the loop ID as its thread ID, whose nodes start or resume a workflow thread, run the automatic tuning (its node `tune` is the compiled tuning graph) and decide whether the loop goes on, converges, reaches its limit, stops or fails. The workflow graph (`buildWorkflowGraph`, `workflow/src/graph/workflow-graph.ts`, `out/workflow/checkpoints.sqlite`), the discovery graph (`buildDiscoveryGraph`, `workflow/src/discovery/discovery-graph.ts`, `out/discovery/checkpoints.sqlite`) and the tuning graph (`buildTuningGraph`, `workflow/src/tuning/tuning-graph.ts`, `out/evals/tuning/checkpoints.sqlite`) SHALL compile from step objects that do nothing until a node runs, so a reader can compile them to read their structure and checkpoints. When `npm run loop` starts, it SHALL write `out/loop/graphs/<graph>.json` and `out/loop/graphs/<graph>.mmd` for the compiled `loop`, `workflow`, `discovery` and `tuning` graphs, from the graphs' own drawing of their nodes and edges, replacing the files of an earlier start.

#### Scenario: Graph files at start
- **WHEN** `npm run loop` starts
- **THEN** `out/loop/graphs/workflow.json` lists the workflow graph's nodes, `conclude` among them, and its edges, and `out/loop/graphs/loop.json` lists the loop graph's nodes, and `out/loop/graphs/loop.json` lists the loop graph's nodes
