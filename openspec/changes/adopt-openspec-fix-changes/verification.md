# Verification

Host: Windows 10 Pro 22H2 (10.0.19045), .NET SDK 10.0.401, Node 22.17.0, OpenSpec CLI 1.13.2 (pinned), Claude Code CLI 2.1.284 (named in a local profile), `@openai/codex-sdk` 0.159.3. Canonical executable `bin/ChummerGenSR4.exe`, pinned SHA-256 `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.

## Fixture-tested scope

These checks use no desktop and no model. They ran on the branch tip before this file was written (`154c520`), which holds all of the change's code and tests.

| Command | Result |
|---|---|
| `npm ci` | `found 0 vulnerabilities` |
| `npm run openspec:validate` | `Totals: 11 passed, 0 failed (11 items)` |
| `npm run fixes:validate` | `No items found to validate.`, `No archived changes found.`, exit 0 |
| `npm run workflow:typecheck` | no output, exit 0 |
| `npm run workflow:test` | `# tests 298`, `# pass 298`, `# fail 0` |
| `dotnet build parity/Parity.slnx -c Release --nologo` | `0 Error(s)` |
| `npm run contracts:check` | `Generated contracts are up to date (12 files).` |
| `npm run contracts:test` | `# tests 8`, `# pass 8`, `# fail 0` |
| `npm run parity:test` | `Passed! - Failed: 0, Passed: 185, Skipped: 0, Total: 185` |

The change touches no C# source, schema or generated file, so the parity build, the parity tests and the contract checks only show that nothing else moved.

### What the new tests cover

- Fix change format and CLI (task 1.1; `fix-changes.test.ts`): the change name; the three artifacts rendered from a record (headings, members with OCR text kept on one line, singular words for one member, case, capture or line, the challenge, the check's observations, the tasks with blockers as `1.<id>`, the narrow check and each level with its execution apart from its visual result and its findings); a draft without widening has no verification; the real CLI creates, validates and archives a rendered change in a staging root (`.openspec.yaml`, `fix.json` read back equal to the record, nothing left in `changes/`, `openspec validate --archived` printing `1 passed, 0 failed`); an open or missing checked task is refused before the CLI runs; a CLI failure is a setup error holding its output and stops the archive; a fixes root without the schema is a setup error.
- Option (task 1.2; `options.test.ts`): `--fix-changes` is parsed and stored in the run options, absent options and older stored options read as off, and `--fix-changes --unattended` is a setup error.
- Priors (task 1.3; `fix-priors.test.ts`): each score part (8 for the image hash, 3 per capture, 1 per case, 4 × the OCR words' Jaccard similarity, 0 when nothing is shared); the cut at three by score then name; the archive read by folder, with a folder without `fix.json` and an invalid record each a setup error naming it; the context's `priors` with score, reasons, claim, mechanism, files and the four artifacts' hashes, copied into `priors/`, changing the context hash, and a context with fix changes but nothing similar equal to one without; the hypothesis prompt's section and version `hypothesis-v1+priors-v1`, the challenge prompt without any prior; through the graph, a thread with `--fix-changes` showing a fixture repository's archived fix to the hypothesis job and recording that version, while the challenge record keeps `challenge-v1` and a thread without the option shows none.
- Planned repair (task 1.4; `repair-planned.test.ts`): plan validation (order, lower blockers, unsafe paths and paths outside `Chummer/`, a file named twice, more than 10 files or 5 subtasks, overlapping files of subtasks that may run together but not of ones that wait for each other, `no_plan` with subtasks, empty texts) and the blocker closure; three subtasks where 1 and 2 run at the same time (pool peak ≥ 2), 3 starts on a copy with both their changes, each job in its own folder that is removed, the plan job read-only, the joined patch built and checked once, the archive's `planned` with each subtask's record and files, the draft `fix/fix.json` (no widening, the plan's record, the blockers), its `tasks.md` and the labels and prompt versions of the plan and subtask records; a conflict between subtasks rejected at stage `patch` before a build and without a draft; a subtask that changed an unlisted file, a declining subtask and an invalid subtask answer ending the attempt with no further wave, with attempts numbered 1, 2, 3 over the subtask records; a declining plan and a plan with a cycle (`invalid_output`, cluster `failed`); a usage limit in a subtask parking the attempt with the plan's and the subtask's records and the next attempt numbered 2; a budget spent after the plan leaving the cluster `budget_exhausted` with the plan's record; a deadline that passed after the plan. The C4 to C6 repair, loop and widening tests run unchanged on the single-job path.
- Promotion (task 1.5; `fix-promotion.test.ts`): through the graph with a real git repository and the real CLI, the fix commit holds `Chummer/frmCreate.cs` and exactly the five files of `fixes/openspec/changes/archive/<date>-fix-<cluster>-<suffix>/`, the snapshot commit holds none of them, `fix.json` lists the four levels, `verification.md` and `tasks.md` read as rendered, the repository's HEAD and status stay as they were and the CLI's `validate --archived` passes on the staging root; without the option the fix commit holds `Chummer/frmCreate.cs` only and no plan job runs; a promotion killed after the branch moved resumes without archiving again or committing twice; a passed attempt whose draft went missing ends the run with a setup error and no branch.
- Comparison (task 1.6; `thread-comparison.test.ts`): two pairs (fix rate difference 0, `no-difference`; model time mean difference 80 s, standard error 20, interval from Student's t with one degree of freedom); verdicts on the better side of each metric, including pairs that all moved by the same amount; one pair is `too-few-pairs`; unpaired clusters listed; a cluster twice on one side is a setup error; a thread's measures count only its own workflow records per cluster, with a cost only when every job reported one; a thread without `outcome.json` is a setup error; `npm run eval -- compare-threads` prints both metrics, writes the comparison under `out/evals/comparisons/` and refuses an empty or missing side.

## Live evidence

### Setup

The suite has no discrepancy between the candidate and the canonical executable on the current source (the whole-suite run recorded for the loop found 13 cases, 211 rows, 0 clusters), so the live runs use seeded discrepancies: one designer location of the build form's Common tab changed in the working tree, not committed, for each seed, and reversed byte for byte afterwards (`Chummer/frmCreate.Designer.cs` SHA-256 `b793470b…4911` before and after every seed, `git status` clean at the end).

| Seed | Edit | Cluster |
|---|---|---|
| A | `lblMetatypeSourceLabel` from `Point(628, 32)` to `Point(640, 32)` (file `805b5d14…264c` while seeded) | `d-14297e69d59676fd` |
| B | `lblMetatypeLabel` from `Point(628, 9)` to `Point(640, 9)` (`5008223e…9fdb`) | `d-2d30aa1880e900b1` |
| C | `lblAttributes` from `Point(285, 32)` to `Point(297, 32)` (`40828b6a…5c62`) | `d-084de8207b3034fe` |

Every run: `npm.cmd start -- --settings-overlay out/overlays/fixture-books --case-file out/experiment/cases/characters.json --case Diego_v_alpha2_by_bessgeor --capture common`, with `--fix-changes` for the candidate side. The overlay's `settings/default.xml` holds the fixture books (SHA-256 `e85690ffd9c6257427e5a059bf3258f7d025e2bb8ff45f44877653c43221dda1`). The case file is a copy of `parity/cases/characters.json` reduced to three characters, so that each thread's widening runs all four levels in minutes: `Diego_v_alpha2_by_bessgeor` (build; the thread's scope and the `character` level), `rigger` (build; the `mode` level) and `rigger_career` (career; the `suite` level). `PARITY_WORKFLOW_PROFILE` named a profile that sets only `agents.executables.claude`, so hypotheses, plans, subtasks and repairs ran on Claude and challenges on Codex with their default models, `repair.maxAttempts` 2, a 120-minute run budget. The canonical cache came from `PARITY_CANONICAL_CACHE` (a folder outside the repository shared by the worktrees). Every canonical side came from the cache except one: run B with fix changes captured `career-rigger_career` (`common`, `skills`) live in its diagnosis check run and stored it, and later runs took it from the cache. `Get-FileHash` printed `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` before and after each run and after the kill, and all 99 `Canonical SHA-256 before`/`after` lines of the seven process logs print that hash.

The runs of seeds A and B ran on commit "Compare finished threads in pairs by cluster, and describe fix changes" (`fb42520`), those of seed C on "Use singular words for one member, case, capture or line in a fix proposal" (`154c520`), which changes only the wording of a fix change's proposal (run B's fix change, below, reads `1 members`; run C's reads `1 member`). The later commits change `openspec/` only.

### Runs

Each seed's discrepancy was the only cluster of its threads, in `build-Diego_v_alpha2_by_bessgeor/common`. Capture execution, for every thread: capture status 1, coverage valid and contiguous, 0 failures, 6 optional absent; visual: 0 passed, 1 failed, compare `differences` with 1 discrepancy in 1 group, completeness 16 planned, 1 reported, 15 filtered, 0 analysis-failed, 0 execution-lost, 0 unaccounted. The baseline of each seed reused the capture and compare steps its candidate thread had recorded (same inputs), and said so.

| Thread | Side | Seed | Diagnosis | Repair | Widening | Outcome | Model time | Elapsed |
|---|---|---|---|---|---|---|---|---|
| `wf-20261002T063355Z-43d566e7` | fix changes | A | hypothesis abstained (no archived fix existed, so prompt `hypothesis-v1`) | none | none | `findings_remaining` (`abstained`) | 0.5 min | 1.5 min |
| `wf-20261002T063654Z-7864f1c1` | baseline | A | confirmed | 1 job, passed | 4 levels passed, promoted | `verified_for_scope` | 4.5 min | 12.6 min |
| `wf-20261002T065340Z-af6c360d` | fix changes | B | confirmed | plan with 1 subtask, passed | 4 levels passed, promoted with its fix change (killed and resumed) | `verified_for_scope` | 2.7 min | 14.1 min |
| `wf-20261002T070816Z-813f4217` | baseline | B | confirmed | 1 job, passed | 4 levels passed, promoted | `verified_for_scope` | 7.6 min | 16.7 min |
| `wf-20261002T072601Z-ff07d7e5` | fix changes | C | confirmed, with run B's fix change as a prior | plan with 1 subtask, passed | 4 levels passed, promoted with its fix change | `verified_for_scope` | 2.1 min | 12.0 min |
| `wf-20261002T073818Z-61635e99` | baseline | C | confirmed | 1 job, passed | 4 levels passed, promoted | `verified_for_scope` | 1.6 min | 10.1 min |

Execution apart from the visual results, for the five threads that reached the check: every diagnosis check run had capture status 1, valid coverage and 0 failures (observations: `build-Diego_v_alpha2_by_bessgeor/common` and `build-rigger/common` differ, `career-rigger_career/common` and `build-Diego_v_alpha2_by_bessgeor/skills` match, as far as each check captured them); every narrow check had capture status 0, valid coverage, 0 failures and visually 1 passed, 0 failed; every widening level had capture status 0, valid coverage and 0 failures, and visually `narrow` 1, `character` 13, `mode` 14 and `suite` 20 rows passed, 0 failed, so no row needed attribution and no baseline capture ran. Each exited with 1, from the thread's own capture.

### Fix changes written live

- Run B (`wf-20261002T065340Z-af6c360d`): the plan job (`…/repair/1`, `repair-plan-v1`, 36.9 s) planned one subtask, which its job (`…/repair/1/task-1`, `repair-task-v1`, 17.6 s) implemented in its own copy; the joined patch changed one line. The plan is worth noting: the hypothesis had claimed that the value label should move to about x=700; the plan, reading the same crops and source, explained why that would not match the canonical capture and planned moving the caption back to `Point(628, 9)`, which passed every level. Promotion printed `widen d-2d30aa1880e900b1: fix change 2026-10-02-fix-d-2d30aa1880e900b1-af6c360d archived for the fix commit.` and committed `acdce45` on `accepted/wf-20261002T065340Z-af6c360d` with the trailers `Workflow-Thread`, `Discrepancy` and `Repair-Record: …/repair/1`; its tree changed `Chummer/frmCreate.Designer.cs` (1 line added, 1 removed) and added `fixes/openspec/changes/archive/2026-10-02-fix-d-2d30aa1880e900b1-af6c360d/` with `.openspec.yaml` (`schema: fix`, `skip_specs: true`), `fix.json` (210 lines), `proposal.md`, `tasks.md` (`- [x] 1.1 "Move lblMetatypeLabel on frmCreate to x=628". Files: `Chummer/frmCreate.Designer.cs`. Blocked by: none. …`) and `verification.md` (the narrow check and the four levels with their run folders). Copied from that commit into the working tree's fixes archive, it passed `npm run fixes:validate` (`✓ change/2026-10-02-fix-d-2d30aa1880e900b1-af6c360d`, `Totals: 1 passed, 0 failed (1 items)`).
- Run C (`wf-20261002T072601Z-ff07d7e5`): plan (14.5 s) with one subtask (16.6 s); fix change `2026-10-02-fix-d-084de8207b3034fe-ff07d7e5` in `555a2cc`, the same five files beside the one-line change of `lblAttributes`.
- Kill and resume: run B was killed with `taskkill /T /F` on its process tree at 11:03:14 local time while its `character` level was capturing (run folder `20261002T070257Z-3991e16b`, left without a result); no Chummer process remained. `npm.cmd start -- --resume wf-20261002T065340Z-af6c360d` printed `Taking over the desktop lane from process 37804, which is no longer running.`, and went on at the `character` level (run `20261002T070332Z-eab0b785`) without repeating the capture, diagnosis, repair or the widened build; it then archived the fix change and promoted.

### Retrieval

Run C's thread had one archived fix change in the working tree's `fixes/openspec/changes/archive/`: run B's, copied there uncommitted from its commit (byte sizes equal to the blobs) as a merge of the accepted branch would put it, and removed after the seed C runs. Diagnosis printed `Diagnosis: 1 archived fix changes to rank as priors.`; the cluster's sealed context listed it with score 4 and the reasons `capture common` and `case build-Diego_v_alpha2_by_bessgeor`, its claim, mechanism `layout`, file `Chummer/frmCreate.Designer.cs` and the hashes of its four files under `priors/`. The hypothesis record carries `hypothesis-v1+priors-v1`, the challenge record `challenge-v1`. The hypothesis named `lblAttributes` at x=297 against 285. Runs A and B with fix changes found `0 archived fix changes`.

### Paired comparison

`npm.cmd run eval -- compare-threads --baseline wf-20261002T063654Z-7864f1c1,wf-20261002T070816Z-813f4217,wf-20261002T073818Z-61635e99 --candidate wf-20261002T063355Z-43d566e7,wf-20261002T065340Z-af6c360d,wf-20261002T072601Z-ff07d7e5` printed (exit 0):

```
Comparison of threads wf-20261002T063355Z-43d566e7, wf-20261002T065340Z-af6c360d, wf-20261002T072601Z-ff07d7e5 against wf-20261002T063654Z-7864f1c1, wf-20261002T070816Z-813f4217, wf-20261002T073818Z-61635e99: 3 cluster pairs.
  fixRate (higher is better): 3 pairs; mean 1.000 -> 0.667; mean paired difference -0.333, standard error 0.333, 95% t interval [-1.768, 1.101]: no-difference
  modelTime (lower is better): 3 pairs; mean 275.799 s -> 108.159 s; mean paired difference -167.640 s, standard error 100.548, 95% t interval [-600.299, 265.020]: no-difference
  cost: mean paired difference n/a USD over 0 pairs with every cost known
```

Per cluster (seconds of the thread's records for that cluster, baseline → fix changes): A 272.8 → 32.9, B 457.4 → 163.5, C 97.2 → 128.1. No cost is compared because Codex reports none for the challenge jobs.

**Result: no improvement.** With n = 3 pairs neither interval excludes zero, so the claim that working in fix changes with retrieved priors improves the fix rate or the model time is not supported, and `--fix-changes` stays off by default. Reading the records behind the numbers:

- The only cluster not fixed is seed A on the fix-change side, whose hypothesis abstained with the same prompt (`hypothesis-v1`, no priors) as the baseline's, which named the cause; that difference is the model's variation, not the option's.
- Model time is dominated by the Codex challenge job, whose prompt is the same on both sides: 196.6, 401.9 and 50.0 s on the baseline, 75.1 and 70.4 s on the fix-change side (none for seed A, which ended after its hypothesis). The jobs that do differ cost more with fix changes: plan and subtask together 54.5 s (B) and 31.1 s (C) against 20.7 s and 16.0 s for the single repair job, and Claude's reported cost 0.322 and 0.166 USD against 0.097 and 0.072 USD. The hypothesis with a prior took 26.6 s against 31.2 s.

### After the runs

The five accepted branches the runs made (`accepted/wf-20261002T063654Z-7864f1c1` at `f434545…`, `…065340Z-af6c360d` at `acdce45…`, `…070816Z-813f4217` at `7d8447f…`, `…072601Z-ff07d7e5` at `555a2cc…`, `…073818Z-61635e99` at `76f666e…`) were deleted with `git update-ref -d` and their expected values after these facts were recorded, since their source commits hold the seeded edits. The fix changes of runs B and C therefore exist only as copies outside the repository; none is committed. No usage limit was reached, so no quota wait happened.

## What remains unverified

- The claim itself: three pairs of seeded discrepancies show no improvement in fix rate or model time (intervals above), which is recorded as "no improvement". A conclusion either way needs more pairs, and real discrepancies, of which the suite has none on the current source.
- Parallel subtasks and the join live: every live plan had one subtask, so two subtasks running at the same time, a blocked subtask's copy, a join of several subtasks and a conflict are fixture-tested only.
- Retrieval with more than one archived fix, the cut at three and the OCR score live: run C had one candidate prior, scored by capture and case only.
- Whether a prior helps a hypothesis: run C is a single run with a prior, and its baseline found the same cause without one.
- A promotion resumed after its commit (taking the commit without archiving again), a missing draft, a usage limit, the budget and the deadline in a planned attempt: fixture-tested only; the live kill came during a widening level, before the promotion.
- A fix change in the repository's own archive: none is committed, since the live ones belong to seeded edits; `npm run fixes:validate` passed on an empty archive and on run B's change copied into the working tree.
- The whole suite with `--fix-changes`: the live runs used a three-case case file. Fix changes change no capture, compare or triage code.
- A quota wait during a planned attempt: none occurred.
