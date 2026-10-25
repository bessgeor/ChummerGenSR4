# Verification

## Task 1.1: stage subgraphs

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed on the reviewed branch. |
| `node --import tsx workflow/tests/graph.test.ts` | 21 tests, 21 passed, 0 failed, including the xray, capture fan-out, resume and flat-thread tests. |
| `npm run workflow:test` | Failed to start test files: Node's test runner reported `spawn EPERM` for its per-file workers. This is an execution failure; it is not counted as a pass. An earlier run recorded by the prior session on this branch reported 489 tests passed, 0 failed. |
| `npm run openspec:validate` | Passed strict validation: 23 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | Current value is `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the prior session recorded the same value before its test run. The executable was not built or launched. |

New tests, all in `workflow/tests/`:

- `graph.test.ts`, the drawing with `xray`: the workflow graph has the six stage IDs from the exported constant. `getSubgraphsAsync()` lists the exact inner nodes of every stage (`start`: `build`; `capture`: `route_cases`, `capture`, `compare`, `triage`, `inventory`; plus the inner nodes of `diagnose`, `repair`, `widen` and `conclude`). `getGraphAsync({ xray: true })` draws all stage nodes and expands stages with multiple inner nodes. LangGraph represents a stage with one inner node (`start`, `conclude`) by the inner node under the stage ID; the same assertion verifies those one-node subgraphs separately.
- `graph.test.ts`, the fan-out seen from outside: while case `c` is captured on one lane, `getState(config, { subgraphs: true })` returns the capture stage in a `capture:<task>` namespace with its pending `compare` and `capture` tasks. The checkpoint tuple in that namespace supplies their Send payloads because LangGraph's task descriptions omit arguments: `compare` has case index 1 and `capture` has case index 2.
- `diagnosis-graph.test.ts` and `widening-graph.test.ts`: a run killed inside the `diagnose` stage (a challenge job) and inside the `widen` stage resumes from that stage; already finished jobs and levels do not run again. These were included in the earlier 489-test run recorded above.
- `graph.test.ts`, the refused flat thread: flat checkpoints stopped at build, capture and inventory are rejected with status 3; the error explains that a new thread reuses the recorded steps, and no misleading resume command is printed.

## Fixture-tested scope

Tests use fake steps and model jobs with an in-memory checkpointer. The flat graph that stores the refused threads is a test copy (`flat-graph.ts`).

## Live evidence

None for this task. No capture, compare or app behavior changes, and no live run was made.

## Unverified

A live `npm start` through the stages, and the stage namespaces in its checkpoints, are not covered here. The full workflow test suite could not be rerun in this environment because its test runner could not spawn workers (`spawn EPERM`).
