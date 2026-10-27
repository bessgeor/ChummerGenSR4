# Design

## Context

`buildWorkflowGraph` adds every node to one `StateGraph(WorkflowState)`: `build`, `capture`, `compare` and `route_cases`, `triage`, `inventory`, the diagnosis nodes (`prepare_diagnosis`, `route_diagnosis`, `hypothesize`, `challenge`, `wait_for_quota`, `check`, `finish_diagnosis`), the repair nodes (`prepare_repair`, `route_repair`, `repair`, `wait_for_repair_quota`, `finish_repair`), the widening nodes (`prepare_widening`, `route_widening`, `widen`, `promote`, `roll_back`, `finish_widening`), `retry_repair` and `conclude`. Its routers fan out with `Send`, and every task is checkpointed on its own.

## Decisions

### Stage builders

`workflow/src/graph/stages/` holds one builder per stage, each returning an uncompiled `StateGraph(WorkflowState)` with the stage's existing nodes and edges from `START` to `END`; `buildWorkflowGraph` compiles each and adds it as a node:

```
START → start → capture ─┬→ diagnose → repair ─┬→ widen ─┬→ repair (next attempts)
                         │                      │         └→ conclude
                         │                      ├→ repair (next attempts, widening off)
                         │                      └→ conclude
                         └→ conclude (no diagnosis, --only)
diagnose → conclude (no repair)
```

The routing that used to sit between stages (`inventory` → diagnosis or conclude, `finish_diagnosis` → repair or conclude, `finish_repair` → widening, retry or conclude, `finish_widening` → retry or conclude) becomes conditional edges of the workflow graph between stage nodes. `retry_repair` becomes the last node of `widen` (and of `repair` when widening is off): it sets the next attempts in the state, and the workflow graph routes back to `repair` when any cluster is pending again. A stage whose node does not run (`--only`, `--no-diagnosis`, `--no-repair`, `--no-widening`) is skipped by those edges, as its first node was before.

The subgraphs share the state's keys with the workflow graph, and a node inside a subgraph sees the whole state as before. Inside a stage the nodes' writes merge through the state's reducers; a stage returns the whole state when it ends, and the workflow graph holds every key as the last value written, since one stage runs at a time. Merging a stage's whole state through the reducers again would count model time and earlier widenings twice and bring back a widening a next attempt removed. Fan-outs (`Send("capture", …)`, `Send("hypothesize", …)`, `Send("repair", …)`, `Send("widen", …)`) stay inside their subgraph, so their payloads are in that subgraph's checkpoint namespace (`capture:<task id>`, …), and `getState(config, { subgraphs: true })` returns the running stage's state with its pending tasks.

### Checkpoints and resume

Subgraphs are compiled without a checkpointer of their own, so they use the parent's: one SQLite file per graph kind, as before, with the subgraphs' checkpoints in their namespaces. LangGraph runs a stage with an unset `checkpoint_id` in its configuration, and a run whose configuration has that key does not apply the stored writes of the tasks that finished beside a failed one; each stage's run gets its configuration without that unset key, so a resumed stage repeats only its unfinished tasks, as the flat graph did.

A thread stored by the flat graph has channel values but no stage nodes, and some of its nodes (`capture`, `repair`, `conclude`) have a stage's name. `checkResumable` reads the thread's latest checkpoint before the graph interprets it and refuses a thread whose checkpoint names a node that is not a stage (a node that ran, or one a channel would trigger; a flat thread names `build` from its first step on) with a setup error that names the change and says that its recorded capture and compare steps are reused by a new thread. This break is accepted: rebuilding the flat checkpoints into namespaced ones is not worth the risk for threads that can be started again cheaply.

### Names

The stage IDs (`start`, `capture`, `discovery`, `diagnose`, `repair`, `widen`, `conclude`) are exported as a constant and are stable. Later stages are added under their own fixed IDs.

## Risks / Trade-offs

- Subgraph checkpoints add one level of namespaces; LangGraph handles resumption of a subgraph interrupted mid-stage from its own checkpoint, and the tests cover a kill inside each fanning stage.
- The workflow graph keeps each key as the last value a stage returned, so every stage boundary writes the whole state into a checkpoint; the checkpoints grow with it, which is the price of not applying a stage's reducers twice.
- An unexpected error inside a subgraph surfaces as the stage node's error, so error messages and setup errors are tested to pass through unchanged.

## Fixture and live evidence

Graph tests with fake steps prove the topology, resumption inside stages, the drawing and the refused flat thread. Only a live run proves the stages on the real host; it records the canonical hash before and after, execution outcomes apart from visual results.
