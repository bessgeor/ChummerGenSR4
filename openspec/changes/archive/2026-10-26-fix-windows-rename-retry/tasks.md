# Tasks

## 1. Rename with retry

- [x] 1.1 Add `renameWithRetry` and use it for the dataset, discovery dataset and attempt archive folder renames. Evidence: `workflow/tests/rename-with-retry.test.ts` (retry with doubling waits, an immediate non-transient error, giving up, a real folder rename) and `npm run workflow:typecheck`.

## 2. Verification and archive

- [x] 2.1 Run the workflow test suite repeatedly and record it in `verification.md`. Evidence: the runs and their results in `verification.md`.
- [x] 2.2 Archive the change with `openspec archive fix-windows-rename-retry --skip-specs`. Evidence: `npm run openspec:validate` passes after the archive.
