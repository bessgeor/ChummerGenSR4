# Verification

All evidence below was collected on the commit "Judge lane agents by observed heartbeats and stop only started requests", the last implementation commit of the change; only this file and the archive follow it.

## Fixture-tested scope

- `npm run workflow:typecheck`: passed.
- `npm run workflow:test`: 466 tests, 466 passed, 0 failed. This includes:
  - `lanes.test.ts`: the profile rules, the pool's lane choice, two commands on two lanes at once and a third that waits, the stop of a wait, lanes of one user on one host, differing and common environment fingerprints, `cpu` commands that name a lane.
  - `lane-agent.test.ts`: a real agent loop on a temporary folder: a request's output, status and removed files; a desktop request waiting for the session's lock (and its cancel, which stops no app); a cancel of a running request (which stops the apps of its working folder); a missing working folder; an agent stopped while it runs a request and a restarted agent failing the request it finds; a second agent refused on a busy folder; a silent agent; an agent started through the lane's starter and one that never starts; an agent that now runs as another user; an agent whose file's time is years behind or ahead of the workflow's clock (running exactly while its file changes); the removal of an answered request no workflow collects.
  - `host.test.ts`: the lock rules, including a lock of another host taken over only after this process saw it unchanged for the stale time (with the other host's clock years behind) and no wait line when the holder is the same process.
  - `graph.test.ts`: the one-lane pipeline, three cases on two lanes, `--only capture`, a failing capture beside another and a resumed thread.
  - `rider-dispatch.test.ts`: a fake MCP server for a started agent, a tool error, a result with an exit code, an event-stream response and an agent that never starts.
- `npm run contracts:check`: `Generated contracts are up to date (14 files).` No schema changed.
- `npm run parity:test`: `Parity.Hosted.Tests` 13 passed, `Parity.Tests` 318 passed, 0 failed. The change touches no parity code.
- `npm run openspec:validate`: 17 passed, 0 failed (strict).

## Live evidence

The canonical `bin/ChummerGenSR4.exe` SHA-256 was `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before the first and after the last run below, and each capture run printed the same value before and after (staged copy included).

Every run used `--case Diego_v_alpha2_by_bessgeor,rigger --capture common --settings-overlay out/overlays/fixture-books --no-diagnosis --recapture --canonical-cache <shared cache outside the repository>` (overlay: `bin/settings/default.xml` with the books `AGENTS.md` lists). In every run both canonical sides came from the shared cache (entries stored by earlier runs of the same inputs) and both candidate sides ran live. The change does not touch how a canonical side is captured.

### Default lane (no `lanes` in the profile)

- Thread `wf-20261011T200216Z-3c19a406`, exit 0. Both captures printed `on desktop lane desktop`.
- Execution: `build-Diego_v_alpha2_by_bessgeor` (run `20261011T200221Z-1e13d50d`) and `build-rigger` (run `20261011T200335Z-efdd8017`): capture status 0, coverage valid (contiguous, 0 failures; 6 and 4 optional absent).
- Visual: each 1 row passed, 0 failed; compare `clear (exit 0)`, 0 discrepancies in 0 groups; completeness 16 planned, 1 reported, 15 filtered, 0 analysis-failed, 0 optional absent, 0 execution lost, 0 unaccounted. Triage 0 clusters; outcome `verified_for_scope`.

### Agent lane, with a deliberate kill and resume

The profile declared one lane, `{"name":"agent1","agent":"<worktree>/out/lanes/agent1"}`, and `npm run lane-agent -- --folder out/lanes/agent1` served it in this machine's interactive session. The folder still held the `agent.json` of an agent killed earlier; the new agent watched it for about 30 s, saw it unchanged and took the folder.

- Thread `wf-20261011T200539Z-107be1a0`. Every command went through the agent: its log shows each environment fingerprint request and each capture request (`(desktop)`) with its exit, and both captures printed `on desktop lane agent1`. `build-Diego_v_alpha2_by_bessgeor` (run `20261011T200546Z-de65734c`) completed and was compared.
- Kill: while `build-rigger` was being captured (run `20261011T200659Z-a14bee8a`), the workflow's process tree was killed with `taskkill /t /f`; the command exited 1. The capture runner, a child of the agent, was not in that tree and ran on to `exited with 0`; its run is not part of the thread.
- Resume: `npm start -- --resume wf-20261011T200539Z-107be1a0` printed `capture build-rigger: capturing again (--recapture).` and `Taking over desktop lane agent1 from process 26648, which is no longer running.`, and did not capture `build-Diego_v_alpha2_by_bessgeor` again (its capture and compare came from the checkpoint). The new capture request was accepted at 20:07:35 and waited for the session's desktop lock, held by the killed thread's request until 20:08:02; its capture run `20261011T200803Z-2b10e107` started only then. Exit 0.
- Execution: both cases capture status 0, coverage valid (contiguous, 0 failures; 6 and 4 optional absent).
- Visual: each 1 row passed, 0 failed; compare `clear (exit 0)`, 0 discrepancies in 0 groups; completeness 16 planned, 1 reported, 15 filtered, 0 analysis-failed, 0 optional absent, 0 execution lost, 0 unaccounted. Outcome `verified_for_scope`.
- The killed thread's request was never collected, nor was one left by an earlier killed thread. The agent removed both about 10 minutes after it saw their exits (`<id>: removed, its exit was not collected within 10 min.`), and the requests folder was empty afterwards. The agent was then stopped by killing its process tree.
- The agent printed no `Waiting for desktop lane of this session` line for the resumed request: the holder of the session's lock was the agent's own earlier request, which the lock does not announce. The wait shows in the request and run times above.

## Unverified

- Captures on two desktops at once: only one interactive session was available, so no two lanes with distinct host and user pairs could run together. The pool's use of several lanes and the router's sends for several lanes are covered by fixture tests only.
- A lane on another machine: the cross-host lock takeover, the agent liveness check against another machine's clock and paths seen at the same location on another machine are covered by fixture tests only.
- A live Rider dispatch: no Rider instance with an MCP endpoint was running. The adapter's protocol is covered by the fake server tests only.
- A Ctrl+C (rather than a kill) of a workflow while a capture runs on an agent lane, which writes the cancel file: covered by fixture tests only.
- A quota wait: no model job ran in these threads (`--no-diagnosis`).
