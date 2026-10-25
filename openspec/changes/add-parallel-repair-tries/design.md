# Design

## Context

A cluster's diagnosis holds one hypothesis and one challenge; the check judges it and labels both records. A cluster's repair holds its latest attempt and the earlier ones; one attempt is one repair job (or one plan with its subtasks) in its own worktree, judged by the guard, the build and the narrow check, and archived in `repair/<cluster>/attempt-<n>/`. Widening reads the attempt's archive for its commit and summary.

## Goals / Non-Goals

**Goals:**

- Explore more than one explanation and more than one patch per cluster within one attempt.
- Keep one decision per attempt: one selected try, widened like a single attempt today.
- Change nothing with the defaults.

**Non-Goals:**

- No model judges which patch is best: selection is deterministic.
- No widening of several tries: widening is the expensive, desktop-bound stage.

## Decisions

### Hypotheses

`ClusterDiagnosis` gains `variants`: the hypotheses after the first, each with its answer, challenge and status, numbered from 2; the existing `hypothesis` and `challenge` fields stay variant 1, so a thread stored before this change reads as one variant. Hypothesis jobs of all variants fan out together; a variant's record ID is the next free one of the cluster's hypothesis records. The check plans the union of every variant's predictions and judges each variant with `judge`; `ClusterCheck` gains `variants` with each variant's outcome, and the cluster's outcome is `confirmed` when any variant is, else `refuted` when every variant that predicted is refuted, else `undecided`. Each hypothesis and challenge record is labelled with its own variant's outcome.

### Tries

The repair node of an attempt starts its tries with `Promise.allSettled`, each through the existing single or planned attempt code with its own record ID (`<attempt record>/try-<k>`), worktree and branch, its confirmed variant's hypothesis and challenge in its brief, and the attempt's deadline. Builds use the CPU pool and checks the desktop lanes as before. A usage limit in any try parks the attempt like a single attempt; the jobs that finished are charged. The budget is asked before each try's job, so a spent budget stops the tries that did not start.

Selection among passed tries: fewest added plus removed lines, then fewest files, then lowest try number. `attempt.json` gets `tries` (each with its record, branch, commit, outcome, stage, reason and `selected`) and keeps the selected try's patch, commit, build and check at its top level; its archive copies each try's files into `try-<k>/`. A rejected attempt's reason lists each try's stage and reason, and the next attempt's prompt lists every try's patch as an earlier attempt's.

### Widening

Widening reads the top-level commit of `attempt.json`, which is the selected try's, so its code is unchanged; the widening document names the try.

## Risks / Trade-offs

- Tries multiply model time and narrow checks; the run budget and the deadline still bound them, and the defaults keep one try.
- Fewest changed lines is a proxy for the smallest safe change; widening still has to prove it.

## Fixture and live evidence

Workflow tests with fake agents, builds and checks prove the fan-out, labels, selection and archive. Only a live run proves that tries run side by side on real worktrees and lanes; it records the canonical hash before and after.
