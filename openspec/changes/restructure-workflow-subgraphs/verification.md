# Verification

## Task 1.1: stage subgraphs

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test` | Passed on the final source: 489 tests, 489 passed, 0 failed, 0 skipped (exit 0). This run includes the graph, diagnosis, repair, widening and loop graph tests and the new stage tests. |
| `npm run openspec:validate` | Passed strict validation (see the final run below). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built or launched. |

An earlier `npm run workflow:test` in a restricted session failed before running any test (Node reported `spawn EPERM` for the test workers); that was an execution failure of the environment and is superseded by the passing run above, made in an environment that can spawn them.

The graph tests that existed before this change keep their assertions about steps, outcomes and resumption. The two tests of the older checkpoint format (resuming a thread stored after triage, and the repeated sends of an unrefused older thread) were replaced by the refusal test, since a thread stored by the flat graph is now refused.

New tests and behavior:

- `graph.test.ts`, the drawing with `xray`: the workflow graph has the six stage IDs from the exported constant. `getSubgraphsAsync()` lists the exact inner nodes of every stage (`start`: `build`; `capture`: `route_cases`, `capture`, `compare`, `triage`, `inventory`; plus the inner nodes of `diagnose`, `repair`, `widen` and `conclude`). LangGraph renders a single-node subgraph (`start`, `conclude`) as that inner node under the stage ID in xray.
- `graph.test.ts`, the fan-out seen from outside: while case `c` is captured on one lane, `getState(config, { subgraphs: true })` returns the capture stage in a `capture:<task>` namespace, its pending `compare` and `capture` tasks, and `pendingCaseIndexes: [1, 2]` in that stage's state. The route node writes the indexes alongside routing, so the task args are visible through the state API without reading the checkpoint tuple.
- `diagnosis-graph.test.ts` and `widening-graph.test.ts` cover interrupted runs resumed from inside the `diagnose` and `widen` stages. Both pass in the full run above.
- `graph.test.ts`, the refused flat thread: flat checkpoints stopped at build, capture and inventory are rejected with status 3; the error explains that a new thread reuses the recorded steps, and no misleading resume command is printed.

## Task 2.1: docs

`AGENTS.md` (Parity workflow) describes the six stages, what each holds, the exported `stageIds`, the routing as edges of the workflow graph, the fan-outs in their stage's checkpoint namespace, the drawing with `xray` and `getState` with subgraphs, and the refused resume of a thread checkpointed before the workflow graph had stages. `README.md` names the stages and what they show in a run's checkpoints, task stream and drawing.

| Command | Result |
| --- | --- |
| `npm ci` | Installed the dependencies in a fresh checkout (exit 0); the first `npm run workflow:typecheck` before it failed with `error TS2688: Cannot find type definition file for 'node'.` because `node_modules` was missing. |
| `npm run workflow:typecheck` | Passed (exit 0). |
| `npm run workflow:test` | Passed: 492 tests, 492 passed, 0 failed, 0 cancelled, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation (exit 0). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built or launched. |

## Fixture-tested scope

Graph tests use fake steps and model jobs with an in-memory checkpointer. The flat graph that stores the refused threads is a test copy (`flat-graph.ts`).

## Live evidence

None. No capture, compare or app behavior changes, and no live run was made.

## Unverified

A live `npm start` through the stages, and the stage namespaces in its checkpoints, are not covered here.
