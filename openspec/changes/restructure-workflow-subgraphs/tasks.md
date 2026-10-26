# Tasks

Each task names the tasks it builds on as `(after: …)`, by number in this list or as `<change>#<number>` for a task of another change; `[desktop]` marks a task that needs a live run on the desktop.

## 1. Stage subgraphs

- [x] 1.1 Build the workflow graph from stage subgraphs (`start`, `capture`, `diagnose`, `repair`, `widen`, `conclude`) with the shared state, the routing between stages as edges of the workflow graph, and the stage IDs as an exported constant; refuse a thread stored by the flat graph. Evidence: the existing graph, diagnosis, repair, widening and loop graph tests pass with their assertions about steps, outcomes and resumption unchanged; new tests for `getGraphAsync({ xray: true })` listing every stage with its inner nodes, `getState(config, { subgraphs: true })` showing a capture fan-out's pending case indexes in the capture namespace, a kill inside `diagnose` and inside `widen` resumed from the stage, and the refused flat thread.

## 2. Docs

- [x] 2.1 (after: 1.1) Document the stages in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck`, `npm run workflow:test` and `npm run openspec:validate` pass (recorded in `verification.md`).

## 3. Verification and archive

- [ ] 3.1 (after: 2.1) [desktop] Run `npm start` live on a small scope through every stage it reaches; record in `verification.md` the canonical hash before and after, the stages and namespaces seen in the checkpoints, execution outcomes apart from visual results, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 3.2 (after: 3.1) Archive the change with `openspec archive restructure-workflow-subgraphs`. Evidence: `npm run openspec:validate` passes after the archive.
