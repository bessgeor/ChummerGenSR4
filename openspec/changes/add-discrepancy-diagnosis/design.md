# Design

## Context

The workflow graph (`workflow/`) runs build → capture ∥ compare → triage and checkpoints every step in SQLite. Triage writes `triage.json` with clusters of discrepancies that carry stable identities, kept in a LangGraph store. Host processes run through the host runner: capture holds the machine-wide desktop lane, builds and compares run in the CPU pool. This change continues the graph after triage with model agents that explain each cluster and with a capture run that tests their explanations.

`bin/ChummerGenSR4.exe` stays immutable canonical input: diagnosis only reads, and the check capture goes through the capture runner, which verifies the canonical hash before and after.

## Goals / Non-Goals

**Goals:**

- One port for model jobs with typed failures, and two adapters that run under the user's subscriptions (never API-key billing).
- A context per cluster that is complete, immutable, hashed and the only thing a prompt is built from.
- A hypothesis per cluster, an independent challenger, and one batched capture run that decides between them where they disagree.
- A usage limit is a wait, not a failure, and survives restarts.
- A record of every job in one schema.

**Non-Goals:**

- Changing the app's source. Diagnosis jobs are read-only.
- Grading hypotheses beyond the check outcome; the records only hold labels.
- New UI actions for checks. A check names existing cases and captures.

## Decisions

### Graph shape

```
triage → prepare_diagnosis → route_diagnosis ─┬─ Send(hypothesize, cluster) ─┐
                                ▲             ├─ Send(challenge, cluster) ───┤
                                │             ├─ wait_for_quota ─────────────┤
                                └─────────────┴──────────────────────────────┘
                                              └─ check → END
```

`prepare_diagnosis` builds the thread's source snapshot and one sealed context per cluster. `route_diagnosis` is a node without work whose conditional edge decides the next step from the state: `wait_for_quota` when any job is waiting for quota; else a `Send` to `hypothesize` for every cluster that has no hypothesis result; else a `Send` to `challenge` for every cluster with a hypothesis and no challenge result; else `check` when a prediction is open; else the end. `hypothesize`, `challenge` and `wait_for_quota` lead back to `route_diagnosis` with plain edges, so the router runs once after all fanned-out jobs of a step finished and sees all their writes.

One model job is one node task. LangGraph saves each finished task's writes, so a killed run that resumes runs only the jobs that had not finished; a hypothesis is never asked again because its challenger was interrupted.

Alternative considered: one `diagnose` task per cluster that runs both jobs. It loses the hypothesis when the challenger is interrupted and couples the two jobs' quota waits.

### Agent runner port and failures

`AgentRunner.run(job)` takes the job kind, the subject (a cluster), the prompt, image paths, a zod schema, the workspace (job folder plus read-only folders) and a timeout. It returns `{ ok: true, output, usage, durationMs, session }` or `{ ok: false, failure: { kind, message }, … }` with `kind` one of `invalid_output`, `refused`, `quota_exhausted`, `infra`. The adapters never throw for a job that ran; they throw only for programming errors. The graph decides what a failure means:

- `quota_exhausted`: the cluster waits (see below); no budget is charged.
- `invalid_output` and `refused`: the cluster's diagnosis fails with that kind; the run continues with other clusters and ends with status 2.
- `infra` (CLI missing, not signed in, API-key billing, crash, timeout): a setup error, status 3; the thread stays resumable.

Output validation is two steps: the adapter parses the final JSON with the job's zod schema (`invalid_output` when it fails), then the job's semantic validation checks it against the context (also `invalid_output`, with the validation errors as the message).

### Claude adapter

Runs the Claude Code CLI with `-p --output-format stream-json --verbose --json-schema <schema> --model <m> --effort <e> --permission-mode dontAsk --tools Read,Grep,Glob --allowedTools Read Grep Glob --add-dir <read-only folders> --strict-mcp-config --no-session-persistence --setting-sources ""`, the prompt on stdin and the job folder as working directory. The child's environment drops `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`, and disables auto memory. The `system/init` event must report `apiKeySource: "none"` (subscription sign-in); any other value aborts the job as `infra` before the model answers. The `result` event gives `structured_output`, usage and cost; `is_error` results are classified by their text. Tool calls other than the three read tools are not possible (`--tools` removes them).

Images: the crops lie in the job folder; the prompt names them and the Read tool shows them to the model.

### Codex adapter

Uses `@openai/codex-sdk` (pinned; it ships the Codex CLI) with `startThread({ workingDirectory, model, modelReasoningEffort, sandboxMode: "read-only", approvalPolicy: "never", webSearchMode: "disabled", networkAccessEnabled: false, skipGitRepoCheck: true })` and `runStreamed(input, { outputSchema, signal })`. The input holds the prompt and the crops as `local_image` items. The CLI gets an explicit environment without `OPENAI_API_KEY` and `CODEX_API_KEY`, and the config `project_doc_max_bytes = 0` so that repository instruction files do not enter the context. Before a job the adapter reads `auth.json` in `CODEX_HOME` (default `~/.codex`) and requires `auth_mode: "chatgpt"`; anything else is `infra`. Codex reads files by running commands (for example `Get-Content`), so command executions are allowed; the read-only sandbox keeps them from writing and from the network. File changes, MCP tool calls (the user's Codex configuration may declare servers) and web searches in the event stream abort the job as `infra`.

Both adapters convert zod schemas with `z.toJSONSchema`. The output schemas avoid optional properties (nullable instead) and keep `additionalProperties: false`, which both structured-output implementations accept.

### Quota classification and wait

Both adapters classify a failure as `quota_exhausted` when its text matches a usage-limit pattern (`usage limit`, `limit reached`, `rate limit`, `quota`, HTTP 429 and similar), as `infra` when it matches sign-in problems, `refused` for refusals, else `infra`.

On `quota_exhausted` the job node writes `{ waiting: { kind, provider, since, processId } }` for its cluster and charges nothing. `wait_for_quota` sleeps for the next delay of 1, 2, 5, 10, 15 minutes, then 15 minutes for every later wait, and clears the waiting marks; the router then sends the jobs again. The attempt count lives in the process; a wait whose marks carry another process's ID (the run was restarted) sleeps zero and the next attempt is immediate. A job that succeeds resets the count. The sleep stops when the run is stopped (Ctrl+C), and the thread resumes at `wait_for_quota`. No `interrupt()` is used: a quota wait never asks the operator.

### Budgets

Job budget: the profile's per-job-kind timeout; the adapter stops the job at the deadline (`infra`, setup error). Run budget: the profile's `runBudgetMinutes` for model time in a thread. The state sums the duration of finished jobs only; quota waits and the time in `wait_for_quota` are not jobs, so they are never charged. When the budget is spent, clusters that still need a job are marked `budget_exhausted` and reported apart from failures; the exit status is unchanged by them.

### Sealed context

`prepare_diagnosis` writes `out/workflow/threads/<thread>/diagnosis/`:

- `source/`: a copy of the files `git ls-files --cached --others --exclude-standard` lists under `Chummer/`, `bin/data/` and `bin/lang/`: the source the candidate was built from, without history. Its identity is the SHA-256 over the sorted list of paths and file hashes, plus `HEAD`'s commit.
- `<cluster>/context.json`: the manifest: cluster ID, image hash, up to five members (case, capture, core, crop, differing pixels, OCR text of both sides, file names of the copied crops), for each member case its mode, fixture file name and hash, and the expanded actions up to the capture; the check vocabulary (every case of the thread's case file with its capture names); the source identity. Its SHA-256 over canonical JSON is the context hash.
- `<cluster>/evidence/`: copies of the crops.

The context is built from recorded files only; building it again gives the same hash. The prompt is the versioned instructions plus the manifest; OCR and other text from the run are marked as untrusted data. Jobs see the job folder and the source snapshot, nothing else of the repository: Claude through `--add-dir`, Codex through its read-only sandbox and the disabled project instruction files.

### Jobs and validation

Hypothesis output: `outcome` (`hypothesis` or `abstain`), `reason`, and when a hypothesis: the causal `claim`, a `mechanism` class (`layout`, `text`, `data`, `rendering`, `resources`, `timing`, `other`), source `locations` (snapshot path, symbol or null, line or null), `evidence`, `confidence` and one to four `predictions` (case, capture, `differs` or `matches`, why). Challenge output: `outcome` (`alternative` or `no_alternative`), `reason`, and an alternative of the same shape.

Semantic validation: every location path exists in the snapshot and its line is inside the file; every prediction names a case and capture of the vocabulary, once; an alternative's claim differs from the hypothesis's and at least one of its predictions names a capture the hypothesis also predicts with the other expectation. A failed validation is `invalid_output` with the errors listed.

Prompt versions (`hypothesis-v1`, `challenge-v1`) are recorded with every job.

### Batched check

When every cluster's diagnosis is done, `check` collects the predictions of each cluster with a hypothesis (the hypothesis's and, if any, the alternative's). If there are none, the node ends the run without capturing. Otherwise it calls the capture runner once on the desktop lane with `--case` set to the union of the named cases and `--capture` to the union of the named captures, with the thread's case file, overlay, threshold and canonical cache. A capture filter that names a capture another case lacks is fine; each case writes the subset it has.

Observation per named (case, capture), from `results.json`: `matches` when the row passed, `differs` when it failed with a visual difference or a size mismatch, `not-observed` when it is missing or lost (the coverage document says why). Per cluster: `refuted` when an observed hypothesis prediction is wrong; `confirmed` when every hypothesis prediction is observed and right and the alternative (if any) has an observed wrong prediction; else `undecided`. A capture runner status of 3 is a setup error; status 2 (execution failures) is reported as the check's execution outcome apart from the observations, and makes the run's status 2.

The check runs fresh captures; it does not reuse recorded capture steps, because a repeat of the same capture is itself an observation (for example of a paint race).

### Eval records

Schema `EvalRecord` (zod, workflow only; no other language reads it): `schemaVersion`, `recordId`, `jobKind`, `threadId`, `subject` (`{ kind: "discrepancy-cluster", id }`), `contextHash`, `promptVersion`, `agent` (provider, model, effort), `startedUtc`, `finishedUtc`, `durationMs`, `usage` (input, cached input, output tokens, cost in USD when the provider reports it) or null, `result` (`succeeded` or a failure kind, with message), `output` or null, `labels` (`check`: `confirmed`, `refuted`, `undecided` or null). Stored under the namespace `["eval-record", <jobKind>]` with the record ID as key, written when the job ends; the check node adds the label. A quota failure is recorded too.

### Profile

The local profile gains an optional `agents` object: `jobs.<kind>` with `provider` (`claude`/`codex`), `model` (string or null for the CLI's default), `effort` and `timeoutMinutes`; `modelPool` (default 2); `runBudgetMinutes` (default 120); `executables.claude` (default `claude` on `PATH`) and `executables.codex` (default: the CLI the SDK ships). Defaults: `hypothesis` on Claude, `challenge` on Codex, so the challenger runs on another provider unless the profile says otherwise.

## Risks / Trade-offs

- [The models' answers are not deterministic] → Every answer is validated and recorded; the check decides only from captures.
- [A check vocabulary of existing captures cannot test every theory] → The challenger must disagree on a capture of the vocabulary or say there is no alternative; `undecided` is a reported outcome, not a failure.
- [Usage-limit messages change wording] → The patterns are unit-tested; an unknown limit message is `infra`, which stops the run with status 3 and a resumable thread instead of being mistaken for success.
- [The snapshot could miss files the app is built from] → It covers the source and the data folders; generated files outside them are not part of the candidate's source.
- [Capture runner filter semantics] → One call with union filters runs every action of each named case, so the check costs one app start per named case and side.

## Fixture tests and live evidence

Unit tests prove the adapters' arguments, environment, event parsing, failure classification and API-key guards (with fake executables and a fake SDK client), sealing and its hash, validation, the routing and fan-out, the quota schedule and the restart rule (fake clock), budgets, the check's observation rules and batching (fake host and run folders), and the records. Only a live run proves that the real CLIs accept the arguments and schemas under the subscriptions, that the jobs read the snapshot and crops, that the check capture runs on the desktop lane, and that a killed run resumes without repeating finished jobs. A quota wait can only be observed live when a limit is actually reached.
