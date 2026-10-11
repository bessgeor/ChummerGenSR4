# Design

## Context

The host runner runs every child process under a resource: `cpu` (a pool inside the process) or `desktop` (a lock file in the user's local application data, held for the whole command and refreshed while held). Every capture runner call goes through `runCaptureRunner`, which hands the runner a scratch file to report its run folder, and every capture step is keyed by the capture runner's environment fingerprint, read by a `cpu` command before the step. The graph captures one planned case per step and compares it in the next step while the next case is captured.

A capture needs an interactive desktop: the runner activates windows, parks the pointer and reads pixels. A second desktop exists only in another Windows session (another user signed in through Remote Desktop on a host that allows it) or on a virtual machine. Neither can be reached by starting a child process here.

## Goals / Non-Goals

**Goals:**

- Use several desktops at once when the profile declares them, and behave exactly as today when it does not.
- Reach a desktop in another session or machine through something both sides already share: a folder.
- Never mix pixels of different environments under one step key or cache entry.
- Keep every failure a failure: a lane that cannot be reached, an agent that stops answering or a lane that differs is a setup error, never a silent fallback to fewer lanes.

**Non-Goals:**

- No provisioning of sessions or virtual machines, no remote shell, no copying of the repository: a lane must see the repository and every path a command names at the same absolute path.
- No sharing of one capture runner call between lanes: a check, a narrow check, a widening level or a discovery run stays one call on one lane, since their documents describe one run.
- No change to the capture runner, the comparer or the contracts.

## Decisions

### Lanes in the profile

`lanes` is a list of 1 to 8 entries `{ name, agent?, rider? }`:

- `name`: lower-case letters, digits and hyphens, unique.
- Without `agent`, the lane is this machine's interactive desktop, and its lock is `%LOCALAPPDATA%\ChummerGenSR4\desktop-lane.lock`, the lock every earlier run takes. At most one lane may omit `agent`.
- With `agent` (a folder, unique across lanes), the lane is served by a lane agent watching that folder, and its lock is `lane.lock` in that folder, so every workflow on every machine that uses the lane takes the same lock.
- `rider` (`endpoint`, `rootFolder`, `configuration`) is allowed only with `agent` and names how to start that agent (see below).

Without `lanes` the profile means `[{ "name": "desktop" }]`. A profile that breaks these rules is invalid, which is a setup error as before.

### The lane pool

The desktop lock keeps its rules (exclusive create, heartbeat, takeover of a dead or silent owner on the same host, release only with the own token) and gains a single non-blocking attempt. An agent lane's `lane.lock` may belong to a workflow on another host, whose process cannot be checked and whose clock may differ: such a lock is taken over once the waiter has seen it unchanged (same token, same modification time) for the stale time by its own clock. The pool tries the lanes in profile order, takes the first one it gets and otherwise waits a poll interval and tries again; each lane announces its owner once while the pool waits for it (not when the owner is another command of the same process), and the wait ends when the run is stopped. The host runner prints which lane a desktop command got (`[<label>] on desktop lane <name>`), then runs it: locally for the lane without `agent`, through the agent otherwise. A `cpu` command may name a lane: it then runs on that lane's machine without its lock (locally in the CPU pool for the local lane), which is how the environment fingerprint is read on every lane.

### The lane agent and its protocol

The folder holds:

- `agent.json` — host, user, process ID, start time and a token, written when the agent starts. The agent refreshes its modification time every 5 seconds; the workflow counts an agent as running only while it sees the file's modification time change, within 30 seconds by its own clock: the agent may set that time on another machine's clock, so its value is never compared with the workflow's. A file seen for the first time is watched until it changes, for at most 30 seconds.
- `requests/<id>.json` — `{ id, label, command, args, cwd, desktop }`, written to a temporary name and renamed, so the agent never reads half a request.
- `requests/<id>.log` — the child's standard output and error as the agent receives them.
- `requests/<id>.exit.json` — `exited` with the status, `signal`, `failed` with a message, or `stopped`; written to a temporary name and renamed after the log is complete.
- `requests/<id>.cancel` — written by the workflow to stop a request.

The workflow checks that the agent runs and that its host and user are the ones the lanes were checked with, writes the request, then polls every 200 ms: it prints new log lines with the label prefix, reads the exit file when it appears and removes the request's files. `exited` returns the status as a local child would; `signal`, `failed` and `stopped` are setup errors, like a local child that cannot start or ends from a signal. When the run is stopped it writes the cancel file and waits up to 60 seconds for the exit file; when the agent's heartbeat gets older than 30 seconds while a request runs, it writes the cancel file and fails with a setup error that says the command may still be running.

The agent polls the folder every 200 ms and runs requests side by side: a desktop request takes the desktop lock of the agent's own session (the same file a local workflow of that user would take) before it starts, so a local run in that session and the agent never drive the desktop together, and waiting for it ends when the request is cancelled. A request whose working folder does not exist on the agent's machine fails with a message naming it, since every path a command names must be the same on both sides. A cancel kills the child's process tree and, for a desktop request whose command has started, the apps started from `out/runs/` of that working folder in the agent's session; a request still waiting for the session's lock has started no app, and the apps there belong to the lock's holder. A log that cannot be written stops the child and fails the request. The agent removes the files of a request whose exit no workflow collected within 10 minutes: its workflow was killed or gave up. When the agent starts it refuses a folder whose `agent.json` it sees change within 30 seconds, and fails every request it finds without an exit file: the workflow that sent it has either gone or will see the failure. Ctrl+C stops the agent's children the same way, writes `failed` for them and removes `agent.json` if it is still its own.

A desktop command's hand-over files (the run folder file of the capture runner, the environment fingerprint file) are created under `out/workflow/lane-scratch/` instead of the system's temporary folder, so an agent on another machine reads and writes them at the same path. Other scratch folders, such as the sealed copies of model jobs, stay outside the repository.

### One environment, distinct desktops

Before the first command on any lane, the host runner checks the lanes' identities: the local lane is this process's host and user, an agent lane the host and user in its `agent.json`. Two lanes with the same host and user (compared without case) are a setup error naming both, because one Windows user on one host has one desktop session per sign-in and one set of the app's registry options; the check also catches an agent started in the workflow's own session beside a local lane.

`readEnvironmentFingerprint` runs the capture runner's fingerprint command on every lane (as `cpu` commands that name the lane, side by side) and requires the same fingerprint from each; otherwise it ends with a setup error listing each lane's fingerprint. The common fingerprint keys the capture step as before, and widening and discovery, which compare the thread's fingerprint with a new reading, compare the lanes' common one. With one lane nothing changes but where the fingerprint file is written.

### Sharded capture in the graph

Capture and compare return to a router node, `route_cases`, through plain edges, so it runs once after each step with all of the step's writes. It sends a compare for every captured case not yet compared (unless compare is skipped) and a capture for each of the next uncaptured planned cases, as many as there are lanes, and routes to triage when every case is compared (or ends the graph when triage is skipped and nothing is left). With one lane this is the pipeline of today: case k is compared while case k+1 is captured. With n lanes a step captures n cases at once and compares the n captured in the step before; a step lasts as long as its slowest capture. A capture that fails ends the run as before, and the checkpoint keeps the captures of the same step that finished. A thread stored before the router existed resumes into it: the router decides only from the captures and compares the state holds.

`WorkflowSteps` gains `captureLanes`, the number of lanes of the host runner.

### Rider dispatch adapter

A lane's `rider` names a Rider MCP endpoint (`http://127.0.0.1:<port>/stream`), the project folder Rider has open (`rootFolder`) and a run configuration (`configuration`, normally `Lane agent`). When the workflow needs the lane and its agent is not running, it starts a session with the endpoint (`initialize`, then `notifications/initialized`, with the `mcp-session-id` header the server returns) and calls `execute_run_configuration` with the configuration's name, the root folder, `waitForExit: false` and the environment variable `LANE_AGENT_FOLDER` set to the lane's folder. A tool error, a response that is neither JSON nor an event stream with the call's response, or a result with an exit code (the agent ended at once) is a setup error with the output Rider returned; otherwise the workflow waits up to 180 seconds for the agent's heartbeat. The adapter only starts the agent: requests always go through the folder, so a stop, a cancel and the output work the same way whoever started the agent. The `Lane agent` run configuration runs `npm run lane-agent`, which reads the folder from `--folder` or `LANE_AGENT_FOLDER`.

### Stray apps

The stop of apps that a stopped capture left running now matches only processes of the current Windows session. A local stop then never reaches the apps of an agent running in another session of the same machine, and an agent's stop never reaches the workflow's.

### What fixture tests prove and what only a live run can

Fixture tests prove the profile rules, the pool's choice and waiting with real lock files, the agent protocol with a real agent loop on a temporary folder (request, output, exit, cancel, restart, a missing working folder, a silent agent), the identity and environment checks with fake lanes, the router's sends for one and several lanes and a resumed thread, and the Rider adapter against a local fake MCP server. Only a live run shows that a capture runner call dispatched through an agent captures real windows and that the default lane still runs a thread as before. Several desktops capturing at once needs a second interactive session or a virtual machine; where none is available, that remains unverified.
