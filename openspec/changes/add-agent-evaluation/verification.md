# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), .NET SDK 10.0.401, Node 22.17.0, Claude Code CLI 2.1.284 (the desktop app's bundled `claude.exe`, named in a local profile under `out/`), `@openai/codex-sdk` 0.159.3 with the Codex CLI it ships. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

The live evidence below was collected on the commit "Add certificates, the unattended start gate and the evaluation docs", the last commit that changes code under `workflow/src/`. The commits after it change a test fixture (each fixture thread of the evaluation tests gets its own snapshot commit), the proposal's wording and this file; none of them can change what the live runs show. The fixture-tested checks were run on the tree of the test-fixture commit.

## Fixture-tested scope

These checks use no desktop, no model and no live app.

| Command | Result |
|---|---|
| `npm run openspec:validate` | `Totals: 7 passed, 0 failed (7 items)` |
| `npm run workflow:typecheck` | no output, exit 0 |
| `npm run workflow:test` | `# tests 175`, `# pass 175`, `# fail 0` |
| `dotnet build parity/Parity.slnx -c Release` | `0 Warning(s)`, `0 Error(s)` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 185, Skipped: 0, Total: 185` |

This change touches no C# source, schema or generated contract; the last three rows confirm that the parity build and the contracts are unaffected.

One run of `npm run workflow:test` on the code commit failed one test (`a challenge run scores the challenger's verdict on each item's hypothesis`: 1/2 instead of 2/4 samples). The cause was the test fixture: the two fixture threads build their source snapshots from fresh git repositories, and two repositories committed in the same second get the same commit, so the two threads sealed the same contexts and the dataset had half the items. The fixture now pins a different commit date for each thread; the dataset and eval-run tests then passed three runs in a row, and the whole suite passed.

### What the new tests cover

- Labels and benchmark (`eval-labels.test.ts`, a temporary git repository): a version-1 record is read with origin `workflow`, its `check` label and empty other labels, and setting a label writes version 2 and leaves every other field and label unchanged; an out-of-range grader score is rejected by the schema; records are listed across job kinds and over more than one page. Grades: a line within 3 lines of a changed range or a symbol named in a hunk header or changed line is `symbol`, the right file at a distant line is `file` (the spec's "right file, wrong line"), Windows separators are normalized, a different file with the same mechanism is `mechanism`, else `wrong`, no explanation is `abstained`; a reviewer's root cause grades the same way. A unified diff is parsed into files and hunks (a removed line that starts with `--`, a deleted file, CRLF lines); a fix that undoes its regression is `revert`, another change or another file is not. `benchmark add` takes the base from the fix's parent, the commit time, the members from the newest thread's `triage.json`, the patch limited to the app's folders, the ranges and the thread; it refuses an existing item, an unknown cluster, commit or mechanism, a commit that changes only other folders and a merge commit, and then writes nothing. `benchmark check` names an item whose stored patch differs from git or whose commit is missing, and the command exits with a setup error. Hindsight grades succeeded workflow hypotheses and challenge alternatives before the earliest covering fix; a record that finished after the first fix gets the later item's grade, one after every fix, a failed record, an eval-run record and another cluster's record get none; a second run changes nothing. `eval records` prints the counts; an unknown option or command is a setup error.
- Grader and queue (`eval-grader.test.ts`, real diagnosis threads from the fixture harness, a fake agent runner): each of the four answers is graded in a scratch copy outside the thread folder holding `context.json`, the crops and the snapshot, with the crops as images and the challenged hypothesis in a challenge's prompt; the graded record gets `grader` with the grade record's ID, and the grade record has job kind `grade`, origin `grader`, the record as subject and `grade-v1`; graded records are not graded again unless named. A score of 1.4 is `invalid_output`: recorded, no label, exit status 2. A usage limit waits one minute and grades again; `infra` and a context changed after sealing are setup errors (the latter before any job). The queue puts disagreements first (confirmed but graded wrong; refuted but graded right), then samples per job kind and check label by the seed's order, ordered by the grader's distance from 0.5 with ungraded last, and leaves out reviewed, eval-run and failed records; `eval queue` prints it.
- Review page (`review-page.test.ts`, a real HTTP server on 127.0.0.1): the queue page counts the records; the record page has both crops, the difference canvas, OCR, the answer, the cluster's check from `diagnosis.json`, the verdict buttons, and a challenge's hypothesis; the evidence route serves a listed crop as `image/png` and answers 404 for `../context.json`, `context.json`, `evidence/../context.json`, a backslash path, `../../diagnosis.json`, an empty name and an unknown record; an invalid verdict is 400 and an unknown record 404 without writing the store; a valid verdict stores the trimmed note, the reviewer and the time, keeps the check label, and answers 303 to the next queued record.
- Datasets (`eval-dataset.test.ts`): items are one per context with copies of the context and snapshot, observations from the capture runs and the check run (`differs`, `matches`), partitions by cluster (both threads' items of one cluster in one partition), challenge items with their hypothesis; loading verifies and returns the same dataset; two runs that disagree leave a capture `not-observed`; partitions at 0% and 100% and a mix at 30%; gold from the earliest of two covering benchmark items, else from a `correct` review; a second version names the first's hash and the first is unchanged; an edited crop or snapshot file in a copy is refused on load naming the item; records whose thread folder is gone are left out with a line each; no record is a setup error; an invalid name is refused.
- Eval runs and comparison (`eval-run.test.ts`): Wilson intervals (3/3 lower 0.4385; 5/10 [0.2366, 0.7634]), t quantiles (12.706 at 1, 2.042 at 30, 2.021 at 40, 1.980 at 120) and the paired t interval of 1, 0, 1, 1 ([-0.0455, 1.5455]) against hand-computed values; the prediction and root-cause rules of both job kinds; a run of 4 items × 2 repetitions in scratch copies outside the dataset with its settings, records of origin `eval-run`, two `invalid_output` samples counted, root cause only where gold exists, cost and the summary file; a run stopped while two jobs hang keeps its two finished samples, and `--resume` runs only the other two with the effort stored at the start; a changed prompt version and an unknown run refuse the resume; a challenge run scores an alternative that the observations refute as a fail and no alternative to a holding hypothesis as a pass, on Codex by default. The comparison of hand-written runs: differences 1, 0, 0, 1, 0 give mean 0.4, SE 0.2449, [-0.2799, 1.0799] and `no-difference`, the effort difference, cost over pairs with both costs; all-pass against all-fail is `improved` or `worse`; one pair is `too-few-pairs`; different datasets, partitions or samples and an incomplete run are setup errors.
- Certificates and the gate (`eval-certificate.test.ts`): 20/20 on the test partition issues a certificate with the configuration, counts, interval and no mean cost; 3/3 at 0.8, the development partition, a missing sample, an unknown cost with a cost limit and a mean cost above the limit are refused with their reasons and nothing written; `eval certify` exits 1 when refused and 0 when issued. The gate names a missing certificate per job kind, a differing effort and prompt version, an unreadable file and a certificate of another job kind, and passes matching ones; no job kind is dispatched with `--no-diagnosis` or `--only triage`. Through the graph: `--unattended` without certificates ends with 3 before any step and prints no thread; with `--no-diagnosis` it runs; with both certificates it runs, a thread stopped by an `infra` failure is refused on resume once a certificate is removed and resumes when it is back. `--unattended` is parsed and kept in the options with the certificates folder from the profile or the default.

## Live evidence

### Setup

The live runs used the eval records of the real diagnosis threads that the workflow's live runs had produced before this change: the store (`out/workflow/store.sqlite`, 12 records of schema version 1: 6 hypotheses on Claude and 6 challenges on Codex, all `succeeded` and `check: confirmed`, cluster `d-14297e69d59676fd`), the thread folders with their sealed contexts and snapshots, and the settings overlay with the fixture books were copied into this worktree's git-ignored `out/`. The capture and check run folders the threads name were read where they lie. `PARITY_WORKFLOW_PROFILE` named a profile under `out/` that sets `agents.executables.claude` and `certificates: out/live-certificates`, so no certificate was written to `workflow/evals/certificates/`; the effort comparison used a second profile that also sets `agents.jobs.hypothesis.effort: low`. The models, providers and efforts were otherwise the defaults (hypothesis and grade on Claude, challenge on Codex, the CLIs' default models, effort medium). `Get-FileHash -Algorithm SHA256 bin/ChummerGenSR4.exe` printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before the first and after the last live command.

### Records and the upgrade

`npm.cmd run eval -- records`, exit 0: `Eval records: 12.`, `workflow challenge: 6; results succeeded 6`, `workflow hypothesis: 6; results succeeded 6`, each with `check confirmed 6; hindsight none; review none; graded 0`. The version-1 records were read without error.

### Advisory grader (Claude)

`npm run eval -- grade`: `Grader: 12 records on claude (default model, effort medium).`, then one line per record and `Grader: 12 graded, 0 failed.` The 12 grade records are `succeeded`, 16 to 48 s each, 25 837 to 54 475 input tokens, 0.096 to 0.185 USD each. Scores: challenges 0.75 to 0.86; hypotheses 0.6, 0.7, 0.72, 0.66, 0.2 and 0.08. The two low scores come with rationales saying that the cited designer lines are right but that the crops, measured by eye, do not show the 12 px shift the hypothesis claims; the grade is advisory and changed no other label. Afterwards `records` printed `grader grade: 12` and `graded 6` for each workflow job kind.

### Review queue and page

`npm run eval -- queue`, exit 0: `Review queue: 6 records (0 disagreements).`, three hypotheses and three challenges (the sample of 3 per stratum), the grader's least certain first (0.6, 0.66, 0.75, 0.2, 0.86, 0.86).

`npm run review` printed `Review page: http://127.0.0.1:4317/ (Ctrl+C ends it)`. Over HTTP: the queue page answered 200 with `6 records wait for a verdict; 0 reviewed`; the record page of `wf-20261001T204540Z-d8f02510/d-14297e69d59676fd/hypothesis/1` answered 200; `evidence/1-canonical.png` answered 200 `image/png` (2 149 bytes); `../context.json`, `context.json`, `evidence/../context.json` and `../../diagnosis.json` answered 404. Headless Edge (`msedge --headless=new --screenshot`) rendered the record page: the grader's score and rationale, the verdict buttons, both crops of `build-Diego_v_alpha2_by_bessgeor / common` ("(Aug) Metatype Limits Source: RC 53"), the difference drawn in the browser with the caption `339 changed pixels` (the manifest records 339 differing pixels), the OCR texts and the answer. A post with verdict `maybe` answered 400. A post with verdict `unclear` and the note "live check of the review page by the agent; not a real verdict" answered 303 to the next queued record, the page then counted `1 reviewed`, and the server logged the verdict. That verdict was not a person's review, so the store was restored from a copy taken just before the review page started; `records` afterwards printed `review none` for every job kind with the grader labels intact. The server was ended by stopping its process tree, so its Ctrl+C path did not run live.

### Frozen datasets

The records belong to one cluster, so `--test-percent 100` put every item in the test partition (with one cluster every item lies in one partition whatever the percentage; 100 makes it the test partition, which certificates need).

- `npm run eval -- freeze --job hypothesis --name live-hypotheses --test-percent 100 --reason "…"`, exit 0: `Dataset live-hypotheses v1 (hypothesis): 6 items, 6 test and 0 development, 0 with gold; hash 90538eec01189babdf76d2f82bbe0808ddbddd821014de17f3f273ce92cc57ce`. Each item has one record (each thread sealed its own context) and 4 to 8 observed captures from its thread's capture run and check run (for example 3 `differs` and 5 `matches`).
- `npm run eval -- freeze --job challenge --name live-challenges …`, exit 0: `6 items, 6 test and 0 development, 0 with gold; hash 9cc3720d24155b82ba46ab82eb0fac2ba2e9b7b7ff614de3c998567e33054552`; every item has its hypothesis. The two datasets with their copies take 58 MB.

### Eval runs, a kill and the resume

- Baseline, `npm run eval -- run --dataset out/evals/datasets/live-hypotheses/v1 --name baseline` (Claude, effort medium), run `er-20261001T214237Z-0a7ca4b1`: after 2 of 6 sample files existed, `taskkill /T /F` ended the process tree; the log held `6 of 6 samples to run` and two sample lines. `npm run eval -- run --resume er-20261001T214237Z-0a7ca4b1`, exit 0: `4 of 6 samples to run`, four sample lines, then `prediction: 5/6 = 0.833, 95% Wilson [0.436, 0.970]`, `root cause: 0/0 (no samples)`, `failures: invalid_output 0, refused 0; model time 218.4 s; cost 1.0718 USD`. The failing sample abstained. The killed process left the scratch copies of the two jobs it stopped (416 files each, removed by hand) and two empty scratch folders of the two jobs that had finished before the kill (removed by hand); the resumed process left none.
- Candidate, the same dataset with `agents.jobs.hypothesis.effort: low`, run `er-20261001T214532Z-b8c4e893`, exit 0: `prediction: 1/6 = 0.167, 95% Wilson [0.030, 0.564]`, model time 130.9 s, cost 0.6685 USD; four samples abstained and one predicted `matches` for a capture that differs.
- Challenge, `npm run eval -- run --dataset out/evals/datasets/live-challenges/v1 --name codex-default` (Codex, effort medium), run `er-20261001T214714Z-3b4959d5`, exit 0: every challenger answered `no_alternative`; `prediction: 6/6 = 1.000, 95% Wilson [0.610, 1.000]`, model time 254.2 s, `cost 0.0000 USD (6 samples without a reported cost)` (Codex reports no cost).

### Paired comparison

`npm run eval -- compare --baseline er-20261001T214237Z-0a7ca4b1 --candidate er-20261001T214532Z-b8c4e893`, exit 0:

- prediction: 6 pairs; pass rate 0.833 → 0.167; mean paired difference −0.667, standard error 0.211, 95% t interval [−1.209, −0.125]: `worse`. Hand check: differences −1, −1, −1, −1, 0, 0 give s = 0.5164, SE = 0.2108 and t(0.975, 5) = 2.571.
- model time: mean paired difference −14.6 s; cost: −0.0672 USD over 6 pairs; configuration differences: `effort medium -> low; name baseline -> effort-low`.
- With `--metric rootCause`: `0 pairs … too-few-pairs` (the dataset has no gold).

### Certificates

| Command | Exit | Output |
|---|---|---|
| `certify --run er-20261001T214237Z-0a7ca4b1 --metric prediction --min-pass 0.8` | 1 | `the lower bound 0.436 of the 95% interval of prediction (5/6) is below 0.8` |
| `certify --run er-20261001T214714Z-3b4959d5 --metric prediction --min-pass 0.6 --max-mean-cost-usd 1` | 1 | `6 samples have no reported cost, so the mean cost cannot be checked` |
| `certify --run er-20261001T214532Z-b8c4e893 --metric prediction --min-pass 0.4` | 1 | `the lower bound 0.030 of the 95% interval of prediction (1/6) is below 0.4` |
| `certify --run er-20261001T214237Z-0a7ca4b1 --metric prediction --min-pass 0.4` | 0 | certificate for `hypothesis`: claude (default model, effort medium), hypothesis-v1; 5/6, [0.436, 0.970] |
| `certify --run er-20261001T214714Z-3b4959d5 --metric prediction --min-pass 0.6` | 0 | certificate for `challenge`: codex (default model, effort medium), challenge-v1; 6/6, [0.610, 1.000] |

The thresholds of the two issued certificates were chosen to exercise the issuing path on six samples; they are no recommendation, and the certificates stayed in `out/`.

### `npm start -- --unattended`

All three runs used `--settings-overlay out/overlays/fixture-books --case Diego_v_alpha2_by_bessgeor --capture common` and the shared canonical cache from `PARITY_CANONICAL_CACHE` (a folder outside the repository).

- Without certificates, exit 3, before the build and without a thread: `Setup error: --unattended needs a certificate for every job kind diagnosis dispatches:` with `hypothesis: no certificate (…out\live-certificates\hypothesis.json)` and `challenge: no certificate (…)`. No desktop use.
- With both certificates and the effort-low profile, exit 3 before the build: `hypothesis: the certificate is for effort medium, the run uses low`. No desktop use.
- With both certificates and the default profile, thread `wf-20261001T215013Z-e563bc74`, exit 0. The candidate build printed `Canonical SHA-256 before` and `after` `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` and the candidate SHA-256 `2e429c434c15c367d06c5835e2f36f6d647f40dd224f995e1b835f8539a99373`; the parity tools built with 0 warnings and 0 errors.
  - Execution: capture run `20261001T215021Z-4a199b28`, status 0; coverage valid, contiguous, 2 sides, 92 actions, 0 failed, 0 startup failures, 6 optional absent, 30 filtered, 0 not run; the canonical side came from the cache (1 hit, 0 misses; entry stored by an earlier run), so only the candidate ran live. The capture printed the canonical hash before and after, and the staged copy's hash, all `9ff30099…e56`.
  - Visual: 1 passed, 0 failed; compare status 0, report `clear`, 0 discrepancies in 0 groups; completeness 16 planned, 1 reported, 15 filtered, 0 optional absent, 0 analysis-failed, 0 execution-lost, 0 unaccounted.
  - Triage 0 clusters; diagnosis 0 clusters, so no model job ran and no check capture started.

### Benchmark and hindsight

`npm run eval -- benchmark check`, exit 0: `Benchmark: 0 items replay from git.` `npm run eval -- hindsight`, exit 0: `Hindsight: 0 answers graded (…); 0 labels set.` The repository has no accepted fix of a discrepancy cluster yet, so no benchmark item exists. The final `records` printed 42 records: the 12 workflow records, 12 grader records, 12 eval-run hypotheses and 6 eval-run challenges, all `succeeded`.

## What remains unverified

- Hindsight on a real accepted fix, a real benchmark item and `benchmark add` against this repository's history: no accepted fix exists. Item creation, revert detection, `benchmark check` with items, hindsight grades, disagreements in the queue and gold root causes in datasets are fixture-tested only (temporary git repositories and hand-made items). The root-cause metric therefore has no live sample (`0/0`), and a live comparison on it was `too-few-pairs`.
- A person's review verdict: the only live verdict was the agent's own check of the page, and it was undone. Gold from review is fixture-tested only.
- The development partition and a dataset with more than one cluster: the live records cover one cluster. Partitioning is fixture-tested.
- Live `invalid_output`, `refused`, `infra` and quota-limit outcomes of grade and eval-run jobs: every live job succeeded. Their handling is fixture-tested with a fake agent runner.
- The certificate check on `npm start -- --resume`: fixture-tested only; the live unattended runs were fresh starts.
- The review server's Ctrl+C end; it was stopped by ending its process tree.
- The thresholds of a useful certificate: the live datasets are too small for any certificate whose lower bound is high; the issued ones only show that the path works.
- Scratch folders after a hard kill: the killed eval-run process left its running jobs' copies and two empty folders of finished jobs (removed by hand). The empty folders were not reproduced and their cause is not proven; a resumed run left none.
- The GitHub Actions job runs the new tests only through `workflow:test`; it has not run on GitHub.

## Archive
