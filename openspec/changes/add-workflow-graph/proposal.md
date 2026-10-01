# Proposal

## Why

`npm start` builds the candidate, captures the whole suite and then compares it, in one chain. A run that stops halfway, because of a crash, Ctrl+C or a setup error in one case, has to start again from the first case, and nothing it already captured or compared is reused. The comparer runs only after the last case is captured, although the two use different resources: capture needs the desktop, comparing needs only the CPU. Two runs started from different worktrees can drive the desktop at the same time and spoil each other's captures. Each run's report lists its own discrepancies, but nothing says which of them are the same change seen in several cases, or whether a discrepancy was already seen in an earlier run. Every run also has to be told where the canonical capture cache is. The canonical capture cache keys on the capture runner's assemblies, so checkouts of the same sources can only share it when they compile identical assemblies, and nothing checks the TypeScript and .NET builds and the generated contracts on a machine other than the author's.

## What Changes

- **Workflow graph.** A new npm workspace `workflow/` holds a LangGraph state graph `build → capture → compare → triage`. Capture runs one case at a time; each captured case is compared while the next one is captured. Root `npm start` runs the graph; `npm run parity` and `npm run compare` still run the two tools alone.
- **Checkpoints and resume.** The graph's state is checkpointed in a SQLite database under `out/workflow/` after every step. Each run is a thread; `npm start -- --resume <thread>` continues a thread that stopped, with the options it was started with.
- **Idempotent host steps.** Every capture and compare step is keyed by a hash of its inputs (the case and its expanded actions, the fixture, the candidate app, the canonical app files, the settings overlay, the capture filter and threshold, whether the canonical side may come from the cache, the machine environment the pixels depend on, and the tools' own assemblies; for compare, the capture step and the OCR options). The comparer is keyed by every file of its output folder (the OCR engine and its language data included) and by the contents of a `--tessdata` folder, and a capture run that covers more than its planned case is a setup error. A step whose inputs match a completed step with intact outputs, screenshots included, reuses that step's run folder instead of running again. `--recapture` captures every planned case again even when a step is recorded.
- **Environment fingerprint.** The capture runner gets an option that writes the SHA-256 of the environment its canonical cache keys on (screens and their scale, OS build, Windows colour and text settings, the app's options), so the workflow's capture key changes with the machine in the same way the cache key does.
- **Host runner, desktop lane and CPU pool.** Child processes run through one host runner. Capture holds the machine-wide desktop lane, a lock file that records its owner's process ID; a lock whose owner is no longer running, or has not refreshed it for ninety seconds (process IDs are reused), is taken over, one run at a time and only if the lock is still the one judged abandoned, and any other lock is waited for until the run is stopped. Builds and compares run in a CPU pool of bounded size; the candidate and the tools build side by side. When a step fails with a setup error, or Ctrl+C is pressed, the children of the steps running beside it are stopped, and a waiting step stops waiting.
- **Per-case report.** At the end of a run, and also with `--only`, the workflow prints each case's execution outcome (capture status, coverage, where the canonical side came from) apart from its visual outcome (results, compare status and report counts, completeness).
- **`--only <node>`.** `--only capture`, `--only compare` and `--only triage` run a single node; the nodes before it must find their completed steps, and the nodes after it do not run.
- **Machine-wide canonical cache by default.** Capture uses the canonical capture cache in a folder outside the repository: `--canonical-cache <dir>`, else `PARITY_CANONICAL_CACHE`, else the local workflow profile, else a folder in the user's local application data. Every worktree on the machine shares it. `--live-canonical` turns it off, for evidence that must show the canonical executable running.
- **Triage.** Triage reads every compared case's report and groups their discrepancies into clusters across cases, with the comparer's duplicate rule (same image hash, core at nearly the same place). Each cluster gets a stable identity that is kept in a LangGraph store, so the same change seen in a later run, or in a run of other cases, gets the same identity. Rows without pixel analysis and captures lost to execution failures are listed apart from the clusters. Triage writes `triage.json` for the thread and prints a summary.
- **Continuous integration and identical tool builds.** A GitHub Actions job on Windows type-checks the workflow, runs its unit tests, builds the parity tools and checks the generated contracts for drift. The parity tools' C# sources, their project files and the generated C# have their line endings pinned to CRLF, the contract generator writes generated C# with CRLF, and the drift check compares generated C# byte for byte, so every checkout compiles the same assemblies and the machine-wide cache hits across worktrees.
- `parity/scripts/start.mjs` and its tests go away; the workflow takes over its argument handling and exit statuses.

Area: tooling only (a new TypeScript workspace, the root scripts, CI configuration, docs, one added capture runner option and the contract generator's drift check). The Chummer app and `bin/` are untouched, and what the capture runner and the comparer capture and compare is unchanged. Evidence: `tsc` and unit tests for the graph with fake host steps (pipelining order, resume after a failure, step reuse, `--only`, `--recapture`, the lane lock and its takeover, aborting children, the CPU pool, the per-case report, triage clustering and identity), the parity build and tests, the contract drift check and its test, and a live `npm start` run on the suite that records the canonical hash before and after, execution outcomes apart from visual results, the comparer's counts and the triage clusters, plus a live interrupted run resumed from its checkpoint.

## Capabilities

### New Capabilities

- `parity-workflow`: the graph that runs capture, compare and triage, with checkpoints, resume, idempotent host steps, the desktop lane and CPU pool, `--only`, `--recapture`, the default canonical cache, the per-case report, and discrepancy clusters with stable identity.

### Modified Capabilities

- `visual-parity-capture`: `npm start` runs the workflow graph; the capture runner writes an environment fingerprint on request.
- `visual-parity-compare`: `npm start` compares each case as soon as it is captured.
- `development-process`: a Windows CI job checks types, tests, the parity build and contract drift.
- `parity-contracts`: generated C# keeps the line endings pinned for the tool sources, and the drift check compares it byte for byte.

## Impact

- New files: `workflow/` (package, `tsconfig.json`, sources, tests), `.github/workflows/ci.yml`, `parity/.gitattributes`, `contracts/.gitattributes`, `contracts/tests/generated-drift.test.ts`.
- Edited files: root `package.json` (workspace, scripts, Node 22 as the minimum), `package-lock.json`, `AGENTS.md`, `README.md`, the capture runner's options and run (`parity/src/Parity.Capture/`) with its tests, `contracts/scripts/generate.mjs`.
- Removed files: `parity/scripts/start.mjs`, `parity/scripts/tests/`.
- New dependencies in the workspace: `@langchain/langgraph`, `@langchain/langgraph-checkpoint`, `@langchain/langgraph-checkpoint-sqlite`, `@langchain/core`, `better-sqlite3`.
- Output still goes only to the git-ignored `out/`, except the canonical cache, the desktop lane lock and the optional profile, which live in the user's local application data unless configured otherwise.
