## ADDED Requirements

### Requirement: The profile declares the desktop lanes
The local workflow profile MAY declare `lanes`, a list of 1 to 8 lanes, each with a unique `name` of lower-case letters, digits and hyphens, an optional `agent` folder and an optional `rider` entry (`endpoint`, `rootFolder`, `configuration`). A lane without `agent` SHALL be this machine's interactive desktop, locked by `%LOCALAPPDATA%\ChummerGenSR4\desktop-lane.lock`; a lane with `agent` SHALL be served by a lane agent watching that folder and locked by `lane.lock` in it. Without `lanes` the workflow SHALL use one lane, `desktop`, on this machine's desktop. A profile with two lanes without `agent`, two lanes with the same name or the same agent folder, or `rider` without `agent` SHALL be invalid, which is a setup error.

#### Scenario: No lanes declared
- **WHEN** `npm start` runs with a profile without `lanes`
- **THEN** every desktop command runs on this machine's desktop under `%LOCALAPPDATA%\ChummerGenSR4\desktop-lane.lock`

#### Scenario: Two local lanes
- **WHEN** the profile declares two lanes without `agent`
- **THEN** the run ends with status 3 naming the profile before anything is built

### Requirement: A desktop command takes the first free lane
Each lane SHALL have its own lock with the rules of the desktop lane (exclusive creation, heartbeat, takeover of a dead or silent owner on the same host, and of an owner on another host whose lock this process has seen unchanged for the stale time, release only with the own token). A desktop command SHALL take the first lane, in profile order, whose lock it gets, print the lane's name with the command's label, run there and release that lane's lock afterwards. When every lane is held it SHALL wait, printing once per lane whom it waits for unless the holder is another command of the same process, and the wait SHALL end when the run is stopped. A `cpu` command that names a lane SHALL run on that lane's machine without taking its lock, in the CPU pool when the lane is local.

#### Scenario: Two lanes, two captures
- **WHEN** two desktop commands start together and the profile declares two free lanes
- **THEN** each runs on its own lane at the same time

#### Scenario: Every lane held
- **WHEN** a desktop command starts while another run holds each lane
- **THEN** it waits, names each lane's owner once, and runs on the first lane that is released

### Requirement: A lane agent serves a lane through its folder
`npm run lane-agent -- --folder <dir>` (or `LANE_AGENT_FOLDER`) SHALL serve the lane of that folder: it SHALL write `agent.json` with its host, user, process ID and a token and refresh its modification time every 5 seconds, run each request of `requests/` in the request's working folder with its command and arguments, write the child's output to the request's log and then its exit (`exited` with the status, `signal`, `failed` with a message, or `stopped`) to the request's exit file under a temporary name renamed into place. A desktop request SHALL first take the desktop lock of the agent's own session. A request whose working folder does not exist SHALL fail with a message naming it. A cancel file SHALL stop the request's process tree and, for a desktop request whose command has started, the apps started from that working folder's `out/runs/` in the agent's session, and SHALL end the request as `stopped`; a desktop request still waiting for the session's lock SHALL stop no app. A log that cannot be written SHALL stop the command and fail the request. The files of a request whose exit no workflow collects within 10 minutes SHALL be removed. An agent SHALL refuse a folder whose `agent.json` it sees change within 30 seconds, and SHALL fail every request without an exit file that it finds when it starts. Stopping the agent SHALL stop its children, fail their requests and remove its own `agent.json`.

#### Scenario: A capture through the agent
- **WHEN** a desktop command is sent to an agent lane
- **THEN** the agent runs it in its session under its session's desktop lock, the workflow prints its output with the command's label, and the command's status is the child's exit status

#### Scenario: Agent restarted while a request ran
- **WHEN** an agent stops while it runs a request and is started again on the folder
- **THEN** the request's exit is `failed`, and the workflow that sent it fails with a setup error

#### Scenario: Path not visible on the lane
- **WHEN** a request's working folder does not exist on the agent's machine
- **THEN** the request fails with a message naming the folder, and the workflow ends with status 3

### Requirement: The workflow dispatches to an agent and stops what it started
Before a request, the workflow SHALL require the lane's agent to be running (its `agent.json` seen by this process to change within 30 seconds, judged by this process's clock alone, whatever time the file shows) with the host and user the lanes were checked with; otherwise it SHALL start the agent through the lane's `rider` entry or fail with a setup error saying how to start it. It SHALL write the request under a temporary name renamed into place, print the log's new lines with the command's label, return the status of an `exited` exit, treat `signal`, `failed` and `stopped` as setup errors, and remove the request's files once the exit is read. When the run is stopped it SHALL write the request's cancel file and wait up to 60 seconds for its exit, then fail with a setup error. When the agent's heartbeat gets older than 30 seconds while a request runs, it SHALL write the cancel file and fail with a setup error saying the command may still be running. Hand-over files of desktop commands SHALL be created under `out/workflow/lane-scratch/`, so a lane reads them at the same path.

#### Scenario: Ctrl+C during a capture on an agent lane
- **WHEN** Ctrl+C is pressed while a capture runs on an agent lane
- **THEN** the cancel file is written, the agent stops the runner and the apps it started, the lane is released and the run exits with status 3 printing the thread to resume

#### Scenario: Agent stops answering
- **WHEN** the agent's heartbeat stops while it runs a request
- **THEN** the workflow fails with a setup error naming the lane after 30 seconds without a heartbeat

#### Scenario: Agent not running
- **WHEN** a lane's agent is not running and the lane has no `rider` entry
- **THEN** the run ends with status 3 naming the lane and the `npm run lane-agent` command for its folder

### Requirement: Lanes are distinct desktops with one environment
Before its first command on any lane, the workflow SHALL check that no two lanes have the same host and user (the local lane: this process's; an agent lane: its `agent.json`'s), compared without case, and SHALL otherwise end with a setup error naming both lanes. The capture runner's environment fingerprint SHALL be read on every lane, and lanes whose fingerprints differ SHALL end the run with a setup error listing each lane's fingerprint; otherwise their common fingerprint SHALL key capture steps and SHALL be the fingerprint that widening and discovery compare with the thread's.

#### Scenario: Agent in the workflow's own session
- **WHEN** the profile declares a local lane and an agent lane whose agent runs on this host under the same user
- **THEN** the run ends with status 3 naming both lanes before anything is captured

#### Scenario: Lanes with different screens
- **WHEN** one lane's screen scale differs from another's
- **THEN** the run ends with status 3 listing both lanes' fingerprints, and no capture step is keyed or recorded

### Requirement: Cases are captured on every lane at once
After the build, the graph SHALL send a capture for each of the next uncaptured planned cases, as many as there are lanes, and with them a compare for every captured case not yet compared, until every case is captured and compared; then triage runs as before. A thread stored before this SHALL resume with its recorded captures and compares and capture only the rest.

#### Scenario: Three cases on two lanes
- **WHEN** `npm start` runs three cases with two lanes
- **THEN** cases 1 and 2 are captured in one step, case 3 is captured while cases 1 and 2 are compared, and triage runs after case 3 is compared

#### Scenario: One lane
- **WHEN** `npm start` runs three cases with one lane
- **THEN** case 1 is compared while case 2 is captured, and case 2 while case 3 is captured

### Requirement: Rider starts a lane agent through a run configuration
When a lane with a `rider` entry is needed and its agent is not running, the workflow SHALL open a session with the Rider MCP endpoint and call `execute_run_configuration` with the entry's `configuration` and `rootFolder`, `waitForExit: false` and the environment variable `LANE_AGENT_FOLDER` set to the lane's folder, then wait up to 180 seconds for the agent's heartbeat. An unreachable endpoint, a tool error, an unreadable response, a result with an exit code, or an agent that does not start in time SHALL be a setup error with what Rider returned. The repository SHALL hold a `Lane agent` run configuration that runs `npm run lane-agent`.

#### Scenario: Agent started by Rider
- **WHEN** a lane's agent is not running and its `rider` entry names an open project and the `Lane agent` configuration
- **THEN** the workflow starts the configuration through the endpoint, waits for the agent's heartbeat and sends its request

#### Scenario: The configuration ends at once
- **WHEN** Rider's result for the configuration has an exit code
- **THEN** the run ends with status 3 with the output Rider returned
