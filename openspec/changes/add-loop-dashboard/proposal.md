# Proposal

## Why

The self-fixing loop runs for hours across many threads of several graphs: workflow threads, discovery threads, tuning cycles and the loop that chains them. What it is doing now, how long each stage takes and what each stage has produced can only be pieced together from console output, thread folders and the eval records. Pausing it so the desktop is free means stopping the run. LangGraph draws a compiled graph and reports a thread's pending tasks, but it has no view across the threads of a loop, no notion of the stages people reason about, no counts from our records, and no desktop lanes. LangGraph Studio runs graphs in its own server, so it cannot watch ours.

## What Changes

- **`npm run dashboard`** serves a local page on 127.0.0.1 (port 4318 by default). The page is a React app written in TypeScript and bundled with esbuild when the server starts.
- **Stage view.** The page draws the loop's stages: start thread, capture and compare, discovery, diagnose, repair, widen, conclude and tune, with the decisions between them. Each stage lists the LangGraph nodes it groups, and every node of every compiled graph belongs to exactly one stage.
- **Node view.** For each graph, the page shows LangGraph's own Mermaid drawing (`drawMermaid()`), with each stage drawn by LangGraph as a subgraph and the nodes running now marked.
- **Running now.** The tasks running now come from LangGraph itself: `getState()` on each graph's SqliteSaver gives a thread's pending tasks, and the checkpoint's pending sends give each task's case or cluster. The loop's lane state adds the lane a capture runs on. A stage with a running task is highlighted with the count.
- **Stats per stage.** The p80 duration of a stage's tasks, from the loop's activity log (the streamed task events, paused time left out), or from the eval records' job durations where no activity is logged. Counts per stage: threads started; discrepancies and clusters found; scenarios run and discoveries made; hypotheses made, by check outcome; repair tries and rejections per hypothesis; widenings, promotions and widenings before rejection; fixes merged and merges failed; tunings run.
- **Pause and resume.** Buttons pause and resume the whole loop and each desktop lane. They write the loop's control file, which the loop driver reads: a paused loop stops at the next node boundary through LangGraph's `interrupt()`, and a paused lane takes no new capture. Running tasks finish. The page shows a loop as pausing until its running tasks have finished.
- **Failures stay visible.** A document or store the page cannot read is shown as an error with its path and message. A stat without data shows as missing, never as zero.

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests for the stage map against every compiled graph, the live tasks read from a real SqliteSaver mid-run, the stats on fixture records and documents, the control writes and their refusals, and the server's routes; a live `npm run dashboard` against a running loop on George's machine.

## Capabilities

### New Capabilities

- `loop-dashboard`: the dashboard server, its stage and node views, the live tasks, the stats and the pause and resume controls.

### Modified Capabilities

None. The loop driver's control file, state file and activity log are specified with the loop driver.

## Impact

- New files under `workflow/src/dashboard/` (server, data, stage map) and `workflow/src/dashboard/client/` (the React app and its own `tsconfig.json`), and their tests.
- New dependencies of the workflow: `react`, `react-dom`, `mermaid` and `esbuild`, and the React type packages for development.
- The `dashboard` npm script; `workflow:typecheck` also checks the client.
- `AGENTS.md` and `README.md`.
