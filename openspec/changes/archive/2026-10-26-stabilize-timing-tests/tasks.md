# Tasks

## 1. Tests that wait on events

- [x] 1.1 Make the repair deadline test, the host stop test and the lane agent retention test wait on the events they are about, and make the heartbeat test's assertion name the error it got. Evidence: each test passes alone; `npm run workflow:typecheck` passes.

## 2. Verification and archive

- [x] 2.1 Run the whole suite repeatedly and record it in `verification.md` with the output of any failure. Evidence: the runs in `verification.md`.
- [x] 2.2 Archive the change with `openspec archive stabilize-timing-tests --skip-specs`. Evidence: `npm run openspec:validate` passes after the archive.
