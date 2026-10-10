# Design

## Context

Evaluation already has frozen datasets with a `test` and a `development` partition (each discrepancy or target lies in one), eval runs that record their agent choice and prompt version, a paired comparison with a 95% t interval, and certificates whose 95% Wilson lower bound gates unattended dispatch. Prompts are code: each job kind has a prompt builder and a version constant, and a record carries the version it was prompted with. Diagnosis jobs run in `npm start` threads, rank and scenario jobs in `npm run discover` threads; both store their options in the thread so a resumed thread runs as it started.

## Goals / Non-Goals

**Goals:**

- Change how the four evaluated job kinds are prompted without editing code, within a narrow, declared surface.
- Choose candidates on the development partition and confirm them once on the test partition, so the confirmation is not measured on the items the candidate was chosen on.
- Activate a candidate only with a certificate and a paired comparison against what is active, and be able to go back.
- Keep every measurement and every decision as a file that names its runs.

**Non-Goals:**

- No tuning of the agent choice (provider, model, effort), the answer schemas, the validation, the tools, the budgets or any threshold or gate; the profile and the code keep deciding those.
- No tuning of grade or repair jobs: evaluation does not score them.
- No automatic trigger: a person or a script starts a cycle.

## Decisions

### What a tuning configuration may change

A configuration is `{ schemaVersion, jobKind, basePromptVersion, guidance, context }`:

- `guidance`: 0 to 6 lines, each 1 to 400 characters, without control characters and without `PROMPT_VERSION`. A non-empty list adds a section `TUNED GUIDANCE (from evaluation, subordinate to the rules above):` after the job kind's instructions and before the context; the line `PROMPT_VERSION=…` stays first.
- `context`: `inline` (the context printed as today) or `file` (the prompt says that the sealed context is `context.json` in the working folder, to be read before answering, and prints none of it). A challenge prompt still prints the hypothesis it challenges.
- `basePromptVersion`: the code's prompt version of the job kind when the configuration was made. A configuration whose base is not the code's current version is stale, and using it is a setup error: a prompt edit in the code invalidates every configuration built on the old prompt.

Its ID is `tuned-` and the first 12 hex digits of the SHA-256 of its canonical JSON; its jobs record the prompt version `<version>+tuned-<id>`, where `<version>` is what the job records without tuning (a hypothesis with priors keeps `+priors-v1`). Two equal configurations are the same candidate.

The surface is text the model reads and how much of the context it is handed; the validation that rejects an answer and the scoring that judges it do not change, so a configuration cannot make an answer pass that would fail without it.

### Where the state lives

- **Tuning folder** (the profile's `tuning`, else `workflow/evals/tuning/`, committed like the certificates): `active/<jobKind>.json` and `holdout.json`. The active file holds the active entry, the entries it replaced (most recent last) and the entries rolled back. An entry is the configuration or none (the code's prompt), when and on what evidence it was activated, and the certificate issued with it, or for the code's prompt the certificate file as it was when it was first replaced.
- **Candidates** in `out/evals/tuning/candidates/<id>.json`: the configuration, where it came from (`added` or `proposed` with the `tune` record and the development run it was proposed from) and its rationale.
- **Cycles** in `out/evals/tuning/cycles/<cycleId>/cycle.json`.

### Eval runs of a configuration

`eval run` gains `--tuning active|none|<id>` (default `active`). The run's settings store the configuration (null for the code's prompt) and the tuned prompt version; a run stored before this has none. `--resume` uses the stored configuration and refuses one whose base is no longer the code's version. A candidate's run on `test` or `all` is refused unless `tune holdout` starts it.

### The `tune` job

A new job kind `tune` (profile `agents.jobs.tune`, default Claude, medium effort) runs read-only in a scratch folder holding `tuning-context.json`:

- the job kind, the metric the cycle optimizes, the configuration the run measured, and the full prompt of the run's first item as a job saw it;
- every sample of the development run: item, repetition, status and message, model time, scores, answer, and the item's gold;
- the earlier candidates of the job kind on the dataset with their development difference, when measured.

The development run must be complete and on the `development` partition, so nothing of the test partition reaches the job. The prompt names the file and does not print it, since the context holds every answer and a full prompt. The answer is `{ outcome: "candidate" | "abstain", reason, guidance, context }`; a candidate that equals the configuration it was proposed from is `invalid_output`. The job's record is stored with origin `workflow` and kept out of the review queue, the grader and the datasets.

### The holdout gate

`tune holdout --candidate <id> --baseline <run> --run <run>` names two complete development runs on the same dataset, items and agent choice: the baseline of the job kind's active configuration and the candidate's. It compares them on the metric (`--metric`, default the job kind's first). The candidate passes the development gate when the mean paired difference is above 0, or exactly 0 with a lower mean model time, and it has a value of the metric on every item the baseline has one on: the comparison pairs only items with a value on both sides, so a candidate that abstains where the baseline answered would otherwise drop those items and still be credited with the time it saves. It then checks the ledger: a candidate gets one exposure per test item, and a test item at most `--max-exposures` (default 3, at most 3) candidates. An exposure counts against every dataset of the job kind whose test partition holds one of its items, found by what decides an item's partition (a discrepancy cluster, a discovery target) and not by the dataset's name, version or hash: a new version, or another seed that only moves the same items between partitions, would otherwise reopen items a candidate has seen. The ledger is read, checked and written with nothing awaited in between, so two commands do not both pass the limit. Only then does it append the exposure (test items, dataset hash, candidate, development runs and comparison, the new test run ID, time) to `holdout.json`, and start the candidate's test run with the development runs' repetitions. A run killed after that keeps its exposure and resumes with `eval run --resume`; a run stopped before its folder was written starts under its recorded ID when `tune holdout` is asked again for the candidate.

`eval certify` certifies only a run of the active configuration (the code's prompt when none is active), so the certificate file always belongs to the active entry and activation can keep it with the entry it replaces.

Alternative considered: count every test run, the active configuration's too. Rejected: a baseline run informs no choice between candidates, and the comparison at activation needs one on the same items.

### Activation and rollback

`tune activate --run <candidate test run> --baseline <active test run> --metric <m> --min-pass <rate> [--max-mean-cost-usd <usd>]` refuses (exit 1, every reason, nothing written) unless: the candidate run is the one its exposure recorded and is complete; the baseline run ran the job kind's active configuration on the same dataset, partition, samples and agent choice and is complete; the paired comparison is not `worse` and holds a candidate value for every item the baseline has one on; and the candidate run meets the certificate rule. It then writes the active file, in which the old active entry moves to the history with the certificate file as it was, and then the job kind's certificate for the tuned prompt version. Stopped between the two, the configuration is dispatched without its certificate, so an unattended run is refused; asked again for the same run, `tune activate` writes the certificate and succeeds.

`tune rollback --job <kind> [--reason <text>]` writes the latest history entry's certificate back, or removes the certificate file when that entry had none, and then moves the active entry to the rolled-back list with the time, the reason and the certificate file as it was, and makes the history entry active. Stopped between the two, the certificate no longer matches what is dispatched (an unattended run is refused), and the rollback asked again ends in the same state, the rolled-back entry keeping the certificate it was activated with. Rollback to a stale configuration says so: it cannot be dispatched until it is rolled back further. Without history it is a setup error. Rollback needs no evaluation: it returns to a state that was certified, or was the code's own.

### Dispatch

`npm start` and `npm run discover` read the active files of the job kinds they dispatch (hypothesis and challenge when the thread runs diagnosis, that is not with `--no-diagnosis` or `--only` of an earlier node; rank and scenario) when a thread starts and store the configurations in the thread's options; a resumed thread keeps them, and a thread stored before this has none. A stale active configuration is a setup error at the start. Diagnosis and discovery jobs pass their configuration to the prompt builder and record the tuned version. The unattended gate compares each certificate with the dispatched prompt version.

### The cycle

`tune cycle --dataset <folder> --metric <m> --min-pass <rate> [--candidates 1-3] [--repeat <n>] [--max-mean-cost-usd <usd>]` runs, recording each step's run IDs in `cycle.json` before and after it:

1. a development run of the active configuration;
2. up to `--candidates` times: a `tune` job on the baseline run (it sees the candidates before it), a development run of its candidate, and the comparison; an abstention ends the proposals;
3. the candidate that passes the development gate with the highest mean difference (then the lower model time) goes to `tune holdout`; with none the cycle ends `no_improvement`;
4. a test run of the active configuration and the candidate's test run;
5. `tune activate`: the cycle ends `activated`, or `rejected` with the reasons.

A failed `tune` job ends the cycle `failed`. A resumed cycle whose holdout run is in the active file's entries (active, replaced or rolled back) was activated already and ends `activated` without activating again. Every run after the development baseline uses the baseline's agent choice, pool and executables, so a resumed cycle measures with what it started with. A cycle killed after its activation was written finds it by its holdout run.

`tune cycle --resume <cycleId>` continues with the stored options: a run with a recorded ID resumes, a step with a result is not repeated. Exit status: 0 for `activated` and `no_improvement`, 1 for `rejected` (or a refused `tune holdout`), 2 for `failed`, 3 for setup errors.

## What fixture tests prove and what only a live run can

Fixture tests prove the configuration schema and its hash, the prompt sections and versions for every job kind, the context staging, the holdout gate and ledger, activation, rollback and certificate handling, the options of new and old threads, and the cycle's order and resume with a fake agent runner. Only live runs show that a model proposes a usable candidate, the measured deltas and intervals, and that a real thread dispatches with the active configuration.

## Risks / Trade-offs

- **[Small partitions give wide intervals]** → activation requires "not worse" and the certificate's Wilson bound, not a significant improvement; the development gate needs a strictly positive mean or a time saving; the ledger caps how often the test partition informs a choice.
- **[Guidance could contradict the code's rules]** → its section says it is subordinate, the validation and scoring are unchanged, and a configuration is activated only on measured results.
- **[The active file is in the working tree]** → activation and rollback write it like the certificates; a person reviews and commits it with the certificate.
- **[A prompt edit leaves configurations stale]** → stale configurations are setup errors, never silently dropped; rollback returns to the code's prompt.
- The canonical executable is never built, copied or edited; the live `npm start` run records its SHA-256 before and after.
