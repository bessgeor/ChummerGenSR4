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

- `graph.test.ts`, the drawing with `xray`: the workflow graph has the seven stage IDs from the exported constant. `getSubgraphsAsync()` lists the exact inner nodes of every stage (`start`: `build`; `capture`: `route_cases`, `capture`, `compare`, `triage`, `inventory`; plus the inner nodes of `discovery`, `diagnose`, `repair`, `widen` and `conclude`). LangGraph renders a single-node subgraph (`start`, `conclude`) as that inner node under the stage ID in xray.
- `graph.test.ts`, the fan-out seen from outside: while case `c` is captured on one lane, `getState(config, { subgraphs: true })` returns the capture stage in a `capture:<task>` namespace, its pending `compare` and `capture` tasks, and `pendingCaseIndexes: [1, 2]` in that stage's state. The route node writes the indexes alongside routing, so the task args are visible through the state API without reading the checkpoint tuple.
- `diagnosis-graph.test.ts` and `widening-graph.test.ts` cover interrupted runs resumed from inside the `diagnose` and `widen` stages. Both pass in the full run above.
- `graph.test.ts`, the refused flat thread: flat checkpoints stopped at build, capture and inventory are rejected with status 3; the error explains that a new thread reuses the recorded steps, and no misleading resume command is printed.

## Task 2.1: docs

`AGENTS.md` (Parity workflow) describes the seven stages, what each holds, the exported `stageIds`, the routing as edges of the workflow graph, the fan-outs in their stage's checkpoint namespace, the drawing with `xray` and `getState` with subgraphs, and the refused resume of a thread checkpointed before the workflow graph had stages. `README.md` names the stages and what they show in a run's checkpoints, task stream and drawing.

| Command | Result |
| --- | --- |
| `npm ci` | Installed the dependencies in a fresh checkout (exit 0); the first `npm run workflow:typecheck` before it failed with `error TS2688: Cannot find type definition file for 'node'.` because `node_modules` was missing. |
| `npm run workflow:typecheck` | Passed (exit 0). |
| `npm run workflow:test` | Passed: 492 tests, 492 passed, 0 failed, 0 cancelled, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation (exit 0). |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built or launched. |

## Task 3.1: live run

Settings overlay: `out/overlays/fixture-books/settings/default.xml`, a UTF-16 copy of `bin/settings/default.xml` with the books `AGENTS.md` lists. Canonical cache: the shared cache outside the repository (`PARITY_CANONICAL_CACHE`). No local workflow profile and no Claude Code or Codex CLI on `PATH`, so the run was chosen so that no model job is dispatched: two passing cases and `--no-discovery`.

SHA-256 of `bin/ChummerGenSR4.exe`: `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before the first run (`Get-FileHash`), in every `Canonical SHA-256 before/after` line the build and the capture runs printed, after the first run and after the last run.

### Thread 1: every stage

`npm.cmd start -- --case "build-Diego_v_alpha2_by_bessgeor,career-facemage_Sam_career" --capture common --settings-overlay out/overlays/fixture-books --no-discovery`, thread `wf-20261026T150517Z-37b1af42`, 4.3 min: `Outcome: verified_for_scope; 0 of 0 clusters fixed, 0 attempts, model time 0.0 min`, `Thread wf-20261026T150517Z-37b1af42 finished: exit 0.`

| Case | Execution | Visual |
| --- | --- | --- |
| `build-Diego_v_alpha2_by_bessgeor` | run `20261026T150528Z-3cd75381`: capture 0, coverage valid (0 failures, 6 optional absent); canonical side live (cache: 0 hits, 1 miss, 1 stored) | `common` PASS (0, within threshold); compare 0 (clear); completeness 16 planned, 1 reported, 15 filtered, 0 analysis-failed, 0 execution-lost, 0 unaccounted |
| `career-facemage_Sam_career` | run `20261026T150713Z-04c6733e`: capture 0, coverage valid (0 failures, 6 optional absent); canonical side live (cache: 0 hits, 1 miss, 1 stored) | `common` PASS (0, within threshold); compare 0 (clear); completeness 23 planned, 1 reported, 22 filtered, 0 analysis-failed, 0 execution-lost, 0 unaccounted |

Triage: 0 discrepancies in 0 clusters, 0 other findings. Inventory: 69 classes (10 active), controls observed 240/1419, interactions exercised 0/873. Diagnosis, repair and widening: 0 clusters, 0 attempts, no accepted branch.

The thread's checkpoints in `out/workflow/checkpoints.sqlite`, read with `better-sqlite3` by the script below (namespace, checkpoints, and the nodes the namespace's writes trigger, `__pregel_tasks` being the `Send` tasks, counted from the `writes` table). Saved as `out/inspect-checkpoints.cjs` (untracked), it ran as `node out/inspect-checkpoints.cjs out/workflow/checkpoints.sqlite wf-20261026T150517Z-37b1af42`; its `parents` field is read from each checkpoint's metadata and printed `(root)` for every stage namespace:

```js
// Lists a thread's checkpoint namespaces with their checkpoints and the nodes their writes trigger.
const Database = require("better-sqlite3");
const [dbPath, threadId] = process.argv.slice(2);
const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare("SELECT checkpoint_ns, checkpoint_id, metadata FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id")
  .all(threadId);
const byNs = new Map();
for (const row of rows) {
  const meta = JSON.parse(Buffer.from(row.metadata).toString("utf8"));
  const entry = byNs.get(row.checkpoint_ns) ?? { checkpoints: 0, steps: [], sources: new Set(), parents: new Set() };
  entry.checkpoints++;
  entry.steps.push(meta.step);
  entry.sources.add(meta.source);
  for (const [ns] of Object.entries(meta.parents ?? {})) entry.parents.add(ns === "" ? "(root)" : ns);
  byNs.set(row.checkpoint_ns, entry);
}
const writes = db
  .prepare("SELECT checkpoint_ns, task_id, channel FROM writes WHERE thread_id = ? ORDER BY checkpoint_ns, checkpoint_id, task_id, idx")
  .all(threadId);
const branches = new Map();
for (const w of writes) {
  const set = branches.get(w.checkpoint_ns) ?? new Map();
  if (w.channel.startsWith("branch:to:") || w.channel === "__pregel_tasks") {
    set.set(w.channel, (set.get(w.channel) ?? 0) + 1);
  }
  branches.set(w.checkpoint_ns, set);
}
const namespaces = [...new Set([...byNs.keys(), ...branches.keys()])].sort();
for (const ns of namespaces) {
  const e = byNs.get(ns);
  const label = ns === "" ? "(root)" : ns;
  console.log(`namespace ${label}`);
  if (e) {
    console.log(`  checkpoints: ${e.checkpoints}, steps ${Math.min(...e.steps)}..${Math.max(...e.steps)}, sources ${[...e.sources].join(",")}, parents ${[...e.parents].join(",") || "-"}`);
  }
  const b = branches.get(ns);
  if (b && b.size) console.log(`  triggers: ${[...b].map(([c, n]) => `${c.replace("branch:to:", "")}×${n}`).join(", ")}`);
}
```

Re-run against the checkpoint file after this change's runs, it prints the table below (for example `capture:0b3d55f4-…`: `checkpoints: 11, steps -1..9, sources input,loop, parents (root)`, `triggers: route_cases×5, __pregel_tasks×4, triage×1, inventory×1`).

| Namespace | Checkpoints | Triggered nodes |
| --- | --- | --- |
| root (`""`) | 8 (steps -1..6) | `start`, `capture`, `diagnose`, `repair`, `widen`, `conclude`, once each |
| `start:8a50ca08-…` | 3 | `build` |
| `capture:0b3d55f4-…` | 11 | `route_cases` ×5, `Send` tasks ×4 (the two cases' `capture` and `compare`), `triage`, `inventory` |
| `diagnose:9ef9f062-…` | 5 | `prepare_diagnosis`, `route_diagnosis`, `finish_diagnosis` |
| `repair:b88ab018-…` | 5 | `prepare_repair`, `route_repair`, `finish_repair` |
| `widen:6467926c-…` | 5 | `prepare_widening`, `route_widening`, `finish_widening` |
| `conclude:9bb6eeec-…` | 3 | `conclude` |

Every stage namespace's checkpoints name the root as their parent. The `discovery` stage was left out by `--no-discovery`, and no namespace for it exists.

### Thread 2: a second run of the same scope

To stop a run inside the `capture` stage, `npm.cmd start -- … --no-discovery --recapture` (same cases, capture and overlay) was started with a kill set to follow the second case's canonical start. Both canonical sides came from the cache, the awaited line never appeared, and the thread `wf-20261026T151913Z-897be54c` ran to the end: exit 0; runs `20261026T151916Z-34e4070b` and `20261026T152006Z-ff770918`, capture 0 with valid coverage, canonical sides from the cache (entries stored by thread 1's runs), `common` PASS and compare 0 for both cases.

### Thread 3: killed inside `capture`, resumed

`npm.cmd start -- --case "build-Diego_v_alpha2_by_bessgeor,career-facemage_Sam_career" --capture common --settings-overlay out/overlays/fixture-books --no-discovery --recapture`, thread `wf-20261026T152732Z-2a3359d4`. After the first case was captured and compared (run `20261026T152736Z-7acf3546`, compare `clear (exit 0)`) and 15 s after the second case's candidate side had started (run `20261026T152826Z-198dd24d`), the process tree was killed with `taskkill /PID <pid> /T /F`; no `ChummerGenSR4` process remained. Run `20261026T152826Z-198dd24d` was left incomplete and is not evidence.

Checkpoints of the killed thread: root (3; `start`, `capture`), `start:a7f2bc4d-…` (3; `build`) and `capture:5c5a069f-…` (5; `route_cases` ×3, `Send` tasks ×3). `getState(config, { subgraphs: true })` on the real checkpoint file printed the output below. The script, saved as `out/inspect-state.ts` (untracked) and run as `node --import tsx out/inspect-state.ts out/workflow/checkpoints.sqlite wf-20261026T152732Z-2a3359d4` before the resume, compiles the workflow graph with steps that are never called:

```ts
// Reads a thread's state with subgraphs from the real checkpoint file; the steps are never called.
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { buildWorkflowGraph } from "../workflow/src/graph/workflow-graph.js";

const [dbPath, threadId] = process.argv.slice(2);
const never = new Proxy({}, { get: () => () => { throw new Error("not called"); } }) as never;
const graph = buildWorkflowGraph(never, never, never, never, never, never).compile({ checkpointer: SqliteSaver.fromConnString(dbPath) });
const config = { configurable: { thread_id: threadId } };
const state = await graph.getState(config, { subgraphs: true });
console.log(`root next: ${JSON.stringify(state.next)}`);
for (const task of state.tasks) {
  console.log(`root task ${task.name} (${task.id})`);
  const inner = task.state as { next: string[]; values: Record<string, unknown>; tasks: { name: string; path?: unknown[] }[]; config: { configurable: Record<string, unknown> } } | undefined;
  if (!inner || !("values" in inner)) continue;
  console.log(`  namespace: ${inner.config.configurable.checkpoint_ns}`);
  console.log(`  next: ${JSON.stringify(inner.next)}`);
  console.log(`  pendingCaseIndexes: ${JSON.stringify(inner.values.pendingCaseIndexes)}`);
  for (const t of inner.tasks) console.log(`  task ${t.name} path ${JSON.stringify(t.path)}`);
}
```

Its output was:

```
root next: ["capture"]
root task capture (5c5a069f-18dc-5ca5-b442-afe4e1d1412b)
  namespace: capture:5c5a069f-18dc-5ca5-b442-afe4e1d1412b
  next: ["capture"]
  pendingCaseIndexes: [0,1]
  task compare path ["__pregel_push",0]
  task capture path ["__pregel_push",1]
```

`npm.cmd start -- --resume wf-20261026T152732Z-2a3359d4` printed `Resuming thread wf-20261026T152732Z-2a3359d4.`, `capture career-facemage_Sam_career: capturing again (--recapture).` and `Taking over desktop lane desktop from process 20696, which is no longer running.`, then captured only the second case (run `20261026T152915Z-937299a0`); the log has no `capture` or `compare` line for the first case, whose finished compare was kept, and the final report names its run `20261026T152736Z-7acf3546`. Exit 0, `Outcome: verified_for_scope`, 2.9 min.

| Case | Execution | Visual |
| --- | --- | --- |
| `build-Diego_v_alpha2_by_bessgeor` | run `20261026T152736Z-7acf3546` (before the kill): capture 0, coverage valid (0 failures, 6 optional absent); canonical side from the cache (entry stored by run `20261026T150528Z-3cd75381`) | `common` PASS; compare 0 (clear); completeness 16 planned, 1 reported, 15 filtered, 0 unaccounted |
| `career-facemage_Sam_career` | run `20261026T152915Z-937299a0` (after the resume): capture 0, coverage valid (0 failures, 6 optional absent); canonical side from the cache (entry stored by run `20261026T150713Z-04c6733e`) | `common` PASS; compare 0 (clear); completeness 23 planned, 1 reported, 22 filtered, 0 unaccounted |

After the resume the thread's checkpoints have the same shape as thread 1's, and the `capture` stage continued in the namespace it was killed in (`capture:5c5a069f-…`, 11 checkpoints).

### Checks

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0). |
| `npm run workflow:test` | Passed: 503 tests, 503 passed, 0 failed, 0 cancelled, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation (exit 0). |

## Task 3.2: archive

| Command | Result |
| --- | --- |
| `npx openspec archive restructure-workflow-subgraphs --yes` | Applied the `parity-workflow` delta (1 added requirement) and archived the change as `2026-10-27-restructure-workflow-subgraphs`. |
| `npm run openspec:validate`, after the archive | Passed strict validation: 21 passed, 0 failed (exit 0). |
| `npm run workflow:typecheck` | Passed (exit 0). |
| `npm run workflow:test` | 517 tests, 517 passed, 0 failed, 0 cancelled, 0 skipped (exit 0). |
| `(Get-FileHash bin/ChummerGenSR4.exe -Algorithm SHA256).Hash` | `9FF3009946F0212842EB5AA803C3D8E1697752040229F52B25F584E7B0AE9E56`, the canonical hash; the executable was not run, built or touched. |

## Fixture-tested scope

Graph tests use fake steps and model jobs with an in-memory checkpointer. The flat graph that stores the refused threads is a test copy (`flat-graph.ts`). They alone cover: the drawing with `xray`; stages that dispatch model jobs (hypothesis and challenge jobs, quota waits and the check in `diagnose`, repair attempts, widening levels, promotion and rollback, the next attempts routed back to `repair`, and `discovery`); a kill inside `diagnose` and inside `widen`; and the refused flat thread.

## Live evidence

Threads `wf-20261026T150517Z-37b1af42` (every stage except `discovery`, each in its own checkpoint namespace), `wf-20261026T151913Z-897be54c` (same scope, canonical sides from the cache) and `wf-20261026T152732Z-2a3359d4` (killed inside `capture` and resumed from that stage, repeating only the unfinished case), all exit 0, with the canonical SHA-256 unchanged.

## Unverified

- Live stages with clusters: `diagnose`, `repair` and `widen` ran live only with 0 clusters, so no model job, check capture, repair attempt, widening level or next attempt ran live through the stages.
- The `discovery` stage: not run live (`--no-discovery`; no model CLI was available).
- A live kill inside `diagnose`, `repair` or `widen`.
- A live `--resume` of a thread checkpointed by the flat graph: no such thread was in this checkout's checkpoint file.
- A run on an agent lane or on more than one lane.
