# Proposal

## Why

The coverage manifest lists what the character suite shows and drives: 996 of 1379 controls of the active classes observed and 4 of 857 bindings exercised. It does not say how to cover the rest. Writing new cases by hand means reading the designer files, guessing which tab or character state shows a control, running the case and checking the trees. Most of that is search over the source and the manifest, which a model can do; whether a new case really shows a control is something only a run can prove.

## What Changes

- **Discovery targets.** From a finished workflow thread's inventory, the controls of the active classes that no tree showed are grouped by their class and the tab pages that contain them, and every tab control whose selection bindings no run exercised is a target of its own. Targets a registered scenario already proved for the same source are left out.
- **Ranking and scenario proposal jobs.** A `rank` job ranks every target by how likely a scenario in the case-file actions can show it, with the archived fix changes most related to each target as priors; the best targets get one `scenario` job each, fanned out with `Send`, that proposes a scenario: a fixture case of the suite and its own actions (`selectTab`, `waitFor`, `wait`, `capture`). Both job kinds run through the agent runner in sealed contexts over a source snapshot, with eval records.
- **Plan validator.** Each proposal is checked before it gets lane time: a known fixture case, only those four action types with their fields, a known tab text for every `selectTab`, a known text for every `waitFor`, one to four uniquely named captures and bounded waits. A rejected plan is an outcome with its reasons, never a capture.
- **Lane execution and proof.** The valid scenarios run in one capture runner call on the desktop lane, with UI trees, from a generated case file. Coverage changes only by proof: a scenario proves a control when its tree shows it, and a selection binding when the inventory's exercise rule holds in its run. Execution outcomes stay apart from visual results.
- **Scenario registry.** A scenario that executed and proved new coverage, or showed a visual difference, is admitted to `parity/discovery/registry.json` with its provenance, and the registry is rendered into the case file `parity/cases/discovered.json`. `npm start -- --case-file parity/cases/discovered.json` runs the registered scenarios through capture, compare, triage and diagnosis, so findings reach diagnosis like any other discrepancy.
- **Case files with scenarios.** A character entry may carry its own `actions` and a `scenario` name; the case is then named `<mode>-<file>@<scenario>`.
- **Evaluation.** Rank and scenario records get an automatic `discovery` label (proven, not proven, invalid plan or execution failed). `npm run eval -- freeze`, `run`, `compare` and `certify` handle both job kinds with the metrics `valid` and `reached`, and `npm run discover -- --unattended` starts only with certificates for both.
- **Entry point.** `npm run discover -- --from <thread>` runs a resumable discovery thread and writes `out/discovery/threads/<thread>/discovery.json`.

Area: the workflow, the parity tools' case loading, the contracts and docs. The Chummer app and `bin/` are untouched. Evidence: contract drift and round-trip tests; `dotnet test` for scenario entries in case files; workflow tests for targets, priors, the validator, proof, the registry, the graph's routing, labels and the eval commands; a live `npm start` baseline and a live `npm run discover` run with model jobs, the canonical hash before and after, execution outcomes apart from visual results, and the coverage the run proved.

## Capabilities

### New Capabilities

- `interaction-discovery`: targets, rank and scenario jobs, the plan validator, lane execution and proof, the scenario registry and `npm run discover`.

### Modified Capabilities

- `visual-parity-capture`: character entries with their own actions and scenario name.
- `agent-evaluation`: the `discovery` label, and datasets, runs, comparisons and certificates for rank and scenario jobs.
- `discrepancy-diagnosis`: the profile chooses the provider for rank and scenario jobs too.

## Impact

- New files: `workflow/src/discovery/` and its tests; `parity/discovery/` (the registry, once a scenario is admitted).
- Edited files: `parity-cases.schema.json`, its example and generated code; `CaseFileLoader` and its tests; `case-plan.ts`; the agent job kinds and profile; the eval record, dataset, run, comparison and certificate code; `package.json`; `AGENTS.md` and `README.md`.
- Output goes to the git-ignored `out/`, except the registry and its case file, which discovery writes into the working tree for review.
