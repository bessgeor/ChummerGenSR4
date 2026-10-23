# Tasks

## 1. Case files with scenarios

- [x] 1.1 Add `actions` and `scenario` to the character entry of `parity-cases.schema.json`, its example and generated code, and read them in `CaseFileLoader` and `case-plan.ts`. Evidence: `npm run contracts:check`, `npm run contracts:test` and `npm run parity:test` pass, with loader tests for an entry with its own actions, its case name, `actions` without `scenario`, `scenario` without `actions` and two entries of one fixture; workflow tests for the case plan.

## 2. Discovery building blocks

- [x] 2.1 Add the targets, the known texts and the priors. Evidence: workflow tests for grouping by page chain, selection targets, controls proved by the registry, dropped targets, out-of-reach counts, known tab texts and labels, and prior scores.
- [x] 2.2 Add the rank and scenario job schemas, prompts, contexts and validation, and the plan validator. Evidence: workflow tests for each validation failure, each validator rule, and sealed contexts with their hashes.
- [x] 2.3 Add proof from a scenario run and the registry with its rendered case file. Evidence: workflow tests on synthetic runs for execution outcomes, visual outcomes, proofs, admission, duplicates, a hand-edited case file and an invalid registry.

## 3. Discovery thread

- [x] 3.1 Add the discovery graph, its service, the `discovery` label and `npm run discover` with resume and `--unattended`. Evidence: workflow tests for routing (no targets, rank failure, quota wait, budget, fan-out, invalid plans only), the exit statuses, the baseline guards, labels and the document.

## 4. Evaluation

- [x] 4.1 Extend freeze, run, compare and certify to rank and scenario jobs, and document discovery in `AGENTS.md` and `README.md`. Evidence: workflow tests for freezing, scoring `valid` and `reached`, a wrong metric and a certificate; `npm run workflow:typecheck` and `npm run workflow:test` pass.

## 5. Verification and archive

- [x] 5.1 Run a live `npm start` baseline with the sourcebook overlay and the shared canonical cache, then a live `npm run discover` from it with model jobs. Record the canonical hash before and after, the baseline's and the discovery run's execution outcomes apart from their visual results, the jobs and their outcomes, the coverage proved and the registry in `verification.md`, separating fixture-tested scope from live evidence and naming what remains unverified.
- [x] 5.2 Archive the change with `openspec archive add-interaction-discovery`. Evidence: `npm run openspec:validate` passes after the archive.
