# Proposal

## Why

A frozen dataset, a discovery dataset and a repair attempt's archive are each written under a temporary folder name and renamed when complete. On Windows the rename right after the folder was filled fails now and then with `EPERM` (or `EBUSY`, `EACCES`) while another process, such as the search indexer or an antivirus scan, still holds a file it just saw. The workflow's tests fail intermittently on the Windows CI runner for that reason, and a run on a developer's machine can end with a setup error at the same point.

## What Changes

- A shared helper renames a path and, when the rename fails with `EPERM`, `EBUSY` or `EACCES`, tries again after 50 ms, doubling the wait, for eight tries in all (about 6 s). Any other error, and the last lock error when every try failed, is thrown as before; nothing is swallowed.
- The three folder renames use it: `freezeDataset`, `freezeDiscoveryDataset` and the repair attempt's archive.

No requirement changes: the documents are still complete before their final name appears, and a rename that cannot be made is still a failure. Area: the workflow's tooling (`workflow/`). Evidence: unit tests for the retry, the give-up and the non-transient error, and repeated runs of the workflow test suite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None (no behaviour a spec describes changes).

## Impact

- New `workflow/src/host/rename-with-retry.ts` and its test; edited `workflow/src/evals/dataset.ts`, `workflow/src/evals/discovery-dataset.ts`, `workflow/src/repair/attempt-archive.ts`.
