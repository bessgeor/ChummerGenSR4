# Agent guide

## OpenSpec workflow

- Every change is an OpenSpec change under `openspec/changes/<change-name>/` using the `spec-driven` schema. Project context and per-artifact rules live in `openspec/config.yaml`; the CLI feeds them into each artifact's instructions.
- Use the generated workflows: `/opsx:propose`, `/opsx:apply`, `/opsx:archive` in Claude Code, and the matching `openspec-*` skills in Codex. They are generated files; regenerate them with `npx openspec update` instead of editing them.
- Commit order on a change's branch:
  1. proposal, design, spec deltas and tasks (about eight tasks at most);
  2. small implementation commits;
  3. `verification.md`;
  4. `npx openspec archive <change-name>` as the final commit.
- Run `npm run openspec:validate` (strict) before every commit that touches `openspec/`. A failing validation blocks the change.

## One change per pull request

- A branch is named after its change and carries exactly that one change.
- Branch from `master`, or from the predecessor change's branch while its pull request is still open.

## Verification evidence

- Each change has `verification.md` beside its proposal. List the commands you ran and what they printed or produced.
- Keep fixture-tested scope separate from live evidence. When a live dependency is unavailable, list the requirement as unverified; fixture results never stand in for a live run.
- Preserve real failures: record a failed step as a failure with its output, never as a skip, a warning or a success. Report execution failures separately from visual differences.
- Mark a task done only when the evidence it names is recorded.

## Canonical executable

- `bin/ChummerGenSR4.exe` is the canonical build and is immutable. Never rebuild, replace, copy over or edit it.
- The app's Release configuration builds `ChummerGenSR4.exe` into `bin/`, so never build it with the default output path.
- Before and after any run that launches it, record its SHA-256. Both must equal `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Contracts

- Data read or written by more than one language is defined by a JSON Schema in `contracts/schemas/`. Edit the schema, then run `npm run contracts:generate`; never edit `contracts/generated/` by hand.
- Every schema needs an example in `contracts/examples/`. `npm run contracts:check` (drift), `npm run contracts:test` (TypeScript round-trip) and `npm run parity:test` (C# round-trip) must pass.

## Visual parity capture

- `npm run build:candidate` builds the app from the current source into `out/candidate/bin/`. Use it instead of building `Chummer/Chummer.csproj` yourself.
- `npm run parity` captures every case in `parity/cases/characters.json` on the canonical and the candidate executable in one run; `npm start` runs the parity workflow instead (see below). Pass options after `--`, for example `npm run parity -- --case Diego_v_alpha2_by_bessgeor --capture common`; `--help` lists them. In PowerShell, call `npm.cmd` instead of `npm`, because the `npm.ps1` shim drops the `--`.
- A run writes only under `out/runs/<runId>/`: staged apps, fixture copies, `captures/`, `summary.json`, `results.json`, `coverage.json`, `timing.json` and the comparer's `compare/`. The exit status is 0 (all passed), 1 (visual differences), 2 (execution failures) or 3 (setup error). Read `coverage.json` for execution (`valid`, `invalidReasons`, failures, and optional absences listed apart from them) and `results.json` for visual pass/fail, and report them separately. Invalid coverage alone gives status 2. `timing.json` holds the durations of every UI operation; it measures, it never decides an outcome.
- Run-specific settings go in a folder passed with `--settings-overlay`. Keep it outside the repository or under `out/`; never edit `bin/settings/` for a run.
- The fixtures use sourcebooks that `bin/settings/default.xml`, which enables only the core book, does not enable; without them the cases that need them fail at startup on both sides. To run the suite, pass an overlay holding `settings/default.xml`: a copy of `bin/settings/default.xml` (UTF-16) with these books added to `<books>`: `AR`, `AT`, `AU`, `DG`, `GH`, `RC`, `RW`, `SA`, `SDN`, `SG`, `SM`, `TOD`, `UCL`, `UN`, `WA` and `WAR`.
- `--canonical-cache <dir>` (outside the repository or under `out/`) reuses the canonical side of a case from an earlier run when every input it is keyed on is the same (the staged canonical app, the fixture, the actions, the screens and their scale, the OS build, the Windows colour and text settings, the app's registry options and the runner's own assemblies), and stores canonical sides that completed. A reused side is marked `cache` in the summary and in `coverage.json`, with the run that stored it; say so when you report a run. Leave the cache off for evidence that must show both executables running.
- Add a fixture to `parity/fixtures/characters/` only after reviewing its content (names, notes, links, images), and declare its mode in the case file.

## Visual parity compare

- `npm run compare -- --run out/runs/<runId>` analyzes a capture run: it reads `results.json` and replaces only `out/runs/<runId>/compare/` with `report.json` and the crops under `crops/`. `--no-ocr` turns OCR off; `--help` lists the options.
- The comparer's exit status is 0 (every row passed), 1 (differences reported), 2 (analysis failures: a row could not be analyzed, OCR failed, or a planned capture is unaccounted) or 3 (setup error, no report). The comparer needs the run's `coverage.json`.
- The report's `completeness` accounts for every planned capture: `reported`, `analysis-failed`, `filtered`, `optional-absent`, `execution-lost` or `unaccounted`. Report its totals with the comparer's outcome. Report the comparer's outcome apart from the capture run's execution outcomes and visual results.
- Discrepancies come only from the raw pixel difference. OCR text helps a reader; it never shows that a difference is gone or that two discrepancies are the same. Duplicates share the same changed pixels at nearly the same place.

## Parity workflow

- `npm start -- <options>` runs the LangGraph graph in `workflow/`: build (the candidate and the parity tools), then capture one case at a time with each captured case compared while the next is captured, then triage, then diagnosis (see below; `--no-diagnosis` ends the run after triage). Capture options (`--case`, `--capture`, `--settings-overlay`, `--threshold`, `--case-file`) go to the capture runner, `--no-ocr` and `--tessdata <dir>` to the comparer; `--help` lists them. Each case gets its own run folder under `out/runs/`.
- The exit status is the highest capture and compare status of the cases (0, 1 or 2), 2 when a diagnosis job failed a cluster or the check capture had execution failures, or 3 for a setup error. Report each case's execution outcome (capture status, coverage, where the canonical side came from) apart from its visual outcome (results, report status and completeness); the workflow prints both for every case at the end of the run, also with `--only`.
- Every run is a thread, checkpointed in `out/workflow/checkpoints.sqlite`; the thread ID is printed at the start. After a crash, Ctrl+C or a setup error, `npm start -- --resume <thread>` continues it with its original options.
- Capture and compare steps are keyed by their inputs and recorded under `out/workflow/steps/`. A step with the same inputs and intact outputs is reused, also by a new thread, and is reported as reused with the thread it came from. A capture key covers the machine environment the pixels depend on (screens and scale, OS build, Windows colour and text settings, the app's options); steps with status 2 are never reused, and `--recapture` captures every planned case again even when a step is recorded (a difference that looks like a paint race). `--only capture|compare|triage|diagnose` runs one node; the nodes before it must find recorded steps.
- Capture uses the canonical capture cache by default: `--canonical-cache <dir>`, else `PARITY_CANONICAL_CACHE`, else `canonicalCache` in the local profile, else `%LOCALAPPDATA%\ChummerGenSR4\canonical-cache`. All worktrees share it. Pass `--live-canonical` for evidence that must show the canonical executable running.
- Cache entries are keyed on the capture runner's assemblies, so every checkout must build them byte for byte: the parity and generated C# sources have their line endings pinned to CRLF in `.gitattributes`. Keep them CRLF when you write these files, and do not commit attributes that change it.
- The optional local profile (`PARITY_WORKFLOW_PROFILE` or `%LOCALAPPDATA%\ChummerGenSR4\workflow-profile.json`) may set `canonicalCache`, `settingsOverlay`, `cpuPool` and `agents` (see Diagnosis).
- Triage writes `out/workflow/threads/<thread>/triage.json`: discrepancy clusters across cases (same image hash, core at nearly the same place) with identities that stay the same across runs, and the rows and captures without pixel analysis listed apart.
- `npm run workflow:typecheck` and `npm run workflow:test` check the workflow; CI runs them with the parity build and `contracts:check`.

## Diagnosis

- After triage, each cluster gets a sealed context under `out/workflow/threads/<thread>/diagnosis/<cluster>/` (`context.json`, the crops in `evidence/`) over a history-less snapshot of `Chummer/`, `bin/data/` and `bin/lang/` in `diagnosis/source/`. Prompts are built from the context only; every job records its hash. The build step records the identity of the compiled source (`Chummer/`, by content) next to the candidate, and diagnosis ends with a setup error when the snapshot's `Chummer/` differs from it or none is recorded, `--only diagnose` included: the snapshot must be the source the candidate was built from. `bin/data` and `bin/lang` are capture inputs and not part of this guard.
- A hypothesis job runs per cluster, then a challenge job per hypothesis in a fresh session; jobs fan out with `Send` up to the model pool size. Answers are validated against the snapshot (cited files and lines exist) and the check vocabulary (the case file's cases and captures); a failed validation is `invalid_output`.
- Jobs are read-only, and each runs in a scratch copy of its context and the snapshot outside the repository (removed afterwards), because the Codex sandbox limits writes but not reads. The Claude adapter runs the Claude Code CLI headless with only Read, Grep and Glob, without allowance rules, and the job fails unless the model opened each evidence image with a Read that succeeded (Codex gets them as image inputs); the Codex adapter runs the Codex SDK in its read-only sandbox without web search. Both run under the subscriptions: API-key variables are removed, and a job that would bill an API key fails as `infra`.
- Failures: `invalid_output` and `refused` fail the cluster (exit status 2); `infra` is a setup error (status 3, resumable); `quota_exhausted` routes to `wait_for_quota`, which waits 1, 2, 5, 10, 15 minutes, then every 15 minutes, and retries at once after a restart. Quota waits are not charged to the run budget, which is checked when a job gets its place in the model pool.
- One check capture on the desktop lane covers the predictions of every cluster (union of cases and captures). Each cluster is `confirmed`, `refuted` or `undecided`; report the check's execution outcome apart from its observations.
- Every job is an eval record in `out/workflow/store.sqlite` (namespace `eval-record/<job kind>`), labelled with its cluster's check outcome. `out/workflow/threads/<thread>/diagnosis.json` lists each cluster's jobs, check outcome and record IDs; the agents' raw streams are in `diagnosis/logs/`.
- The profile's `agents` sets, per job kind under `agents.jobs.<kind>` (`hypothesis`, `challenge`), `provider` (`claude` or `codex`), `model`, `effort` and `timeoutMinutes`, plus `modelPool`, `runBudgetMinutes` and `executables.claude`/`executables.codex`. By default hypotheses run on Claude and challenges on Codex. The Claude Code CLI must be on `PATH` or named in `executables.claude`.

## Desktop use

- A capture run drives real windows. Only one live run may use the desktop at a time: never start a second run while one is active, and watch a slow run instead of restarting it. The workflow's capture steps hold a machine-wide lock (`%LOCALAPPDATA%\ChummerGenSR4\desktop-lane.lock`) and wait for each other; `npm run parity` does not take it.
- Leave the mouse and keyboard alone during a run; another window taking the foreground fails the current action with a `window-activation` reason. The capture runner parks the pointer in the middle of the app's title bar, and a pointer moved away from it fails the next capture with a `pointer` reason.
