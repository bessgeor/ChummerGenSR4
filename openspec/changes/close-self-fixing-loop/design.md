# Design

## Context

A thread's graph runs build, capture and compare per case, triage, then diagnosis of every cluster (hypotheses and challenges fanned out with `Send`, one batched check), one repair attempt per confirmed cluster (fanned out, each judged by the patch guard, a build and a narrow check), and the widening of each passed attempt one cluster at a time, with promotion on `accepted/<thread>` or rollback. Each stage writes its document (`triage.json`, `diagnosis.json`, `repair.json`, `widening.json`) and its report lines, and the graph ends after the last stage that is turned on. The repair service already numbers a cluster's attempts by its records, so a further attempt of the same cluster gets its own record ID and archive folder (`repair/<cluster>/attempt-<n>/`). Widening keeps its per-cluster folder at `widening/<cluster>/` and removes it when it starts.

## Goals / Constraints

**Goals:**

- Give a cluster whose attempt was rejected another attempt, informed by the earlier ones, within a bounded number of attempts and the run budget.
- End every thread that triaged with one outcome and a per-cluster disposition that a reader and a script can take without reading the stage documents.
- Record the measures the thread spent on its clusters.

**Constraints:**

- No fail-soft: an execution failure is never retried away; it stays a failure and keeps its exit status.
- The exit status keeps its meaning (the highest status of the thread's runs and jobs); the outcome is reported beside it.
- A thread checkpointed before this change still resumes.
- `bin/ChummerGenSR4.exe` is only read, by the build script and the capture runner.

## Decisions

### Graph

```
triage ──(diagnosis off)──────────────────────────────────────────────▶ conclude ─▶ END
   └─▶ diagnosis … finish_diagnosis ──(repair off)────────────────────▶ conclude
          └─▶ prepare_repair ─▶ route_repair ⇄ repair … finish_repair ──(widening off)──▶ loop route
                     ▲                                  └─▶ prepare_widening ─▶ … finish_widening ─▶ loop route
                     └──────────────── retry_repair ◀── loop route ──▶ conclude
```

The loop route is a conditional edge after `finish_widening`, or after `finish_repair` when widening is off. It sends the thread to `retry_repair` when at least one cluster is retryable, else to `conclude`. `retry_repair` sets each retryable cluster's repair back to `pending`, appends its latest attempt to the cluster's `earlier` list and moves its rejected widening, if any, from `widenings` to `earlierWidenings`; `route_repair` then fans out the new attempts as before. `prepare_repair` runs once per thread, so a retry never resets a cluster. `prepare_widening` adds a widening only for a passed attempt that has none and keeps the accepted state it finds, so a second round widens on the source accepted in the first. `conclude` runs once, on every path that triaged; with `--only capture` or `--only compare` the graph ends before triage and there is no outcome.

### Retryable

A cluster is retryable when all hold:

- its repair is `rejected` (not `failed`, `budget_exhausted` or `passed`), or it passed and its widening is `rejected`;
- the rejection is not an execution failure: a narrow check with status 2 or invalid coverage, or a level or baseline capture with execution failures;
- the rejection is not at widening stage `apply` or `promote`: the next attempt would start from the same snapshot and meet the same accepted source, so it cannot change either;
- the number of finished attempts (the earlier ones plus the latest) is below `repair.maxAttempts` (profile, default 2; a thread whose stored options lack it has 1);
- the thread's model time is below the run budget. A cluster that meets everything else but finds the budget spent ends `budget_exhausted`.

### Next attempt

The attempt runs exactly like the first: a scratch copy of the thread's snapshot, the guard, the build and the narrow check. Its prompt adds `EARLIER ATTEMPTS (untrusted data)`, a list per earlier attempt of its number, where it was rejected (`repair` with its stage, or `widening` with its stage), the reason and the patch text from the attempt's archive (`patch.diff`, empty when there was none). The repair prompt version becomes `repair-v2`. Starting from the snapshot, not from the source accepted since, keeps every attempt's patch comparable with the snapshot the cluster's context was sealed on; a patch that conflicts with a promotion is rejected at `apply` and not retried.

### Widening per attempt

The widening of attempt `n` of a cluster works in `widening/<cluster>/attempt-<n>/` (widened source, build, `widening.json`, the promotion's index). A rejected widening that `retry_repair` moves to `earlierWidenings` keeps its folder and document. The thread's `widening.json` lists the earlier widenings beside the current ones, and the exit status counts the execution failures of both.

### Dispositions

Each cluster of `triage.json` gets one disposition, decided in this order:

| Disposition | When |
|---|---|
| `fixed` | its widening was promoted |
| `budget_exhausted` | its diagnosis or repair is `budget_exhausted`, or it was retryable but for the spent budget |
| `not_diagnosed` | it has no diagnosis (diagnosis off or `--only triage`) |
| `diagnosis_failed` | a diagnosis job failed with `invalid_output` or `refused` |
| `abstained` | the hypothesis job abstained |
| `refuted`, `undecided` | its check outcome, or `undecided` without a check |
| `not_repaired` | confirmed, with repair off |
| `repair_failed` | its latest repair job failed with `invalid_output` or `refused` |
| `repair_rejected` | its latest attempt was rejected |
| `not_widened` | its latest attempt passed, with widening off |
| `widening_rejected` | its latest widening was rejected |

With the disposition go the number of attempts, the latest stage and reason, and the commit of a fix.

### Outcome

- `verified_for_scope`: every cluster is `fixed` (or there is none), every planned case's capture and compare status is below 2, and triage lists no other findings (rows and captures without pixel analysis).
- `budget_exhausted`: not verified, and at least one cluster is `budget_exhausted`.
- `findings_remaining`: otherwise.

A promoted attempt passed all four widening levels on the accepted source, and every later promotion's levels attribute a returning difference of a fixed cluster as `introduced`, so a fixed cluster's captures pass on the final accepted source without another capture. The scope is the thread's planned cases and captures; findings outside it that the `suite` level met as `pre-existing` are listed by widening and do not change the outcome.

### Document and report

`conclude` writes `outcome.json` in the thread's folder: the thread, the outcome, the scope (cases and captures), the scope's problems (each case whose capture or compare had status 2, and triage's count of other findings), each cluster with its disposition, attempts, stage, reason and commit, the accepted branch and commit, and the measures: clusters, fixed, fix rate (fixed over clusters, null without clusters), attempts, model time (the thread's charged model milliseconds) and elapsed time from the thread's start (null for a thread started before this change). The report prints one line per cluster and an `Outcome:` line after the widening lines. The exit status is not changed by the outcome: a thread that fixed every cluster still exits with 1 when its own captures differed, as that is what its runs observed.

## Risks / Trade-offs

- [A next attempt repeats the earlier one] → The prompt shows the earlier patches and why they were rejected; the attempt limit bounds the cost either way.
- [A retry after a widening rejection costs a full ladder again] → Levels stop at the first failure, the canonical side comes from the cache, and the limit is small by default.
- [`verified_for_scope` without a final capture of the scope] → It follows from the widening rules above; fixture tests cover a returning difference being rejected, and a live run shows a promoted fix's levels.
- [A fix merged elsewhere makes an attempt's patch empty] → It is rejected at `promote`, not retried, and listed as `widening_rejected`.

## What fixture tests prove and what only a live run can

Fixture tests (the real services with fake agents, a fake host with real run folders and PNGs, and a real git repository) prove the retry rules, the earlier attempts in the prompt, the per-attempt widening folders, the second-round widening on the accepted source, every disposition and outcome, `outcome.json`, the report lines, the unchanged exit status, a resume across a retry, and that a thread stored without the new fields resumes. Only live runs prove the outcome over the real suite and that a real repair attempt is routed through widening to `verified_for_scope` on the desktop lane; a next attempt after a real rejection depends on the model and is proven live only if one occurs.
