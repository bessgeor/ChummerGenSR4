## ADDED Requirements

### Requirement: The workflow graph is made of stage subgraphs
The workflow graph SHALL consist of one node per stage, each a compiled LangGraph subgraph sharing the thread's state: `start` (the build), `capture` (the captures and compares of the planned cases, then triage and the inventory), `diagnose`, `repair`, `widen` and `conclude`. The stage IDs SHALL be exported from the workflow's code and SHALL NOT change. The routing between stages, the next attempts back to `repair` and the stages a thread's options leave out SHALL be edges of the workflow graph. Fan-outs SHALL stay inside their stage, so a pending task's arguments are in its stage's checkpoint namespace. `getGraphAsync({ xray: true })` SHALL draw every stage with its inner nodes, and `getState(config, { subgraphs: true })` SHALL return the running stage's state and pending tasks. The host steps, model jobs, documents, exit statuses and outcomes SHALL be those of the same thread without stages. A thread checkpointed before the workflow graph had stages SHALL NOT be resumed: `npm start -- --resume` SHALL end with a setup error that says so, and a new thread SHALL reuse the old thread's recorded capture and compare steps.

#### Scenario: Stages in the drawing
- **WHEN** the workflow graph is drawn with `xray`
- **THEN** its nodes are `start`, `capture`, `diagnose`, `repair`, `widen` and `conclude`, and `capture` contains `capture`, `compare`, `triage` and `inventory`

#### Scenario: A fan-out seen from outside
- **WHEN** a thread captures three cases on one lane and its state is read with subgraphs during the first capture
- **THEN** the `capture` stage's state shows the capture task of the first case with its case index in the `capture` namespace

#### Scenario: Killed inside a stage
- **WHEN** a run is killed while a challenge job of the `diagnose` stage runs and the thread is resumed
- **THEN** the hypothesis jobs are not run again and the challenge job runs again

#### Scenario: A thread of the flat graph
- **WHEN** `npm start -- --resume` names a thread checkpointed before the workflow graph had stages
- **THEN** it exits with 3 saying the thread cannot be resumed and that a new thread reuses its recorded steps
