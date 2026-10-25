# Proposal

## Why

Four workflow tests fail now and then when the machine is busy, each on its own, with nothing wrong in the code they test: they wait a fixed time and assume something has happened by then, or measure a deadline on the real clock while the work before it takes longer than usual. Each such failure makes a full `npm run workflow:test` run fail, on CI and on a developer's machine, and has to be told apart from a real failure by hand.

## What Changes

- **The repair deadline test** runs the repair service on a clock that stands still, so only the build, which hangs, runs into the 180 ms deadline; and it stops the second run once its build is running instead of after 100 ms, when the job before it may still be running.
- **The host stop test** stops each command once its process has started (the test counts the processes its spawn function started) instead of after 200 ms, when a busy machine may not have started it yet.
- **The lane agent retention test** waits for the agent to log the removal as well as for the request folder to be empty: the agent removes the request's files together and logs once all are gone, so a reader may see the empty folder a moment before the log line.
- **The lane agent heartbeat test** that failed once could not be reproduced (30 runs of it, six at a time). Its assertion now names the error it got, so a further failure shows which way the run was refused instead of only that the message did not match.

Nothing the tests assert is loosened or skipped, and no workflow code changes. Area: the workflow's tests (`workflow/tests/`). Evidence: each changed test passes alone and the whole suite passes repeatedly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None (only tests change).

## Impact

- Edited: `workflow/tests/repair-service.test.ts`, `workflow/tests/host.test.ts`, `workflow/tests/lane-agent.test.ts`.
