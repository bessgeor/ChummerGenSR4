# Design

## Context

Every graph of the loop is a LangGraph `StateGraph` checkpointed in its own SQLite file: the loop graph (`out/loop/checkpoints.sqlite`), the workflow graph (`out/workflow/checkpoints.sqlite`), the discovery graph (`out/discovery/checkpoints.sqlite`) and the tuning graph (`out/evals/tuning/checkpoints.sqlite`). Each graph's builder compiles from step objects that are only called when a node runs. Model jobs leave eval records in `out/workflow/store.sqlite`. Each workflow thread writes `triage.json` and `outcome.json` in its folder. The loop driver keeps, per loop, `loop.json` (its threads in order), `control.json` (the pause flags), `state.json` (paused, pausing, each lane's flag and the task it runs) and `activity.jsonl` (one line per finished task, from the graphs' `tasks` stream).

## Goals / Non-Goals

**Goals:**

- Show the loop as people think about it (the stages of the loop diagram) without losing LangGraph's own view of each graph.
- Take every live fact from LangGraph's APIs or from the documents the loop already writes; add no second record of what runs.
- Pause and resume the loop and each lane from the page, with the same effect as the loop driver's CLI.
- Keep every failure visible.

**Non-Goals:**

- No LangGraph Studio or LangGraph server: Studio runs graphs in its own in-memory server and its UI needs a hosted account, so it cannot watch our runs.
- No control besides pause and resume: the page never starts, stops or resumes a thread, and never changes options.
- No access from other machines: the server listens on 127.0.0.1 only.

## Decisions

### Read-only graphs

The server compiles each graph's builder with inert step objects and a `SqliteSaver` on that graph's checkpoint file, and only calls `getGraphAsync()`, `getState()` and the saver's `getTuple()` on it, so no node runs. A missing checkpoint file means the graph has no threads yet.

### Stages

A fixed table maps each graph's node names to a stage: the workflow's `build` to start thread; `capture`, `compare`, `route_cases`, `triage` and `inventory` to capture and compare; the diagnosis nodes to diagnose; the repair nodes and `retry_repair` to repair; the widening nodes to widen; `conclude` to conclude; every discovery node to discovery; every tuning node to tune; the loop graph's nodes to the stage they start. A test compiles every graph and fails when a node has no stage, so a new node cannot go unseen.

### Node view grouped by LangGraph

LangGraph's `drawMermaid()` draws a subgraph for every group of nodes whose IDs share a `<prefix>:`, which is how it names the nodes of a real subgraph. The dashboard copies the compiled graph's nodes and edges as `getGraphAsync()` returns them, renames each node `<stage>:<node>`, and has LangGraph's own `Graph.drawMermaid()` draw the copy, so LangGraph draws each stage as a subgraph and keeps every node, edge and style. Making the stages real subgraphs of the workflow graph would give the same drawing without the rename, but would change the graph's checkpoints, so threads started before could not resume.

### Running tasks

For each thread that may be running, `getState()` lists the tasks of the next superstep. A task with a `result` or an `error` has finished; a task with interrupts is paused; any other task is running since the checkpoint's `createdAt`. A pushed task's path names the index of its pending send in the checkpoint's `__pregel_tasks`, whose arguments name its cluster (`clusterId`), its case (`index` into `plan`) or its discovery target. Threads that may be running are the loop's threads that have not ended. Without a loop, the page lists the threads with pending tasks from the most recent checkpoints and says it cannot tell a running thread from an interrupted one.

### Loop status

`running`, `pausing` (paused, but tasks still run), `paused`, `ended` (the loop's `endedUtc` is set) or `stale` (`state.json` older than 30 seconds while the loop has not ended: the driver may have stopped).

### Stats

- p80 is the nearest-rank 80th percentile of the stage's task durations from `activity.jsonl`, each `finishedUtc - startedUtc - pausedMs`. Routing nodes (`route_*`, `prepare_*`, `finish_*`) take no time and are left out. A stage with no logged task falls back to the `durationMs` of its eval records (hypothesis and challenge for diagnose, repair, rank and scenario for discovery, tune for tune), and the page names the source.
- Counts come from the loop's threads, or from every workflow and discovery thread without a loop: triage totals for discrepancies and clusters; scenario records with the discovery label `proven` for discoveries; hypothesis records by check label; repair records, grouped by thread and cluster (one group per hypothesis that reached repair), for rejected tries per hypothesis; their widening labels for promotions and, over the groups that ended without a promotion, the mean number of widenings before the rejection; `outcome.json` dispositions for fixes merged and `merge_failed`; the loop's tuning threads, or the folders of `out/evals/tuning/cycles/` without a loop, for tunings run.

### Controls

`POST /api/control` with `{ loop, lane, paused }` (`lane` null for the whole loop) writes `control.json` atomically through the loop driver's writer and keeps every other flag. It is refused for an ended loop and for a lane the loop does not have. Every request must name the server by its loopback address, come from its own page when the browser says where it comes from, and carry the page's random token, as the review page does.

### Client

The page is a React app in TypeScript under `workflow/src/dashboard/client/`, with its own `tsconfig.json` (DOM types, `jsx: react-jsx`) that `workflow:typecheck` also runs. The server bundles it with esbuild once at start and serves the bundle; Mermaid is bundled with it, so the page loads nothing from the network. The client polls `/api/snapshot` every 2 seconds; the snapshot type is shared by server and client.

## What fixture tests prove and what only a live run can prove

Fixture tests prove the stage map, the live tasks read from a real SqliteSaver while a test graph runs, the stats from fixture records and documents, the control writes and refusals, and the routes. Only a live run on the Windows desktop proves that the page follows a real loop's threads and lanes and that its pause and resume stop and restart a real loop and lane. The dashboard never launches `bin/ChummerGenSR4.exe`; a live check that runs the loop records its SHA-256 before and after.

## Risks / Trade-offs

- `__pregel_tasks` is a LangGraph internal channel. If a LangGraph upgrade renames it, tasks show without their subject and the page says so; the test against a real SqliteSaver catches it.
- The page polls rather than streams; two seconds is enough for stages that take minutes.
