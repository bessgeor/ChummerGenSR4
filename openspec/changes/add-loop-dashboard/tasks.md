# Tasks

## 1. Graphs and stages

- [ ] 1.1 Compile every graph read-only on its checkpoint file and map each node to a stage. Evidence: a workflow test that compiles every graph and finds a stage for every node.

## 2. Live tasks

- [ ] 2.1 Read each candidate thread's running and paused tasks with their subjects from `getState()` and the pending sends, and the loop status from the loop's documents. Evidence: workflow tests against a real SqliteSaver read while a test graph runs, and for each loop status.

## 3. Stats

- [ ] 3.1 Compute each stage's p80 and counts from the activity log, the eval records and the thread documents, scoped to a loop or to every thread. Evidence: workflow tests on fixture records and documents, including the fallback to record durations and unreadable sources.

## 4. Server and controls

- [ ] 4.1 Serve the page, the bundle, the snapshot, the graphs and the pause and resume controls on 127.0.0.1 with the origin and token checks. Evidence: workflow tests for each route, a control write, and the refusals.

## 5. Client

- [ ] 5.1 Build the React page (stage view, node view, running tasks, stage stats, lanes and loop controls) and its type check. Evidence: `npm run workflow:typecheck` and a headless browser render of the page over a fixture loop.

## 6. Docs

- [ ] 6.1 Document `npm run dashboard` in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:test` passes (recorded in `verification.md`).

## 7. Verification and archive

- [ ] 7.1 Run `npm run dashboard` against a live loop, pause and resume the loop and a lane, and record in `verification.md` what the page showed, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 7.2 Archive the change with `openspec archive add-loop-dashboard`. Evidence: `npm run openspec:validate` passes after the archive.
