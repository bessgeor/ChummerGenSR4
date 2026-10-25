# Design

## Context

`writeArchive`, `freezeDataset` and `freezeDiscoveryDataset` build a folder under a temporary name (`*.partial*`) and rename it to its final name, so a folder that exists under its final name is whole. On Windows, a file that was just written or copied may still be open in another process for a moment, and `rename` of its folder then fails with `EPERM`, `EBUSY` or `EACCES`.

## Decisions

- `renameWithRetry(from, to)` in `workflow/src/host/` retries only those three codes, with waits of 50, 100, 200 … ms (eight tries, about 6.3 s of waiting at most), and throws the original error otherwise. It waits synchronously (`Atomics.wait`) because its callers are synchronous and each wait is short.
- The rename stays the last step, so the guarantee that a complete folder alone carries the final name is unchanged. A rename that keeps failing is thrown as the same error as before.
- Single-file renames of small documents (`write-document.ts`, `step-store.ts`, the discovery registry) are not changed: no failure has been seen there.

## Fixture and live evidence

Unit tests prove the retry and give-up rules with an injected rename and sleep, and a real folder rename. No live run is needed: no capture, compare or app behaviour changes, and `bin/ChummerGenSR4.exe` is not touched.
