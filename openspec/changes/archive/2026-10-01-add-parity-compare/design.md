# Design

## Context

A capture run (see `visual-parity-capture`) writes `out/runs/<runId>/results.json` with one row per capture name: the share of differing pixels, the pass flag, the reason (`within-threshold`, `visual-difference`, `missing-canonical`, `missing-candidate`), both sizes and the PNG paths relative to the run folder. The share is computed by `PixelComparer` in `Parity.Capture`: two images of the same size are drawn onto 32-bit ARGB canvases and a pixel differs when any of its four bytes differs. The capture runner's exit status is 0, 1, 2 or 3, and `npm start` currently chains the candidate build and capture with `&&`, so nothing after capture runs when capture reports differences.

The captures are 1280×680 renderings of a WinForms window: mostly dark text on light backgrounds, tab pages with label/value columns, tree lists on the left and a summary sidebar on the right that appears on every tab.

## Goals / Non-Goals

**Goals:**
- One definition of "a pixel differs", shared by the capture runner's gate and the comparer, so the comparer explains exactly the pixels that failed a row.
- Readable evidence per discrepancy: where, what each side shows, and the text there.
- Grouping that never merges two different changes because their OCR text is equally empty or equally wrong.
- `npm start` runs the whole workflow, capture then compare, and each step also runs alone.

**Non-Goals:**
- Changing the capture runner's gate, threshold or result rows.
- Analyzing rows that passed the threshold, even when some pixels differ.
- Similarity grouping beyond equal changed pixels (for example "the same value changed on another control").
- Deciding whether a discrepancy is a bug; the report only locates and groups.

## Decisions

**A shared imaging library.** `Parity.Imaging` (`net10.0-windows`) holds `ArgbImage` (a decoded image as 32-bit ARGB pixels, decoded with `System.Drawing` and converted to 32-bit ARGB without scaling, whatever the file's pixel format) and `PixelDifference` (the per-pixel mask and count). `PixelComparer` in `Parity.Capture` becomes a thin wrapper over it, so the gate and the comparer cannot drift apart. *Alternative:* a second, independent difference in the comparer; rejected because two definitions are what lets an analysis lose a failure the gate saw.

**Input and output.** `npm run compare -- --run <dir>` reads `<dir>/results.json` with the generated strict reader. Capture paths are resolved against the run folder and must stay inside it. The comparer deletes and recreates `<dir>/compare/` and writes:
- `compare/report.json` (`parity-compare-report.schema.json`);
- `compare/crops/<case>/<capture>.<n>.canonical.png` and `.candidate.png`.

Rerunning the comparer on the same run replaces only its own folder. Options: `--run`, `--no-ocr`, `--tessdata <dir>` and `--help`. The geometry parameters below are constants, not options.

**Row statuses.** Each `results.json` row becomes one report row:
- `within-threshold` → `passed` (not analyzed);
- `missing-canonical` / `missing-candidate` → the same status, with the present capture's path;
- `visual-difference` with different recorded sizes → `size-mismatch` (sizes checked again on decode);
- `visual-difference` with equal sizes → `analyzed`, or `failed` when the images cannot be read, when no pixel differs, or when `round(differing / area, 6)` differs from the recorded difference (the capture runner rounds to six decimals).

**Difference rectangles from the raw mask.** The comparer labels 8-connected components of the raw difference mask, keeps every component (there is no minimum size), and merges components whose bounding boxes are within 18 px of each other into change cores. Merging sweeps the boxes from left to right, joins near pairs with a union-find, and repeats until a pass joins nothing, because a merged box can reach a box that none of its parts reached; a window-wide change with thousands of components therefore stays fast. Each core carries the exact count of its differing pixels, so the counts of a row add up to its total; a unit test checks this on generated images. *Alternative:* comparing binary "ink" masks of both images, rejected because a change between two dark colors or between two light colors vanishes from such a mask, and dropping components below a few pixels hides single-pixel changes.

**Review crops.** Ink detection is used only to make a crop readable, never to decide whether a difference exists:
- from the core, scan up to 180 px around it and extend horizontally across the text line found in the 11 rows around the core's center (gaps up to 36 px, or 120 px to the left for a narrow value, so a value pulls in its label but not text across a wider blank gap);
- extend vertically over the whole line, up to its next blank rows and at most 32 rows; columns whose ink runs on for more than 32 rows (frames, separators, scroll bars) do not count as text, so the line does not follow them;
- a narrow change on a line at most 240 px wide expands to the whole block of at least three consecutive rows around it, leaving out a row that the 180 px scan cuts;
- pad by 12 px horizontally and 2 px vertically;
- the crop is then united with the core, so it always contains every differing pixel;
- discrepancies whose crops touch or lie within 18 px of each other are merged (cores and crops united, counts added), because they would otherwise show the same context twice.

The rules use only the ink around the core, never the core's position in the capture, so the same text gets the same crop wherever a form places it.

**Identity: change area plus image hash.** Each discrepancy's image hash is the SHA-256 of the core's width and height followed by the canonical and the candidate ARGB pixels inside the core. Grouping walks discrepancies in report order (rows in `results.json` order, discrepancies top to bottom, then left to right); a discrepancy joins the first earlier representative with the same image hash (representatives are kept in lists per hash, so a discrepancy is compared only with those that share its hash) whose core position matches: the mean of the four corner-coordinate matches, each `100 × (1 − |Δ| / extent)` over the capture's width or height, is at least 97 %. With equal hashes the cores have the same size, so this allows offsets whose shares of width and height add up to at most 6 %. Every discrepancy stays in the report and points at its representative; groups list their members. *Alternative:* position plus OCR text similarity, rejected because two empty OCR results compare as identical text, so OCR failures would merge unrelated changes.

**OCR with explicit states.** `Tesseract` 5.2.0 with `Tesseract.Data.English` 4.0.0 (`eng.traineddata` copied beside the comparer). One engine is created per run, before any row is analyzed, so missing language data or a failing native library is a setup error (exit 3). Each crop is scaled 4× with bicubic interpolation onto a white margin, thresholded at gray 210, cleared of control frames: thin horizontal lines that span most of the image or touch the drawn crop's left or right border, and thin vertical lines that span most of the image or run from the drawn crop's top border to its bottom border (a glyph stem that reaches one border stays), and read with page segmentation mode 6 at 300 dpi. Results are cached by the hash of the prepared image. Text is trimmed per line and blank lines are dropped; nothing else is changed. Neither words nor units are corrected toward what the app usually shows, because a correction can turn a real change into identical text on both sides, or show a unit that neither crop shows. The result is `text`, `empty`, `error` (with the exception message) or `disabled` (`--no-ocr`); whatever the engine throws for a crop, including failures while preparing the image, becomes that crop's `error`. When both sides are `empty`, the crop is widened by 48 px horizontally and 24 px vertically and read again; the widened crop is the one recorded. An `error` makes the run status `analysis-failures` (exit 2). *Alternative:* catching OCR errors as missing text, rejected because it turns a broken analysis into a quiet result.

**Report contract.** `contracts/schemas/parity-compare-report.schema.json`, title `CompareReport`: `runId`, `threshold`, `ocr` (`enabled`, `language`), `status` (`clear`, `differences`, `analysis-failures`), `rows`, `discrepancies`, `groups` and `totals`. A discrepancy's ID is `<case>/<capture>#<n>`. Generated C# and zod code, an example and both round-trip tests follow the existing contract rules; `ContractJson` gains the reader and writer.

**Exit status.** 0 when every row is `passed`; 1 when any row is `analyzed`, `size-mismatch` or missing and nothing failed; 2 when any row is `failed` or any OCR result is `error`; 3 on a setup error, with no report. Any other failure while analyzing a row, such as a crop that cannot be written, makes that row `failed`; a row's crops are written only after the whole row is analyzed, and when one cannot be written the crops already written for that row are removed. A failure while replacing `compare/`, grouping or writing the report exits with 3 and removes the partly written `compare/` folder. Printing comes after the report is written: a failure while printing exits with 3 and keeps the complete report. The printed status is the contract's name for it, so it always matches `report.json`. Capture paths are checked against the run folder with its trailing separator, so a run folder at a drive root works.

**`npm start` as a small Node script.** `parity/scripts/start.mjs` runs `npm run build:candidate`, then `npm run parity -- <args> --run-folder-file <file>`, then `npm run compare -- --run <folder>` with the folder that capture wrote to the file, through the npm that started it. The file lives in a temporary folder that the script removes afterwards. The comparer's own options, `--no-ocr` and `--tessdata <dir>`, go to the comparer and every other argument to capture. The script skips the comparer when capture exits with 3 (or with `--help`), treats a capture that exits with 0, 1 or 2 without writing the file as a setup error, and exits with the higher of the two statuses, which orders them by severity. `npm run compare` runs through `dotnet run`, which exits with 1 when the comparer cannot be built and with an arbitrary code when the process crashes, so the comparer's status counts only when it is 0, 1 or 2 and `compare/report.json` exists with the matching status (`clear`, `differences`, `analysis-failures`); otherwise the comparer's outcome is a setup error. A failed build, an npm child that cannot be started, a temporary folder that cannot be created, a run folder file that cannot be read, or any other error the script does not expect also exits with 3, never with Node's status 1, which would read as differences. `parity/scripts/tests/start.test.mjs` (`npm run parity:scripts:test`) runs the script against a stand-in for npm's CLI that plays each step's exit status and files. *Alternatives:* parsing the run folder from capture's output, rejected as fragile; generating the run ID in the script and resolving the runs folder there, rejected because it copies the capture runner's ID format and path rules into a second language; chaining with `&&`, rejected because capture's status 1 or 2 would stop the comparer exactly when it is needed.

**Capture `--run-folder-file`.** Once the capture runner has created its run folder, it writes the folder's full path (UTF-8, no newline) to the given file, resolved like its other paths against `--repo-root`. A failure to write it is a setup error recorded in the run's summary. Both tools read `--name value` options through one shared helper in `Parity.Cases`, and name case and capture folders with one shared rule there (`RunPaths`), so the comparer's crop folders follow the capture folders.

**Composition.** `Parity.Compare/Program.cs` is the composition root (`Microsoft.Extensions.DependencyInjection`). The OCR engine sits behind an interface so tests can substitute it; region finding, crop expansion, OCR preparation, grouping and report building are separate small classes.

## What fixtures prove and what only a live run proves

- **Unit tests on generated images prove:** a single differing pixel and a dark-to-dark color change become discrepancies; differing-pixel counts add up to the row total; crops contain their cores, cover a tall text line, do not follow a long vertical edge, show a label/value block far from the left edge and cut no row of a block; the size-mismatch, missing, passed and inconsistent-difference rows; grouping of equal changes and separation of different changes with empty OCR, and grouping 50,000 different discrepancies; the OCR states with a substituted engine; real Tesseract reading a rendered line of text; vertical frame removal keeping a stem that reaches one border; text kept as read; the shared pixel difference still giving the capture runner's ratios; the report contract round-trip; and the exit statuses. A Node test proves how `npm start` routes arguments and maps the comparer's outcome.
- **Only a live run proves:** that the comparer reads a real run folder written by the capture runner, that crops of real captures are readable and OCR reads them, that a change visible on several tabs forms one group, that `npm start` runs the comparer after capture reports differences and ends with 3 when the comparer cannot be built, and that the canonical executable's hash is unchanged. The live runs therefore include one with a candidate built from a scratch copy of the source with a deliberate visible change, which is never committed.

## Risks / Trade-offs

- [Tesseract's native libraries must load under .NET 10] → the engine is created before analysis, so a load failure is a setup error, and a unit test reads real text.
- [OCR text is noisy] → it is review aid only; it never decides grouping or whether a difference exists.
- [Crop heuristics use pixel sizes measured on this app's text] → they depend on the ink around the core only, not on positions in the window; a crop always contains its core, so a bad heuristic can only show too much or too little context, never hide a difference.
- [Exact image hashes separate occurrences of a change whose pixels vary slightly, for example antialiasing at another position] → accepted: a needless extra group costs a reviewer one extra look; a false merge hides a difference.
- [OCR on many crops is slow] → one engine per run and a cache by prepared image.

## Migration Plan

Additive, apart from `npm start`, which now also runs the comparer. Rolling back means reverting the change's commits; `out/` holds only disposable run output.
