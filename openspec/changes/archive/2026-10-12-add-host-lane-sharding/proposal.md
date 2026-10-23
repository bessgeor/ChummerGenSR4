# Proposal

## Why

Every capture run drives real windows, so the workflow holds one machine-wide desktop lane and runs its captures one after another: a thread's cases, a check, the narrow checks of attempts that were repaired side by side, the widening levels and discovery runs all queue for the same desktop. The desktop is the slowest resource of a run, and the only way to get another one is another interactive Windows session or a virtual machine, which the workflow cannot use today.

## What Changes

- **Desktop lanes.** The local profile can declare several desktop lanes (`lanes`). A lane is this machine's interactive desktop or a desktop in another Windows session or virtual machine served by a lane agent. Without `lanes` there is one lane, this machine's desktop, with the lock file it has today. Each lane has a lock of its own; a desktop step takes the first lane that is free and waits, printing whom it waits for, only when every lane is held.
- **Lane agent.** `npm run lane-agent -- --folder <dir>`, started in the other session or machine, serves a lane through a folder both sides can reach: the workflow writes a request (command, arguments, working folder), the agent runs it in its session, streams its output into the folder and writes its exit status; a cancel file stops it with its process tree and the apps it started. The agent refreshes a heartbeat, takes its own session's desktop lock while a desktop command runs, and fails the requests it finds unfinished when it starts.
- **Sharded capture.** The workflow captures as many planned cases at once as there are lanes, and compares each captured case while the next cases are captured. Checks, narrow checks, widening levels and discovery runs take any free lane, so narrow checks of attempts repaired side by side run at the same time.
- **One environment for every lane.** The environment fingerprint that keys capture steps is taken on every lane, and lanes whose fingerprints differ end the run with a setup error, so a recorded step and the canonical cache never mix pixels of different machines. Two lanes on one host under one Windows user are a setup error, because they would share a desktop or the app's settings.
- **Rider dispatch adapter (optional).** A lane can name a Rider MCP endpoint and a run configuration; when its agent is not running, the workflow starts it by executing that run configuration through Rider's `execute_run_configuration` tool and waits for its heartbeat. The repository gets the `Lane agent` run configuration in `.run/`.
- Stopping a run stops the apps that its captures started in the workflow's own Windows session only, so a stop never reaches another lane's session.

Area: the workflow's tooling (`workflow/`), a Rider run configuration and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests for the lane pool, the agent protocol on both sides, the Rider adapter against a fake MCP server, the environment and identity checks and the sharded graph; a live `npm start` run on the default lane and a live run whose captures go through a lane agent, with a deliberate kill and resume, the canonical hash before and after, and execution outcomes apart from visual results.

## Capabilities

### New Capabilities

- `desktop-lanes`: the lanes of the profile, the lane pool, the lane agent and its protocol, the environment and identity checks across lanes, sharded capture and the Rider dispatch adapter.

### Modified Capabilities

- `parity-workflow`: the capture node captures one case per lane per step, host processes share a pool of desktop lanes instead of one, the profile gains `lanes`, and stopped captures stop the apps of the workflow's own session.

## Impact

- New files under `workflow/src/lanes/` and their tests; `.run/Lane agent.run.xml`; the `lane-agent` npm script.
- Edited files: the desktop lane, the host runner, the stray-app stop, the scratch folders of capture runs, the environment fingerprint, the workflow graph and its state, the profile, `main.ts` and `discover-main.ts`; `AGENTS.md` and `README.md`.
- No capture, compare or contract change; canonical cache entries and recorded steps stay valid.
