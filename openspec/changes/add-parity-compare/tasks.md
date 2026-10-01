# Tasks

## 1. Shared pieces and report contract

- [ ] 1.1 Add `Parity.Imaging` (ARGB decoding and the raw pixel difference) and make the capture runner's `PixelComparer` use it; move the option-value helper and the run folder naming rules (`RunPaths`) into `Parity.Cases` for both tools. Evidence: `npm run parity:test` passes, including the existing pixel-difference, visual-result and staging tests.
- [ ] 1.2 Add `parity-compare-report.schema.json`, its example, the generated C# and TypeScript code, and the `ContractJson` reader and writer. Evidence: `npm run contracts:check` and `npm run contracts:test` pass, and the C# round-trip test covers the new schema.

## 2. Comparer

- [ ] 2.1 Add `Parity.Compare` with difference rectangles from the raw mask and review crops. Evidence: unit tests for a single-pixel change, a dark-to-dark color change, near and distant changes, counts adding up, crops containing their cores, a value cropped with its label, a tall text line, a long vertical edge, a label/value block far from the left edge and a block cut by the scan, pass.
- [ ] 2.2 Add OCR: image preparation, the Tesseract engine and the text cleaning. Evidence: unit tests for real Tesseract reading a rendered line of text and a blank crop as empty, missing language data, frame removal that keeps a glyph stem, and text kept as read, pass.
- [ ] 2.3 Add grouping by change area and image hash, the comparer command (options, run-folder input and output, row statuses, OCR states with the empty-result retry), the report, the console summary and the exit statuses. Evidence: unit tests for equal changes on two captures forming one group, different changes with empty OCR staying apart, 50,000 different discrepancies, the size-mismatch, missing, passed and inconsistent rows, a missing `results.json`, `disabled`, `empty` and `error` OCR results with a substituted engine, and each exit status, pass.

## 3. Entry points and guidance

- [ ] 3.1 Add `--run-folder-file` to the capture runner, `npm run compare`, `npm start` as build, capture and compare (with the comparer's options routed to it and its outcome checked against its report), its Node test, and the comparer usage in `AGENTS.md`. Evidence: a unit test shows `--run-folder-file` receiving the run folder of a run that ends with a setup error; `npm run parity:scripts:test` passes; `npm.cmd run compare -- --help` prints the usage.

## 4. Verification and archive

- [ ] 4.1 Run live `npm start` with the overlay the career fixture needs, once with the current source as candidate and once with a candidate built from a scratch copy of the source that carries a deliberate visible change; run it with the in-repo settings and `--no-ocr`, and on one capture with a comparer that does not build. Record the canonical hash before and after, each capture run's execution outcomes, action-index coverage and skipped optional actions, its visual results, and the comparer's report counts and groups in `verification.md`, separating fixture-tested scope from live evidence and naming what remains unverified.
- [ ] 4.2 Archive the change with `openspec archive add-parity-compare`. Evidence: `openspec/specs/visual-parity-compare/spec.md` exists and `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
