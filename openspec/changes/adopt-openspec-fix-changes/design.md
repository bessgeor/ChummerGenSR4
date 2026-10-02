# Design

## Context

A thread triages discrepancy clusters, diagnoses each from a sealed context (a hypothesis job, then a challenge job, then one batched check capture), repairs each confirmed cluster with one writable model job per attempt in a history-less scratch copy (patch guard, build, narrow check, archive under `repair/<cluster>/attempt-<n>/`), widens each passed attempt over four levels and promotes it as a commit on `accepted/<thread>`, gives rejected clusters a next attempt, and concludes with `outcome.json` (dispositions, outcome, fix rate, attempts, model time). Every model job is an eval record in the LangGraph store. The OpenSpec CLI 1.13.2 is pinned in `package.json` for the project's own changes; it resolves its root as the nearest folder that holds an `openspec/` folder, supports project-local schemas (`openspec/schemas/<name>/schema.yaml` with templates), validates a change strictly, and archives a change that declares `skip_specs` without spec deltas.

## Goals / Constraints

**Goals:**

- Leave behind every promoted fix as a reviewable OpenSpec change that travels with the fix commit.
- Use archived fixes as leads when a similar discrepancy is diagnosed.
- Split a fix into subtasks with explicit blockers and implement independent ones in parallel.
- Make the two ways of working comparable in pairs, so that the default is chosen by measurement.

**Constraints:**

- Without `--fix-changes` a thread runs exactly as before: the same prompts, records, archives and commits.
- No fail-soft: a fix change the CLI refuses, an archived record that does not parse, or a subtask conflict is a failure, never skipped.
- Fix changes never live in the project's `openspec/changes/`, so the project's strict validation and archive stay about the project.
- `bin/ChummerGenSR4.exe` is only read, by the build script and the capture runner.

## Decisions

### The fixes root and the `fix` schema

The CLI supports custom schemas, so fix changes use one instead of a hand-made layout. `fixes/` is a second OpenSpec root: `fixes/openspec/config.yaml` (default schema `fix`, the project context, artifact rules), `fixes/openspec/schemas/fix/schema.yaml` with templates for `proposal`, `tasks` (requires the proposal) and `verification` (requires the tasks), and the anchored `changes/archive/` and `specs/`. Run from `fixes/`, the CLI finds this root before the repository's. `npm run fixes:validate` runs `openspec validate --all --strict` and `openspec validate --archived` there; both pass on an empty archive.

A fix change is named `fix-<cluster>-<thread suffix>` (the thread ID's last eight characters), so the same cluster fixed by two threads gives two names. Besides the three artifacts it holds `fix.json`, a zod-validated record of the same facts (the cluster and its members with captures, cores and OCR text, the hypothesis with its record, the plan and each subtask with its record and files, the patch's files, the narrow check and each widening level), because retrieval needs fields, not prose. The markdown is rendered from that record, so the two never disagree.

The workflow drives the real CLI (`node <@fission-ai/openspec>/bin/openspec.js` with `OPENSPEC_TELEMETRY=0`) in a staging root under the widening's folder: it copies the repository's `fixes/openspec/config.yaml` and `schemas/`, runs `openspec new change <name> --schema fix`, writes the artifacts and `fix.json`, requires every task to be checked, runs `openspec validate <name> --strict` and `openspec archive <name> -y --skip-specs`, and takes the archived folder. A non-zero exit of any of them is a setup error with the CLI's output. `archive -y` would archive a change with unchecked tasks, so the check of the tasks is the workflow's own.

### When the fix change is written

Only a promoted attempt becomes a fix change. The repair attempt that passes writes the draft (the record without the widening, and `proposal.md` and `tasks.md`) into its archive under `fix/`, because repair holds the sealed context, the hypothesis, the challenge, the check and the plan. Promotion completes the record with the widening's levels, renders `verification.md`, archives the change through the CLI and copies the archived folder into the widened source at `fixes/openspec/changes/archive/<dated name>/`. The fix commit then stages `Chummer/` and that folder with the private index, as before for `Chummer/` alone. The staging root is rebuilt on every try, and a resumed promotion that finds its commit on the branch takes it, so an interrupted promotion is repeated safely.

### Priors in the sealed context

At diagnosis, with the option, every `fixes/openspec/changes/archive/*/fix.json` of the repository's working tree (the tree the snapshot is taken from) is read; one that does not parse is a setup error naming it. Each is scored against the cluster: 8 for the same image hash, 3 per shared capture name, 1 per shared case, and up to 4 for the Jaccard similarity of the members' OCR words (letters and digits, three or more, lower case). Fixes scoring 0 are dropped; the top three by score, then by name, are copied into the context's `priors/<name>/` (the three artifacts and `fix.json`), and the manifest lists each with its score, the reasons and the claim, mechanism and changed files of its fix. They are part of the context hash, so a job's record shows exactly what it saw.

The hypothesis prompt adds a section only when the context has priors, and then carries the prompt version `hypothesis-v1+priors-v1`, so records and certificates tell the two prompts apart. The challenge prompt prints the context without the priors: the challenger is meant to look for a different cause, and showing it the same leads would pull it towards the same answer.

### Planned repair

With the option, an attempt's first job is a plan job: the repair job kind and agent choice, a read-only workspace with the snapshot and the context, prompt version `repair-plan-v1`, the attempt's own record ID `…/repair/<n>`. It answers `planned` with a reason, a summary and 1 to 5 subtasks (`id` 1…n in order, a title, instructions, the files it may change under `Chummer/`, `blockedBy` with lower IDs only, so the graph has no cycle), or `no_plan` with a reason. Two subtasks of which neither blocks the other, directly or through others, must not list the same file; a plan that breaks this, names a file twice or more than ten files in total is `invalid_output`.

Subtasks run in waves: every subtask whose blockers are done starts, each as a writable job (prompt `repair-task-v1`, record `…/repair/<n>/task-<k>`) in its own scratch folder holding the snapshot with its blockers' changes and the context; the model pool bounds how many run at once. A subtask's own change is what differs from the start it was given; it must be exactly the files its answer lists. The join writes the subtasks' changes, in ID order, over a copy of the snapshot; a file whose content in the join is not the content the subtask started from was changed by a subtask that does not block it, and rejects the attempt at stage `patch` with both subtasks named. The joined copy then goes through the existing guard (with the union of the subtasks' files as the declared list), build and narrow check.

A plan or subtask answer `no_plan`/`no_patch`, or a failure, rejects the attempt at stage `model` (`deadline` for a timeout) like the single repair job, and no further wave starts. A usage limit in any job parks the attempt for `wait_for_repair_quota`, after which the whole attempt starts again under a new number. The deadline runs from the plan job's start over all jobs and the build. Every job is charged to the run budget and checked against it when it gets its place in the pool. The attempt's archive adds the plan, each subtask with its record, files and outcome, and the draft; its record gets the repair and widening labels as before, and each subtask record the repair label.

### Thread comparison

`compare-threads` reads each thread's `outcome.json` and, per cluster, the model time of its workflow records in the store (every job whose subject is the cluster in that thread). A cluster present on both sides is one pair: `fixed` is 1 or 0, and the model time is in seconds. It reports the pairs, each side's mean, the mean paired difference, its standard error and 95% t interval, and the verdict (`improved`, `worse`, `no-difference`, `too-few-pairs` below two pairs; for model time, lower is better), and writes the comparison under `out/evals/comparisons/`. Clusters on one side only are listed and not paired. A thread without `outcome.json` is a setup error.

### What fixture tests prove and what only a live run can

Fixture tests prove the ranking, the context and prompts, plan validation, waves, parallel starts, the join and its conflicts, the archive, the fix change rendered, validated and archived by the real CLI, the commit's tree, resume of a promotion, and the comparison's arithmetic. Only live runs show real models writing plans and subtasks, a real fix change on a real accepted branch, retrieval feeding a real hypothesis, and the measures the comparison is made of.

## Risks / Trade-offs

- [Few pairs] Seeded discrepancies cost a live run each, so the comparison will have few pairs and a wide interval. → The verdict says `no-difference` or `too-few-pairs` rather than claiming an improvement, and the option stays off by default unless the interval excludes zero in its favour.
- [Priors that mislead] A ranked prior may resemble the discrepancy without sharing its cause. → The prompt calls priors leads, the answer must still cite the snapshot, and the challenge does not see them.
- [More model jobs] Planning adds a job per attempt. → It is charged to the run budget and measured, which is what the comparison weighs.
- [CLI behaviour] `archive -y` archives unchecked tasks and the schema commands are marked experimental. → The workflow checks the tasks itself and the CLI is pinned; a CLI change shows up as a failing test against the real CLI.
