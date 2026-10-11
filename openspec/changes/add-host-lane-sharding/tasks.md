# Tasks

## 1. Lanes and the pool

- [x] 1.1 Declare `lanes` in the profile and run desktop commands on the first free lane of a lane pool, with a non-blocking attempt on the desktop lock and `cpu` commands that name a lane. Evidence: workflow tests for the profile rules, the pool's choice, its wait and its stop, and the existing lock tests.

## 2. Lane agent

- [x] 2.1 Add the lane agent (`npm run lane-agent`) and the workflow's dispatch to it, with hand-over files under `out/workflow/lane-scratch/` and the stop of stray apps limited to the current session. Evidence: workflow tests with a real agent loop on a temporary folder for a request's output and status, a cancel, a restart with an unfinished request, a missing working folder, a silent agent and a second agent on a busy folder.

## 3. Distinct lanes, one environment

- [x] 3.1 Check the lanes' hosts and users before their first command and read the environment fingerprint on every lane. Evidence: workflow tests for two lanes of one user, differing fingerprints and a common fingerprint.

## 4. Sharded capture

- [x] 4.1 Route capture and compare through `route_cases`, capturing one case per lane per step. Evidence: graph tests for one lane (the existing pipeline tests), three cases on two lanes, `--only capture`, a failing capture beside another and a resumed thread.

## 5. Rider dispatch adapter

- [x] 5.1 Start a lane's agent through Rider's `execute_run_configuration` and add the `Lane agent` run configuration. Evidence: workflow tests against a fake MCP server for a started agent, a tool error, a result with an exit code, an event-stream response and an agent that never starts.

## 6. Docs

- [x] 6.1 Document lanes, the lane agent and the Rider adapter in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck` and every workflow test file pass (recorded in `verification.md`).

## 7. Verification and archive

- [x] 7.1 Run `npm start` live on the default lane and live with an agent lane serving the captures, with a deliberate kill and resume; record in `verification.md` the canonical hash before and after, execution outcomes apart from visual results, which sides came from the cache, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 7.2 Archive the change with `openspec archive add-host-lane-sharding`. Evidence: `npm run openspec:validate` passes after the archive.
