## ADDED Requirements

### Requirement: npm run dashboard serves the loop dashboard locally
`npm run dashboard` SHALL serve the dashboard on 127.0.0.1 only, on `--port` (default 4318), until Ctrl+C, and print its address. It SHALL bundle the page's React client with esbuild when it starts, and a bundle that fails to build or a port it cannot listen on SHALL end it with status 3 and the error. The page SHALL load nothing from the network. Every request SHALL name the server by its loopback address and, when the browser sends an origin, come from a page of this server; any other request SHALL be refused with 403.

#### Scenario: Started
- **WHEN** `npm run dashboard` runs with port 4318 free
- **THEN** it prints `http://127.0.0.1:4318/` and the page loads from it

#### Scenario: Another site's page
- **WHEN** a page of another origin sends a request to the dashboard
- **THEN** the request is refused with 403 and nothing is written

### Requirement: The page shows the loop's stages and each graph's own drawing
The page SHALL draw the stages start thread, capture and compare, discovery, diagnose, repair, widen, conclude and tune, with the decisions "any difference?" and "anything changed?" and the loop back to the next thread. A stage SHALL be the workflow's subgraph of that stage ID (the loop graph's `tune` node for tune), and each stage SHALL list the nodes LangGraph reports inside it. For each graph, the page SHALL also show LangGraph's own Mermaid drawing of the compiled graph with its subgraphs (`getGraphAsync({ xray: true })` and `drawMermaid()`), unchanged except that running nodes are marked. The graphs SHALL be compiled with inert steps, and the dashboard SHALL NOT run a node.

#### Scenario: A stage without a box
- **WHEN** the workflow exports a stage ID that the loop diagram has no box for
- **THEN** the workflow test of the stage view fails naming the stage ID

#### Scenario: The node view
- **WHEN** the page shows the workflow graph's drawing while a repair task runs
- **THEN** the drawing has a subgraph for each stage drawn by LangGraph, and the repair node inside the repair subgraph is marked

### Requirement: The page shows what runs now from LangGraph's state
For each thread that may be running, the dashboard SHALL read the thread's state with `getState()` on its graph's checkpoints, with the running stages' own states (`subgraphs: true`): a task of the next step without a result, an error or an interrupt is running since the checkpoint's creation, and a task with an interrupt is paused. A pushed task's case or cluster SHALL be read from the checkpoint's pending send, and a capture's lane from the loop's state. The threads that may be running SHALL be the loop's threads that have not ended; without a loop, the dashboard SHALL list the threads with pending tasks and say that it cannot tell a running thread from an interrupted one. Each stage with running tasks SHALL be highlighted with their count, and the page SHALL list each running and paused task with its graph, thread, node, case or cluster, lane and time running. A thread whose state cannot be read SHALL be listed as an error with the message, not left out.

#### Scenario: Two cases and a repair running
- **WHEN** a workflow thread of the loop captures one case, compares another and repairs a cluster
- **THEN** capture and compare shows 2 running and repair shows 1 running, with each case name, the cluster and the lane of the capture

#### Scenario: Unreadable checkpoints
- **WHEN** a graph's checkpoint file cannot be opened
- **THEN** the page shows an error naming the file and the message, and no stage of that graph shows a running count

### Requirement: The page shows each stage's stats
For each stage the page SHALL show the p80 duration of its tasks: the nearest-rank 80th percentile of the finished tasks of the stage in the loop's activity log (by each line's `stage`), each lasting from start to finish less its paused time, routing nodes left out; when the log has no task of the stage, of the durations of its eval records (hypothesis and challenge for diagnose, repair for repair, rank and scenario for discovery, tune for tune), naming that source; else none. It SHALL show these counts, over the loop's threads, or over every workflow and discovery thread without a loop: threads started; discrepancies, clusters and new clusters from the threads' triage totals; scenarios run and discoveries made (scenario records labelled `proven`); hypotheses made, by check outcome; repair tries, rejected tries, and rejected tries per hypothesis (repair records grouped by thread and cluster), mean and maximum; widenings, promotions, and the mean number of widenings of the groups that ended without a promotion (widenings before rejection); fixes merged and merges failed from the threads' outcomes; and tunings run. A stat without data SHALL be shown as missing, never as zero, and a document or store that cannot be read SHALL be shown as an error with its path and message.

#### Scenario: p80 from the activity log
- **WHEN** the activity log holds five finished repair tasks of 4, 6, 8, 10 and 30 minutes, one of them paused for 2 minutes of its 10
- **THEN** the repair stage shows a p80 of 8 minutes from the activity log

#### Scenario: Fallback to record durations
- **WHEN** the activity log has no diagnose task and the store holds hypothesis and challenge records
- **THEN** the diagnose stage shows the p80 of their durations and names the eval records as its source

#### Scenario: Rejections per hypothesis
- **WHEN** one cluster of a thread has three repair records, two rejected, and another cluster has one passed record
- **THEN** the repair stage shows 2 rejected of 4 tries, 1 rejected try per hypothesis on average and 2 at most

#### Scenario: Unreadable triage
- **WHEN** a thread's `triage.json` does not match its schema
- **THEN** the page shows an error naming the file, and the discrepancy count says it leaves that thread out

### Requirement: The page pauses and resumes the loop and each lane
The page SHALL show the loop's status (`running`, `pausing` while paused with tasks still running, `paused`, `ended`, or `stale` when its state is older than 30 seconds and the loop has not ended) and, for each desktop lane, whether it is paused and the task it runs. A pause or resume of the loop or of one lane SHALL write the loop's control file atomically with the loop driver's writer, keeping the other flags, and SHALL require the token of the page that showed the button. A control for an ended loop, for an unknown loop or for a lane the loop does not have SHALL be refused with an error message and SHALL write nothing. The dashboard SHALL NOT stop, start or resume a thread in any other way.

#### Scenario: Pause the loop
- **WHEN** the loop is running a capture and a repair and the user presses Pause loop
- **THEN** the control file says the loop is paused and the page shows it as pausing until both tasks have finished, then as paused

#### Scenario: Pause a lane
- **WHEN** the user presses Pause lane on lane `vm` while it captures a case
- **THEN** the control file says lane `vm` is paused, the loop's other flags are unchanged, and the page shows the lane as pausing after its capture

#### Scenario: A control without the token
- **WHEN** a control request lacks the page's token
- **THEN** it is refused with 403 and the control file is unchanged
