# Tasks

## 1. Contracts

- [x] 1.1 Add `contracts/` with the case-file, capture-summary and capture-results schemas, their examples, the pinned `quicktype` generator, the checked-in C# and TypeScript zod code, and the TypeScript round-trip test. Evidence: `npm run contracts:check` passes on the committed tree and fails after a schema edit; `npm run contracts:test` passes.

## 2. Case model

- [x] 2.1 Add `parity/` (.NET 10) with `Parity.Cases` (loader and model on the generated types) and `Parity.Tests` (C# round-trip test per schema, plus case-file validation tests). Evidence: `dotnet test parity/Parity.slnx` passes, including the mode-mismatch, unknown-property, missing-property and include-cycle cases.
- [x] 2.2 Review and add the fixtures `Diego_v_alpha2_by_bessgeor.chum` (build) and `Шпала - карьера.chum` (career), and the case file `parity/cases/characters.json`. Evidence: the review notes in `verification.md`; the loader test on the real case file yields two cases with the expected modes and action counts.

## 3. Capture runner

- [x] 3.1 Add run staging to `Parity.Capture`: the canonical hash guard, the run-scoped app folders, fixture copies and the declared settings overlay. Evidence: unit tests for the hash guard, overlay path rules and the staged layout pass.
- [x] 3.2 Add UI driving and reporting to `Parity.Capture`: launch, activation with bounded retry, tab selection, label wait, capture, pixel threshold, execution outcomes, and `summary.json` and `results.json`. Evidence: unit tests for outcome rules (optional skip, not-run after failure), the capture region, the pixel difference and the exit status pass.

## 4. Entry points and guidance

- [x] 4.1 Add `npm run build:candidate`, `npm run parity` and `npm start`, and the capture runner and desktop rules in `AGENTS.md`. Evidence: `npm run build:candidate` writes only under `out/` and the canonical hash is unchanged.

## 5. Verification and archive

- [x] 5.1 Run a live `npm start` on both fixtures, once with the in-repo settings and once with the overlay the career fixture needs. Record the hashes, execution outcomes, action-index coverage and visual results in `verification.md`, separating fixture-tested scope from live evidence and naming what remains unverified.
- [ ] 5.2 Archive the change with `openspec archive add-parity-capture`. Evidence: `openspec/specs/parity-contracts/spec.md` and `openspec/specs/visual-parity-capture/spec.md` exist and `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
