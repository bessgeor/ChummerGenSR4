# Design

## Context

Diagnosis leaves, for each triage cluster, a sealed context (`context.json` and the crops) beside a history-less snapshot of `Chummer/`, `bin/data/` and `bin/lang/` in the thread's `diagnosis/source/`, a hypothesis, a challenge and the outcome of the batched check: `confirmed`, `refuted` or `undecided`. The build step records the identity of the compiled source the candidate was built from, and diagnosis refuses a snapshot that differs from it, so the snapshot is exactly the source the captured pixels show. Model jobs run through the pooled agent runner, read-only, each in a scratch copy of its context and the snapshot outside the repository; usage limits route to a quota wait, and every job is an eval record in the workflow's store.

The capture runner stages each app from the canonical `bin/` (data, translations, settings, sheets) plus the executable folder it is given, and accepts `--candidate-exe` for the candidate; the workflow has so far always used the default, `out/candidate/bin/`. Data and translation files therefore never reach a staged candidate from the source tree: only the compiled source changes what the candidate shows. `bin/ChummerGenSR4.exe` stays immutable canonical input; repair only reads it through the capture runner and the build script, which both verify its hash.

## Goals / Constraints

**Goals:**

- One repair attempt per confirmed cluster, run by a model in a workspace it owns and that has no version history, and judged by deterministic steps only: a patch guard, a build and a narrow capture.
- Attempts in parallel: model jobs in the model pool, builds in the CPU pool, checks one at a time on the desktop lane.
- A deadline per attempt, typed results, and an archive of every attempt, rejected ones included, with the reason.
- An eval record per repair job, with the attempt's outcome as an automatic label.

**Constraints:**

- A patch is never applied to the repository; it is archived.
- A cluster gets one attempt, and only a cluster that is `confirmed` gets it.
- Repair is refused under `--unattended`, since no certificate covers repair jobs.

## Decisions

### Graph

After `finish_diagnosis`, when repair is on (`--no-repair` turns it off, `--only` of any node skips it), `prepare_repair` creates a pending repair for each cluster whose check outcome is `confirmed`. `route_repair` sends a `repair` task per pending cluster (`Send`), routes to `wait_for_repair_quota` when an attempt hit a usage limit, and otherwise to `finish_repair`, which writes the thread's `repair.json`. Each attempt is one task, so a resumed thread repeats only the attempts that had not finished; an attempt that a kill interrupted starts again from the model job, under the next record ID, and its earlier record stays in the store and in the cluster's list.

```
repairs[clusterId] = { clusterId, status: "pending" | "passed" | "rejected" | "failed" | "budget_exhausted",
                       attempt: AttemptSummary | null, waiting: QuotaWaitMark | null, records: string[] }
```

`failed` is an attempt whose model job failed with `invalid_output` or `refused`: like a failed diagnosis job it makes the run's status 2, and it is archived as rejected at stage `model`. A pending cluster whose job cannot start because the run budget is spent is `budget_exhausted`.

### Workspace

When the job gets its place in the model pool, the attempt creates a scratch folder outside the repository (the temporary folder) with `source/` (a copy of the thread's snapshot, writable) and `<cluster>/` (a copy of the sealed context). The context's hash is checked first; a changed context is a setup error. The model's working folder is `source/`; the context copy is added read-only. Neither copy holds a `.git` folder and the scratch folder lies outside the repository, so no git command in the workspace finds the repository's history. When the model job returns, whichever provider ran it, the context copy is compared with the sealed context it was copied from (the same files with the same content) and the scratch folder must hold only the two copies; a job that changed or added anything else fails as `infra` before any build or archive, and its record keeps that status. The scratch folder is removed when the attempt ends (a folder that cannot be removed is named in the log); a killed process leaves it behind.

### Writable jobs and the adapters

The agent job's workspace gets `writable: boolean`; only repair jobs set it.

- Claude: a writable job gets the tools Read, Grep, Glob, Edit and Write, still without a command tool and without allowance rules, and the permission mode `acceptEdits` instead of `dontAsk`, so edits in the working folder are accepted without a prompt. The evidence images must still be opened with a successful Read.
- Codex: a writable job runs with `sandboxMode: "workspace-write"`, approvals `never`, no network and no web search. A `file_change` item is allowed only when every path it names lies inside the working folder; any other path, an MCP call or a web search stops the job with `infra`.

Both adapters report a job that runs past its time limit as the new failure kind `timeout` (it was `infra`). Diagnosis, the grader and eval runs treat `timeout` exactly as before (a setup error, status 3, resumable); repair treats it as the attempt's deadline.

### The repair job

Job kind `repair`, prompt version `repair-v1`, in the profile as `agents.jobs.repair` (Claude, effort high, 30 minutes by default). The prompt is built from the sealed manifest, the confirmed hypothesis, the challenge's answer and the check observations, all marked as untrusted data, and names the two folders. It asks for the smallest change of the app's C# source under `Chummer/` that removes the discrepancy without changing anything else, and forbids touching any other folder. The answer is

```
{ outcome: "patched" | "no_patch", reason, summary, files: [path relative to source/] }
```

Validation (`invalid_output` when it fails): non-empty reason and summary, `files` empty exactly when the outcome is `no_patch`, each path relative with `/` separators, without `..`, and listed once. A `no_patch` answer rejects the attempt at stage `model`.

### Patch and guard

The patch is computed by comparing every file of `source/` with the thread's snapshot by content: added, modified and deleted files. For each file the text diff comes from `git diff --no-index` run in a scratch folder with the options the benchmark pins (`--no-color --no-ext-diff --no-textconv --no-renames --diff-algorithm=myers --indent-heuristic -U3`, `core.autocrlf=false`), with its paths rewritten to `a/<path>` and `b/<path>`, so it parses like a benchmark patch. The attempt passes the guard only when:

- the patch is not empty, and the files equal the answer's `files` as a set;
- every file lies under `Chummer/`, none is deleted, and no file holds a NUL byte on either side;
- at most 10 files and 300 changed lines (added plus removed).

Each violated rule is listed; any violation rejects the attempt at stage `patch` before a build.

### Build

`parity/scripts/build-candidate.mjs` gains `--source <folder>` (the folder that holds `Chummer/`, default the repository), `--output <folder>` (default `out/candidate/`; the executable goes to `<output>/bin/`, intermediate files to `<output>/obj/`) and `--log <file>` (an MSBuild file log). Its exit status becomes 0 for a build, 1 for a failed build, and 3 when the canonical hash is wrong, MSBuild cannot be found or is stopped by a signal, or anything unexpected fails (an unreadable canonical executable, say), so that only a build MSBuild itself rejected counts as a failed build. Repair runs it through the host runner on the CPU pool with the attempt's `source/` and an output folder in its scratch folder. Exit 1 rejects the attempt at stage `build`; 3, or any other status, is a setup error.

### Narrow check

One capture runner call on the desktop lane, made by the same function as the capture step's, with `--candidate-exe <attempt>/bin/ChummerGenSR4.exe`, `--case` the cluster's cases, `--capture` the cluster's captures, and the thread's case file, settings overlay, threshold and canonical cache (the canonical side is unchanged, so the cache applies). The attempt passes when the run exits with 0 and its coverage is valid. Exit 1 rejects it at stage `check` and lists each failing case and capture with its difference; any capture of the selection that still differs rejects the attempt, also one that shows another cluster's discrepancy. Exit 2 or invalid coverage rejects it at stage `check` as an execution failure, which is reported apart and makes the run's status 2. Exit 3 is a setup error. The check is never a recorded capture step and is never reused.

### Deadline

The profile's `repair.deadlineMinutes` (default 60) starts when the model job gets its place in the pool. The job's time limit is the smaller of its job kind's limit and the deadline; a `timeout` result rejects the attempt at stage `deadline`. The build runs with a signal that aborts at the deadline; a build stopped by it rejects the attempt at stage `deadline`, while a stop of the run is still a setup error. Waiting for the CPU pool counts against the deadline. The narrow check is not cut off: a check stopped half-way shows nothing, and the capture runner bounds its own waits. Quota waits restart the attempt and its deadline.

### Archive

Every attempt whose model job finished (not a usage limit, not `infra`) is archived in `repair/<cluster>/attempt-<n>/` in the thread's folder, where `n` is the attempt number of its record:

- `attempt.json`: attempt and record IDs, context hash, snapshot identity, the hypothesis record, the model's answer or failure, the patch summary (files with their change, hashes and line counts), the guard's violations, the build (status, duration), the check (run folder, status, coverage validity, invalid reasons, failures, each selected case and capture with its result), the outcome (`passed` or `rejected`), the rejection stage (`model`, `deadline`, `patch`, `build` or `check`) and reason, and the times;
- `patch.diff`, `files/before/<path>` and `files/after/<path>` for every changed file, and `build.log` when the build ran.

The folder is written under a temporary name and renamed when complete; an existing folder of the same name is a setup error. A passed attempt keeps its archive too, with the files its patch produced. `repair.json` lists each cluster's status, attempt summary and records, and totals.

### Records and labels

A repair job is recorded like a diagnosis job (origin `workflow`, subject the cluster, the context hash, prompt version, agent, usage, result and answer) under `<thread>/<cluster>/repair/<n>`; the first free `n` is taken from the store, so a resumed attempt never replaces an earlier record. Once the attempt is archived, the record gets the new label `repair: { outcome, stage, reason, labelledUtc }`; it is automatic, never gold, and the review queue, grader and datasets still use hypothesis and challenge records only. The label is empty until an attempt is archived, and a stored record without the key reads as empty: the label is additive, automatic and never gold, so records already in the store need no migration and a missing key loses nothing that a grade or a verdict depends on.

### Options, report and exit status

`--no-repair` turns repair off; `RunOptions.repair` is `{ deadlineMinutes }` or null; a thread whose stored options lack it fails its first repair with a setup error. The profile gains `repair.deadlineMinutes`. `--unattended` counts `repair` as a dispatched job kind unless repair is off or `--only` is given, and since no certificate can cover it, such a run ends with status 3 saying to add `--no-repair`. The end-of-run report prints, per repaired cluster, the outcome, stage, reason and archive folder, and the narrow check's execution outcome on a line apart from its visual result. The run's status is 2 when a repair attempt `failed` or a narrow check had execution failures; a rejected attempt alone does not change the status, since the discrepancy it did not remove is already counted by the compare.

## Risks / Trade-offs

- [A patch passes the narrow check but breaks other captures] → The narrow check covers only the cluster's cases and captures, and `attempt.json` lists every capture it checked; nothing is applied to the repository.
- [Another discrepancy in the same capture rejects a correct patch] → The rule is strict on purpose: a capture that still differs is not shown to be fixed. The archive lists every failing capture with its difference.
- [Codex workspace-write may write outside the working folder through commands] → Its sandbox limits writes to the workspace and temporary folders; the patch is taken from `source/` only, file changes outside it stop the job, and the default repair provider is Claude, which has no command tool.
- [The model edits evidence in its context copy] → Claude's accept-edits mode accepts edits in added folders, so the check after the job compares the copy with the sealed context and fails the job as `infra` on any difference.
- [Killed attempts leave scratch folders] → They lie in the temporary folder, outside the repository, as with diagnosis jobs.

## What fixture tests prove and what only a live run can

Fixture tests (fake agents, a fake host runner, real scratch folders and git) prove the workspace layout and isolation, patch computation and every guard rule, the build and check calls and the interpretation of their statuses, the deadline for the model job and the build, the archive and its atomic write, the records and the label, the graph's routing, fan-out, quota waits, budget, resume and the exit status, the options and the unattended gate, and the adapters' arguments for writable jobs and `timeout`. Only a live run proves that a real model edits the source copy under the real CLI's permissions, that the patched copy builds with MSBuild outside the repository, that the capture runner captures the attempt's executable against the canonical one on the desktop lane, and that a killed repair resumes on the real host.
