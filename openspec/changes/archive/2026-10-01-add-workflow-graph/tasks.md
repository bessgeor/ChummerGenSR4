# Tasks

## 1. Workspace and host execution

- [x] 1.1 Add the `workflow/` npm workspace with pinned dependencies, `tsconfig.json`, the root scripts `workflow:typecheck` and `workflow:test`, the options parser (including `--recapture`), the local profile, case selection with capture subsets, and the cache folder precedence. Evidence: `npm run workflow:typecheck` passes; unit tests for accepted, rejected and unknown options, `--recapture` with `--only`, `--resume` with other options, profile validation, case matching and capture subsets, and each cache source and `--live-canonical` pass.
- [x] 1.2 Add the host runner with the desktop lane lock (guarded takeover), the abort signal and the CPU pool. Evidence: unit tests for waiting on a running owner, taking over a lock of a dead process, a waiter that must not remove a lock created since it read the lock, a stuck takeover guard and an unreadable lock failing after their timeouts, a lock nobody refreshes counting as abandoned, a wait ending when the run is stopped, a release failure not replacing the child's error, release checking the token, the pool's bound, prefixed output and exit statuses, a child that cannot start, ends from a signal or is aborted being a setup error with the lane released, pass.

## 2. Steps and graph

- [x] 2.1 Add the capture runner's `--environment-fingerprint-file` option, input fingerprints, step keys with the environment fingerprint, the step store with screenshot hashes, and the capture and compare steps that run the built tools. Evidence: `dotnet test` for the option; unit tests for key changes per input, reuse with intact outputs, a re-run after a changed output or screenshot, `--recapture`, tool and app changes during a thread, status 2 and 3 not recorded, reuse-only failures, the compare report-status check and a replaced report, the comparer's native files, language data and `--tessdata` content, and a run that covers a second case, pass.
- [x] 2.2 Add the graph with the SQLite checkpointer, `--resume`, `--only`, the exit status, the aborting of sibling steps and the per-case execution and visual report, and make root `npm start` run it; remove `parity/scripts/start.mjs` and its tests. Evidence: unit tests with fake steps for the node order and overlap, resume after a failing step without repeating completed steps, a finished or unknown thread, each `--only` mode, the exit statuses, the two report lines per case, an aborted sibling and an interrupted run that resumes, pass.
- [x] 2.3 Add triage with the SQLite-backed store, clusters, identities, other findings, the canonical source of each case and `triage.json`. Evidence: unit tests for clustering across cases, separate clusters for distant cores, identity reuse across threads and for a shifted core, a triage run again in the same thread, other findings, live, cache and mixed canonical sources, and the store's operations, pass.

## 3. CI, docs and identical builds

- [x] 3.1 Add the GitHub Actions Windows job, update `AGENTS.md` and `README.md` for the workflow, and pin the line endings of the tool and generated C# sources with an exact drift check for generated C#. Evidence: the job's commands pass locally in order (`npm ci`, `workflow:typecheck`, `workflow:test`, the parity Release build, `contracts:check`) and `contracts:test` covers LF C# and CRLF TypeScript; the job itself is listed as unverified until it runs on GitHub.

## 4. Verification and archive

- [x] 4.1 Run live `npm start` on the suite with the sourcebook overlay and the default cache, an interrupted run resumed with `--resume`, a run with `--live-canonical` on one case, `--recapture` on one case, and `--only triage`. Record the canonical hash before and after, execution outcomes apart from visual results, the comparer's counts and completeness, the triage clusters against the comparer's groups, step reuse and cache sources in `verification.md`, separating fixture-tested scope from live evidence and naming what remains unverified.
- [x] 4.2 Archive the change with `openspec archive add-workflow-graph`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
