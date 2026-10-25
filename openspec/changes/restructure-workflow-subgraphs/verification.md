# Verification

## Task 1.1: stage subgraphs

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed after adding pending case indexes to the capture stage state. |
| `npm run workflow:test` | Failed to start test workers: Node reported `spawn EPERM`. This is an execution failure and does not establish the task's named full-suite evidence. |
| `node out/workflow-test-build/workflow/tests/graph.test.js` | 21 tests, 21 passed, 0 failed. This test file was compiled from the current TypeScript sources with `npx tsc -p workflow --noEmit false --outDir out/workflow-test-build --rootDir .` to avoid the blocked `tsx` esbuild worker. |
| `npm run openspec:validate` | Passed strict validation after the verification and task-status edits: 23 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built or launched. |

The prescribed `workflow:test` runner could not spawn its workers. A serial compiled-JS attempt was also tried, but it is not equivalent to the repository test command: tests that depend on repository-relative assets or child Git/process launches failed in that setup. In particular, that workaround did not verify the full diagnosis, repair, widening or loop graph suites. No such failures are represented as passes.

New tests and behavior:

- `graph.test.ts`, the drawing with `xray`: the workflow graph has the six stage IDs from the exported constant. `getSubgraphsAsync()` lists the exact inner nodes of every stage (`start`: `build`; `capture`: `route_cases`, `capture`, `compare`, `triage`, `inventory`; plus the inner nodes of `diagnose`, `repair`, `widen` and `conclude`). LangGraph renders a single-node subgraph (`start`, `conclude`) as that inner node under the stage ID in xray.
- `graph.test.ts`, the fan-out seen from outside: while case `c` is captured on one lane, `getState(config, { subgraphs: true })` returns the capture stage in a `capture:<task>` namespace, its pending `compare` and `capture` tasks, and `pendingCaseIndexes: [1, 2]` in that stage's state. The route node writes the indexes alongside routing, so the task args are visible through the state API without reading the checkpoint tuple.
- `diagnosis-graph.test.ts` and `widening-graph.test.ts` cover interrupted runs resumed from inside the `diagnose` and `widen` stages. Full results remain unverified in this session because the prescribed test command could not run.
- `graph.test.ts`, the refused flat thread: flat checkpoints stopped at build, capture and inventory are rejected with status 3; the error explains that a new thread reuses the recorded steps, and no misleading resume command is printed.

## Fixture-tested scope

Graph tests use fake steps and model jobs with an in-memory checkpointer. The flat graph that stores the refused threads is a test copy (`flat-graph.ts`).

## Live evidence

None. No capture, compare or app behavior changes, and no live run was made.

## Unverified

The full `workflow:test` result, including diagnosis, repair, widening and loop graph tests, remains unverified because Node cannot spawn the test workers in this environment. A live `npm start` through the stages and stage namespaces in its checkpoints are also not covered here.
