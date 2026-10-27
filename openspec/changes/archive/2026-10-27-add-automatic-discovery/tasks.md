# Tasks

Each task names the tasks it builds on as `(after: …)`, by number in this list or as `<change>#<number>` for a task of another change; `[desktop]` marks a task that needs a live run on the desktop.

## 1. Default suite

- [x] 1.1 Write the thread's suite from the fixture cases and the discovered scenarios when no `--case-file` is given, and use it as the thread's case file. Evidence: workflow tests for a suite without a registry, with one, with differing timings, with a duplicate case name, with a case file that does not match its registry, and a capture step recorded from `characters.json` reused from the suite.

## 2. Shared discovery composition

- [x] 2.1 Factor the discovery's composition out of `discover-main.ts` into a runner both entry points use, with start, resume and read of a finished thread by ID. Evidence: the discovery graph tests and a runner test for each of the three cases.

## 3. Discovery in the graph

- [x] 3.1 (after: 1.1, 2.1, restructure-workflow-subgraphs#1.1) Add `--no-discovery`, the profile's `discovery.targets`, the `discovery` stage of the workflow graph (a subgraph, after `capture`) and its routing, the state's `discovery`, rank and scenario tuning and certificates for discovering threads. Evidence: graph tests for a clean scope that discovers, a scope with a difference that does not, `--no-discovery`, `--only`, `--no-diagnosis`, a resumed thread that resumes its discovery, and a discovery setup error.

## 4. Status, outcome and report

- [x] 4.1 (after: 3.1) Count the discovery's status in the exit status and show the discovery in `outcome.json` and the report. Evidence: workflow tests for statuses 0, 1 and 2 of the discovery and the report lines.

## 5. Docs

- [x] 5.1 (after: 4.1) Document the default suite and discovery in the thread in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck`, `npm run workflow:test` and `npm run openspec:validate` pass (recorded in `verification.md`).

## 6. Verification and archive

- [x] 6.1 (after: 5.1) [desktop] Run `npm start` live on a scope without differences so that discovery runs, then a default run that captures the admitted scenarios; record in `verification.md` the canonical hash before and after, execution outcomes apart from visual results, which sides came from the cache, fixture-tested scope apart from live evidence, and what remains unverified.
- [x] 6.2 (after: 6.1) Archive the change with `openspec archive add-automatic-discovery`. Evidence: `npm run openspec:validate` passes after the archive.
