# Proposal

## Why

The workflow graph is one flat graph of about thirty nodes: build, the capture and compare fan-out, triage, the inventory, the diagnosis jobs and their check, the repair attempts, each widening step, the next attempts and the conclusion. Nothing in the graph says which nodes make up which stage, so a reader of a thread (its checkpoints, its task stream, a drawing of the graph) sees nodes but not the stages a person reasons about, and every new stage adds more nodes to the same flat list.

## What Changes

- **One subgraph per stage.** Each stage of a workflow thread becomes a compiled LangGraph subgraph, added as one node of the workflow graph. The nodes of the workflow graph are the stage IDs, which stay fixed:
  - `start`: the build of the candidate and the tools;
  - `capture`: the captures and compares of the planned cases, one per desktop lane at a time, then triage and the inventory;
  - `diagnose`: the sealed contexts, hypothesis and challenge jobs, quota waits and the check;
  - `repair`: the repair attempts and their quota waits;
  - `widen`: the widening steps, promotion and rollback, one cluster at a time;
  - `conclude`: the dispositions, the outcome and `outcome.json`.
  The next attempts route from `widen` (or from `repair` when widening is off) back to `repair`, and the stages that a thread's options leave out are skipped by the workflow graph's own edges.
- **Same state, same steps.** The subgraphs share the workflow state, keep their inner nodes' names, and fan out with `Send` inside the subgraph as before, so a pending task's arguments (a case's index, a cluster's ID) are in that subgraph's checkpoint namespace. Every host step, model job and document is unchanged.
- **Readable structure.** `getGraphAsync({ xray: true })` draws the stages with their inner nodes, `getState(config, { subgraphs: true })` shows the running stage's own state and tasks, and the task stream names each task's namespace.
- **No resume across the change.** A thread checkpointed by the flat graph cannot be resumed: `npm start -- --resume` refuses it with a setup error that says so. Its recorded capture and compare steps are still reused by a new thread.

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: the existing graph tests unchanged in what they assert about steps, outcomes and resumption; tests of the drawing with `xray`, of `getState` with subgraphs during a fan-out, and of the refused flat thread; a live `npm start` run.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `parity-workflow`: the workflow graph is made of stage subgraphs with fixed IDs; threads stored by the flat graph cannot be resumed.

## Impact

- Edited: `workflow/src/graph/` (the graph is built from one builder per stage), `run-workflow.ts` (the refused flat thread), tests, `AGENTS.md` and `README.md`.
- Threads started before this change cannot be resumed; finish or abandon them first.
