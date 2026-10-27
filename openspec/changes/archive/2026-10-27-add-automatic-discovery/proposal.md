# Proposal

## Why

When a workflow thread finds nothing that differs, it ends: the suite looks clean, and the controls and bindings its runs never reached stay unknown until someone runs `npm run discover -- --from <thread>` by hand. Discovery then writes its admitted scenarios to `parity/cases/discovered.json`, but a later `npm start` without `--case-file` still captures only `parity/cases/characters.json`, so what discovery found never comes back into the default run.

## What Changes

- **Discovery inside the thread.** After the inventory, a thread whose planned cases all captured and compared with status 0 and whose triage found no discrepancy and no other finding runs discovery from its own inventory, before it concludes. The discovery thread gets a deterministic ID (`disc-<workflow thread>`), so a resumed workflow thread resumes it instead of starting another. `--no-discovery` turns it off; `--only`, `--no-diagnosis` and a thread whose case file is the registry's own case file do not discover. The discovery's targets come from the profile (`discovery.targets`, default 3), its other options from the thread's.
- **Its result in the thread.** The thread records the discovery thread, its exit status, the scenarios it admitted and whether any of them differs. Its status 1 or 2 counts in the workflow's exit status; a setup error of the discovery is a setup error of the thread, which stays resumable. `outcome.json` and the end-of-run report show the discovery.
- **Discovered cases join the default suite.** Without `--case-file`, a thread's case file is a suite written into its folder (`suite-cases.json`): the cases of `parity/cases/characters.json` followed by those of `parity/cases/discovered.json` when the registry exists, with fixture paths made relative to the suite. A registry whose case file does not match its rendering, cases whose timings differ from the fixture file's, or a case name in both files is a setup error. Capture step keys do not name the case file, so recorded steps of the fixture cases are still reused. Discovery inside the thread reads the fixture case file, never the suite.
- Unattended threads that discover need the rank and scenario certificates, as `npm run discover -- --unattended` does, and store the active rank and scenario configurations with their options.

Area: the workflow's tooling (`workflow/`) and docs. The Chummer app, the parity tools and `bin/` are untouched. Evidence: workflow tests for the suite composition and its errors, the routing into discovery and around it, a resumed thread that resumes its discovery, the exit status and the outcome; a live `npm start` on a scope without differences that runs discovery and admits or rejects scenarios, then a run that captures the admitted cases by default, with the canonical hash before and after and execution outcomes apart from visual results.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `interaction-discovery`: discovery runs inside a workflow thread whose scope shows no difference.
- `parity-workflow`: the default case file is the suite of the fixture cases and the discovered scenarios; `--no-discovery`; the exit status counts the discovery.
- `self-fixing-loop`: `outcome.json` and the report show the thread's discovery.

## Impact

- New: the suite composition and the discovery node, with tests.
- Edited: the workflow graph and state, run options and arguments, `main.ts` and `discover-main.ts` (the discovery's composition is shared), the outcome; `AGENTS.md` and `README.md`.
- The default suite changes only when `parity/cases/discovered.json` exists and is committed or present in the working tree.
