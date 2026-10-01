# Spec Delta

## Purpose
Defines how the comparer turns a capture run's failing visual rows into located, cropped, OCR-annotated and grouped discrepancies, using the raw pixel difference as the only evidence.

## ADDED Requirements

### Requirement: The comparer analyzes one capture run in place
The comparer SHALL take a capture run folder, read its `results.json`, and write `compare/report.json` and its image crops inside that run folder. It SHALL replace only the run's `compare/` folder and SHALL NOT write anywhere else. The report SHALL conform to `parity-compare-report.schema.json` and hold one row for every row of `results.json`, in the same order. A missing or invalid `results.json`, a capture path that leaves the run folder, or a missing OCR language data file SHALL be a setup error: the comparer exits with status 3 and writes no report. When replacing the `compare/` folder, grouping or writing the report fails, the comparer SHALL also exit with status 3 and SHALL remove the partly written `compare/` folder. When printing a report that was written fails, the comparer SHALL exit with status 3 and SHALL keep the report.

#### Scenario: Report written next to the captures
- **WHEN** the comparer runs on a capture run folder with a valid `results.json`
- **THEN** `compare/report.json` exists in that folder and conforms to `parity-compare-report.schema.json`
- **AND** the report has one row per `results.json` row

#### Scenario: Run folder without results
- **WHEN** the comparer runs on a folder that holds no `results.json`
- **THEN** it exits with status 3
- **AND** no report is written

### Requirement: Raw pixel differences are the only evidence
For each row that failed with a visual difference and whose two captures have the same size, the comparer SHALL compute which pixels differ in their 32-bit ARGB value at all, the same definition the capture runner uses for the row's difference ratio. Every differing pixel SHALL belong to exactly one discrepancy of that row, and the discrepancies' differing-pixel counts SHALL add up to the row's total. No difference SHALL be dropped for being small or for being a change between two similar colors, and neither crop expansion nor OCR SHALL remove a discrepancy. When the recomputed share of differing pixels does not equal the row's recorded difference, or no pixel differs, the row SHALL be recorded as `failed` with the reason, and the run SHALL end with the analysis-failure status.

#### Scenario: A single changed pixel
- **WHEN** a failing row's captures differ in exactly one pixel
- **THEN** the row has one discrepancy with one differing pixel

#### Scenario: A change between two dark colors
- **WHEN** text changes from black to dark red and nothing else changes
- **THEN** the changed pixels form a discrepancy

#### Scenario: Recorded difference disagrees with the pixels
- **WHEN** a row's recorded difference is not the share of differing pixels in its two captures
- **THEN** the row is `failed` with a reason naming both values
- **AND** the comparer exits with status 2

### Requirement: Rows that need no pixel analysis keep their own status
A row that passed the threshold SHALL be recorded as `passed` and SHALL NOT be analyzed. A failing row whose captures differ in size SHALL be recorded as `size-mismatch` with both sizes and no discrepancies. A row for a capture that only one side produced SHALL be recorded as `missing-canonical` or `missing-candidate` with the path of the capture that exists. A row whose captures cannot be read, or whose analysis fails in any other way, for example because its crops cannot be written, SHALL be recorded as `failed` with the error, and none of that row's crop files SHALL remain.

#### Scenario: Size mismatch
- **WHEN** a failing row's canonical capture is 1280×680 and its candidate capture is 1280×700
- **THEN** the row is `size-mismatch` and records both sizes
- **AND** it has no discrepancies

#### Scenario: Passed row
- **WHEN** a row passed the threshold
- **THEN** the report records it as `passed` with its difference
- **AND** it has no discrepancies

#### Scenario: Crops cannot be written
- **WHEN** writing one of a failing row's crop files fails
- **THEN** the row is `failed` with the error
- **AND** none of the row's crop files remain

### Requirement: Each discrepancy has a change core and a review crop
Each discrepancy SHALL record its change core, the bounding box of its differing pixels, and a review crop that contains the core and extends over the surrounding text so that a reader sees what changed in context. The comparer SHALL write the canonical and the candidate pixels of the review crop as two PNG files and record their paths relative to the run folder, together with the number of differing pixels and a hash of both sides' core pixels. The crop's shape SHALL come only from the ink around the core, never from where the core sits in the capture, and the crop SHALL cover the full height of the text line that holds the core, up to 32 pixels.

#### Scenario: Crops for both sides
- **WHEN** a failing row has a discrepancy
- **THEN** the report gives the discrepancy's core, its crop, its differing-pixel count and its image hash
- **AND** the canonical and candidate crop files exist with the crop's size

#### Scenario: A tall text line
- **WHEN** a value changes on a text line taller than the 11 rows around the core's center
- **THEN** the review crop covers the line's full height

#### Scenario: A label/value block anywhere in the capture
- **WHEN** a narrow value changes in a block of at least three label/value rows, wherever the block sits in the capture
- **THEN** the review crop shows the whole block

### Requirement: OCR results have explicit states
The comparer SHALL read the text of both sides' review crops with OCR and record each result as `text` with the text, `empty`, `error` with the error message, or `disabled` when OCR was turned off for the run. When both sides read as `empty`, the comparer SHALL widen the review crop once and read it again. Any exception the OCR engine throws for a crop SHALL be recorded as that crop's `error`. An OCR error SHALL make the run end with the analysis-failure status; it SHALL NOT be recorded as empty text. Cleaning the text SHALL only trim each line and drop blank lines; it SHALL NOT change any character OCR read, so the recorded text never shows a word or a unit that OCR did not read.

#### Scenario: OCR turned off
- **WHEN** the comparer runs with `--no-ocr`
- **THEN** every OCR result in the report is `disabled`

#### Scenario: OCR fails on a crop
- **WHEN** reading a crop's text throws an error
- **THEN** that OCR result is `error` with the message
- **AND** the comparer exits with status 2

#### Scenario: OCR text is recorded as read
- **WHEN** OCR reads `3 EF` from a crop
- **THEN** the recorded text is `3 EF`

### Requirement: Duplicates are grouped by change area and image hash
The comparer SHALL group discrepancies across all rows of the run. Two discrepancies SHALL be in the same group only when their core image hashes are equal and their change cores sit at nearly the same place: the horizontal offset as a share of the capture width plus the vertical offset as a share of the capture height is at most 6 %. OCR text SHALL NOT make two discrepancies duplicates. Every discrepancy SHALL stay in the report with a reference to its group's representative, the first discrepancy of the group in report order, and grouping SHALL give the same result for the same input.

#### Scenario: The same change on two tabs
- **WHEN** two captures of a case show the same changed pixels at the same place
- **THEN** their two discrepancies form one group with two members

#### Scenario: Different changes with empty OCR text
- **WHEN** two discrepancies at the same place have different changed pixels and both sides of both read as `empty`
- **THEN** they are in different groups

### Requirement: The comparer's outcome is reported apart from capture execution
The comparer SHALL print each row that is not `passed`, the group count and the report path, and SHALL exit with 0 when every row is `passed`, 1 when it reported differences (discrepancies, size mismatches or missing captures) and nothing failed, 2 when a row is `failed` or an OCR result is `error`, and 3 on a setup error. The report's totals SHALL count rows by status, discrepancies, groups and OCR errors. The comparer SHALL NOT report the capture run's execution outcomes as its own; those stay in the run's `summary.json`.

#### Scenario: Every row passed
- **WHEN** every row of `results.json` passed
- **THEN** the report has no discrepancies
- **AND** the comparer exits with status 0

#### Scenario: Differences reported
- **WHEN** some rows failed with visual differences and every one was analyzed
- **THEN** the comparer exits with status 1

### Requirement: The comparer runs from the root entry points
`npm run compare -- --run <run folder>` SHALL run the comparer alone. `npm start` SHALL build the candidate, run capture, and then run the comparer on the run folder that capture wrote, passing it `--no-ocr` and `--tessdata <dir>` when they are given. It SHALL run the comparer when capture exits with 0, 1 or 2, and SHALL NOT run it when capture exits with 3. The exit status of `npm start` SHALL be the higher of the two statuses. It SHALL be 3 when the candidate build fails, when the file through which capture reports its run folder cannot be created or read, or when the comparer exits with a status other than 0, 1 or 2 or leaves no `compare/report.json` whose status matches its exit status, for example because the comparer could not be built.

#### Scenario: Capture finds visual differences
- **WHEN** `npm start` runs and capture exits with status 1
- **THEN** the comparer runs on that run folder
- **AND** `npm start` exits with the higher of the two statuses

#### Scenario: Capture setup error
- **WHEN** capture exits with status 3
- **THEN** the comparer does not run
- **AND** `npm start` exits with status 3

#### Scenario: The comparer cannot be built
- **WHEN** capture exits with status 0 and the comparer fails to build, so it exits with status 1 and writes no report
- **THEN** `npm start` exits with status 3
