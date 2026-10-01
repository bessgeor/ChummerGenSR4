# Tasks

## 1. Contracts

- [ ] 1.1 Add `parity-execution-coverage.schema.json` and `parity-capture-timing.schema.json`, extend the summary schema with side sources and the cache block and the compare report schema with `completeness`, with examples, generated code and `ContractJson` readers and writers. Evidence: `npm run contracts:check`, `npm run contracts:test` and the C# round-trip tests pass.

## 2. Capture runner

- [ ] 2.1 Add the coverage audit, write `coverage.json` and make invalid coverage give status 2. Evidence: unit tests for a complete side, a gap, a repeated index, a mislabeled index, a failure, a startup failure, optional absences and both capture/file mismatches, and the status rule, pass.
- [ ] 2.2 Add the timing decorator and `timing.json`. Evidence: unit tests with a scripted driver and a substituted clock show each operation's sample, a throwing call recorded as failed and passed through, and the percentiles.
- [ ] 2.3 Add the canonical capture cache with `--canonical-cache`. Evidence: unit tests for the key changing with each input, a miss and store, a hit restoring captures and records without launching, a corrupted entry as a setup error, a failed side not stored, an existing entry not overwritten, and a cache folder inside the repository rejected.

## 3. Comparer

- [ ] 3.1 Add the completeness section. Evidence: unit tests for every state, an unplanned row, `unaccounted` giving status 2, and a missing `coverage.json` giving status 3 with no report.

## 4. Fixtures and guidance

- [ ] 4.1 Add the ten reviewed archetype fixtures to `parity/fixtures/characters/` and the case file, and document the sourcebook overlay, the cache option and the new run files in `AGENTS.md`. Evidence: the case file loads in a unit test with every declared mode matching its fixture, and a unit test finds no fixture linking another character file.

## 5. Verification and archive

- [ ] 5.1 Run live `npm start` on the whole suite with the sourcebook overlay and the cache, then again so the canonical sides come from the cache. Record the canonical hash before and after, coverage, execution outcomes apart from visual results, the comparer's counts and completeness, timing, and the cache hits in `verification.md`, with the first baseline counts, separating fixture-tested scope from live evidence and naming what remains unverified.
- [ ] 5.2 Archive the change with `openspec archive add-parity-evidence`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
