# Proposal

## Why

The capture runner tells whether each capture pair passes the pixel threshold, but a failing row only says that some share of pixels differs. To act on a difference, a contributor needs to see where it is, what each side shows there, and whether the same difference repeats across tabs and characters. That analysis must rest on the same raw pixel difference that failed the row, so that it can neither hide a failure nor invent one, and grouping must compare the changed pixels themselves rather than OCR text, which can be empty or wrong.

## What Changes

- Add `Parity.Compare` (.NET 10, Windows), the comparer. It reads a capture run's `results.json` and writes `compare/report.json` and image crops into the same run folder:
  - For each failing row whose captures have the same size, it computes the per-pixel ARGB difference with the same definition the capture runner uses, and turns every differing pixel into difference rectangles. No differing pixel is dropped.
  - Each discrepancy has a tight change core (the bounding box of its differing pixels) and a wider review crop that follows the surrounding text line. Both sides' crops are written as PNG files.
  - Tesseract OCR reads both crops. Each OCR result has an explicit state: text, empty, error or disabled.
  - Discrepancies are grouped as duplicates only when their changed pixels hash the same and their change areas sit at the same place. OCR text plays no part in grouping, so two empty OCR results never make unrelated changes look alike.
  - Size mismatches and captures missing on one side get their own rows. A row that cannot be analyzed, whose pixels disagree with the recorded difference, or whose OCR fails, is an analysis failure.
  - Exit status: 0 nothing to report, 1 differences reported, 2 analysis failures, 3 setup error.
- Add `Parity.Imaging`, a small library with the image decoding and raw pixel difference that the capture runner and the comparer share.
- The report format is a new JSON Schema, `parity-compare-report.schema.json`, with generated C# and TypeScript code, an example and round-trip tests.
- Root entry points: `npm run compare -- --run <run folder>` runs the comparer on its own; `npm start` builds the candidate, runs capture and then compares the run that capture wrote. The capture runner gains `--run-folder-file <path>`, which writes the full path of the run folder it created, so `npm start` compares exactly that run. `npm start` passes the comparer's `--no-ocr` and `--tessdata <dir>` to the comparer and ends with a setup error when the comparer does not leave a report that matches its exit status.
- `AGENTS.md` gains the comparer usage and its exit statuses.

Area: the parity tools and their docs. The Chummer app and `bin/` are untouched. Evidence: contract drift check and round-trip tests pass; `dotnet test` covers difference rectangles, crops, OCR states, grouping and the row statuses on generated images; a Node test runs `npm start`'s script against a stand-in for npm; live `npm start` runs record the canonical hash before and after, the capture run's execution outcomes apart from its visual results, and the comparer's report counts and groups, once with the current source as candidate and once with a candidate that carries a deliberate visible change.

## Capabilities

### New Capabilities

- `visual-parity-compare`: analyzing a capture run's failing rows into located, cropped, OCR-annotated and grouped discrepancies, based only on raw pixel differences.

### Modified Capabilities

- `visual-parity-capture`: `npm start` now runs capture and then the comparer, and the capture runner can tell its caller which run folder it created.

## Impact

- New files: `parity/src/Parity.Imaging/**`, `parity/src/Parity.Compare/**`, `parity/scripts/start.mjs` and its tests under `parity/scripts/tests/`, the report schema, its example and its generated code, and new tests.
- Edited files: `parity/src/Parity.Capture` (shared pixel difference, `--run-folder-file`), `parity/src/Parity.Cases` (the option-value helper and the run-folder naming rules both tools share), `parity/Parity.slnx`, `parity/tests/Parity.Tests`, `package.json`, `AGENTS.md`.
- New NuGet dependencies: `Tesseract` 5.2.0 (with its native Tesseract and Leptonica libraries) and `Tesseract.Data.English` 4.0.0 (English trained data).
- Output still goes only to the git-ignored `out/`.
