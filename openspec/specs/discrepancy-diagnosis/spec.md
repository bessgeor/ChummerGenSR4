# discrepancy-diagnosis Specification

## Purpose
Defines how the workflow explains triage clusters with read-only model agents under the user's subscriptions: the agent runner and its Claude and Codex adapters, the per-job-kind profile, sealed contexts, a hypothesis with an independent challenger, the quota wait, the run budget, the batched diagnostic check and the eval record of every job.

## Requirements

### Requirement: Model jobs run through one agent runner with typed failures
Every model job SHALL run through one agent runner that takes the job kind, its subject, a prompt, images, an output schema, a read-only workspace and a time limit, and returns either the output validated against the schema with its usage and duration, or a failure of kind `invalid_output`, `refused`, `quota_exhausted` or `infra`. Output that is not valid JSON, does not match the schema or fails the job's semantic validation SHALL be `invalid_output` and SHALL NOT be used. A job that exceeds its time limit, a CLI that cannot start or crashes, and a missing sign-in SHALL be `infra`. A failure SHALL be `quota_exhausted` only when the provider reports HTTP status 429 or one of the subscription's own usage-limit messages; a failure that merely mentions a limit, a quota or a refused network connection SHALL be `infra`, and `refused` SHALL be a refusal by the model. The class SHALL be taken from the provider's own failure words (the failed turn's message, the CLI's error events and its standard error), never from the model's text or the contents of files in the stream, and the message of a failed turn SHALL NOT be replaced by the exit error that follows it. A job SHALL NOT be able to write files or use the network beyond its model provider: a Claude job has no tool that runs commands, and a Codex job reads files with commands that its read-only sandbox keeps from writing and from the network. A job log that cannot be created or written SHALL end the run with status 3 naming the file, after stopping the job. A usage count the provider does not report SHALL be recorded as unknown, never as zero, and a duration or cost below zero from the runner SHALL end the run with status 3 instead of being recorded.

#### Scenario: Output that does not match the schema
- **WHEN** a hypothesis job returns JSON without its `predictions`
- **THEN** the job fails with `invalid_output` and the cluster's diagnosis is failed with that kind

#### Scenario: Timeout
- **WHEN** a job runs longer than its job kind's time limit
- **THEN** the job is stopped and fails with `infra`, and the run ends with status 3 and prints the thread to resume

#### Scenario: A text that only mentions a limit
- **WHEN** a job fails with a message such as "Connection refused" or "limit reached in the parser" and no HTTP status 429
- **THEN** it fails with `infra`, not `refused` or `quota_exhausted`

### Requirement: Adapters run under subscription sign-in only
The Claude adapter SHALL run the Claude Code CLI in headless mode with stream-json output, a JSON schema for the answer, only the Read, Grep and Glob tools without any allowance rule (so that, in don't-ask mode, it reads only the job's folder and the folders added for it), no MCP servers, no saved session and the job's folder as working directory; a CLI that Windows cannot start without a shell (a `.cmd` script shim) SHALL fail the job with `infra` and a message naming the profile's `agents.executables` setting. The Codex adapter SHALL run the Codex SDK with a read-only sandbox, no approvals, no web search, no network access for commands and without the repository's instruction files; Codex reads files with commands, which the sandbox keeps from writing. Both SHALL remove API-key variables from the child's environment. The Claude adapter SHALL list the evidence images in the prompt and SHALL fail the job with `invalid_output` when the model answers without a Read of each of them that succeeded, that is, one whose tool result is no error (the Codex adapter attaches them as image inputs), and SHALL fail the job with `infra` when the CLI reports any API-key source other than none; the Codex adapter SHALL fail the job with `infra` before it starts when the Codex sign-in is not a ChatGPT subscription. A file change, MCP tool call or web search reported by Codex SHALL fail the job with `infra`.

#### Scenario: API key in the environment
- **WHEN** `ANTHROPIC_API_KEY` is set in the workflow's environment and a Claude job runs
- **THEN** the CLI is started without that variable

#### Scenario: CLI reports an API-key source
- **WHEN** the Claude CLI's init event reports an API-key source other than `none`
- **THEN** the job is stopped and fails with `infra` before the model's answer is used

#### Scenario: Codex signed in with an API key
- **WHEN** the Codex sign-in file says the sign-in is an API key
- **THEN** the Codex job fails with `infra` and no Codex process starts

### Requirement: Provider, model and effort are chosen per job kind
The local workflow profile SHALL be able to choose, for each job kind (`hypothesis`, `challenge`), the provider (`claude` or `codex`), the model (or the CLI's default), the effort and the time limit, and SHALL be able to set the model pool size, the run budget for model time and the CLI executables. Without a profile, hypothesis jobs SHALL run on Claude and challenge jobs on Codex. The provider, model and effort SHALL be recorded with every job. An invalid profile SHALL be a setup error, a time limit above 35 000 minutes included.

#### Scenario: Challenger on another provider by default
- **WHEN** no profile sets the job kinds and a cluster is diagnosed
- **THEN** its hypothesis job runs on Claude and its challenge job on Codex, and both records name their provider

#### Scenario: Unknown provider
- **WHEN** the profile names provider `other` for `challenge`
- **THEN** the run ends with status 3 naming the profile

### Requirement: Each cluster is diagnosed from a sealed context
Before any model job, the workflow SHALL write for each cluster a context made only of recorded evidence: the cluster's members with their cores, crops and both sides' OCR text; for each member case its mode, fixture file name and fixture hash and the expanded actions up to the capture; the cases and captures a check may name; and the identity of a history-less snapshot of the app's source and data that the thread shares. The context SHALL be identified by the SHA-256 of its manifest, building it again from the same run SHALL give the same hash, and every job of the cluster SHALL record that hash. Prompts SHALL be built from the manifest only and SHALL mark text taken from the run as untrusted data. Each job SHALL work in a copy of its cluster's context folder and of the snapshot, made in a scratch folder outside the repository and removed when the job ends (a copy that cannot be removed is named in the log and does not replace the job's result), so that no log of another job, other thread, instruction file or version history of the repository lies around its working folder, whichever way a provider limits reads; the snapshot SHALL have no version history and SHALL be of the source the captured candidate was built from: a candidate build SHALL record next to the candidate the identity of the compiled source (`Chummer/`) as it was when the build started, and when the compiled source of the snapshot differs from that record, or the candidate has none, the run SHALL end with status 3 and no job SHALL run, also with `--only diagnose` on recorded captures. Data and language files are copied into each staged app at capture time, so they are capture inputs and not build inputs, and editing them SHALL NOT make diagnosis fail. A recorded file that the context needs and cannot read SHALL be a setup error.

#### Scenario: Same run, same context
- **WHEN** a thread is resumed and the context of a cluster is built again
- **THEN** its hash equals the hash recorded by the jobs before the interruption

#### Scenario: Source edited without a rebuild
- **WHEN** a file under `Chummer/` is edited after the candidate was built and `npm start -- --only diagnose` runs on the recorded captures
- **THEN** the run ends with status 3 naming the recorded and the current identity and saying to build again, and no job runs

#### Scenario: Data file edited without a rebuild
- **WHEN** a file under `bin/data` or `bin/lang` is edited and the candidate is not rebuilt
- **THEN** diagnosis runs

#### Scenario: Candidate without a recorded source
- **WHEN** the candidate was built outside the workflow and `--only diagnose` runs
- **THEN** the run ends with status 3 saying that the build step has to record the source, and no job runs

#### Scenario: Job folders
- **WHEN** a job runs
- **THEN** its working folder and the snapshot beside it are copies outside the repository and the thread's folder, the prompt names only those copies, and they are made only when the job gets its place in the model pool and removed after the job

#### Scenario: Missing crop
- **WHEN** a crop listed in `triage.json` no longer exists
- **THEN** the run ends with status 3 naming the file, and no job of that cluster runs

### Requirement: A hypothesis is challenged independently
After triage the workflow SHALL start one hypothesis job per cluster, in parallel up to the model pool size. A hypothesis SHALL either abstain with a reason, or give a causal claim, a mechanism class, source locations in the snapshot, evidence, a confidence and one to four predicted observations, each naming a case and capture of the check vocabulary and whether it `differs` or `matches`. For every cluster with a hypothesis, a challenge job SHALL run in a fresh session that sees the context and the hypothesis and SHALL either give an alternative explanation of the same shape whose claim differs and that predicts at least one capture the hypothesis also predicts with the other expectation, or say why there is no alternative. A location whose file is not in the snapshot or whose line is outside the file (a final line break ends the last line and does not start another), a prediction outside the vocabulary or repeated, and an alternative that does not disagree on a shared capture SHALL make the job `invalid_output`. A job that a stopped run interrupted SHALL run again on resume; a finished job SHALL NOT.

#### Scenario: Fan-out
- **WHEN** triage reports three clusters
- **THEN** three hypothesis jobs start without waiting for each other (up to the pool size), and challenge jobs start once every hypothesis job finished

#### Scenario: Abstention
- **WHEN** a hypothesis job abstains
- **THEN** no challenge job runs for that cluster and its diagnosis is reported as abstained with the reason

#### Scenario: Alternative that does not disagree
- **WHEN** the challenger's alternative predicts every shared capture the same way as the hypothesis
- **THEN** the challenge job fails with `invalid_output`

#### Scenario: Killed during the challenge
- **WHEN** the run is killed while a challenge job runs and the thread is resumed
- **THEN** the hypothesis job is not run again and the challenge job runs again

### Requirement: A usage limit is waited out
A job that fails with `quota_exhausted` SHALL NOT fail its cluster or the run: the graph SHALL route to a quota wait that sleeps 1, 2, 5, 10 and 15 minutes for the first five waits of the process and 15 minutes for every later one, and then SHALL run the waiting jobs again. A successful job SHALL reset the sequence. After the process restarts, the first retry of a waiting job SHALL be immediate. Time spent waiting SHALL NOT count against any job's time limit or the run budget. A quota wait SHALL NOT ask the operator anything. Ctrl+C during a wait SHALL end the run with status 3 and leave the thread resumable at the wait. The graph's limit on steps SHALL NOT end a run that keeps waiting.

#### Scenario: Limit reached
- **WHEN** a hypothesis job fails with `quota_exhausted` for the first time in the process
- **THEN** the run waits one minute and runs that job again, and the cluster is not failed

#### Scenario: Restart during a wait
- **WHEN** the run is stopped during a quota wait and the thread is resumed
- **THEN** the waiting job runs again at once

### Requirement: The run budget limits model time only
The run budget bounds when model jobs start: a job SHALL NOT start, at the moment it gets its place in the model pool, once the durations of the thread's finished model jobs add up to the profile's run budget, and its cluster SHALL be reported as `budget_exhausted`, apart from failed clusters. A job that waited in the pool SHALL see the time charged by the jobs that ran before it, also when all were sent in the same step; a job that has started is not stopped by the budget. Quota waits SHALL NOT be charged.

#### Scenario: Budget spent
- **WHEN** the finished jobs have used the whole run budget and a cluster still needs its challenge job
- **THEN** that job does not start and the cluster is reported as `budget_exhausted`

#### Scenario: Queued jobs and a small budget
- **WHEN** several hypothesis jobs are sent together, the pool runs them one at a time, and the first uses the whole budget
- **THEN** the jobs queued behind it do not start and their clusters are reported as `budget_exhausted`

### Requirement: Predictions are checked in one batched capture run
When every cluster's jobs are done, the workflow SHALL merge the predictions of the hypotheses and alternatives into one capture runner call on the desktop lane, with the union of the named cases and of the named captures and the thread's case file, settings overlay, threshold and canonical cache; it SHALL NOT reuse recorded capture steps. When no cluster has a prediction, no check run SHALL start. Each prediction SHALL be compared with the observation of its case and capture: `matches` when the result passed, `differs` when it failed with a visual difference or a size mismatch, `not-observed` when it is missing or was lost to an execution failure. A cluster SHALL be `refuted` when an observed hypothesis prediction is wrong, `confirmed` when every hypothesis prediction is observed and right and the alternative, if any, has an observed wrong prediction, and `undecided` otherwise. The check run's execution outcome (status, coverage validity, failures) SHALL be reported apart from its observations; a capture status of 3 SHALL be a setup error and a status of 2 SHALL make the run's status 2.

#### Scenario: Two clusters, one capture run
- **WHEN** two clusters predict observations in two different cases
- **THEN** one capture runner call names both cases and the captures of both

#### Scenario: Hypothesis confirmed over its alternative
- **WHEN** the hypothesis predicts `differs` for a capture, its alternative predicts `matches`, and the check run's result for that capture failed with a visual difference
- **THEN** the cluster's check outcome is `confirmed`

#### Scenario: Observation lost
- **WHEN** the check run's capture of a predicted case fails to execute
- **THEN** that prediction is `not-observed`, the cluster is `undecided`, and the check's execution failure is reported apart from the observations

### Requirement: Every model job is recorded
Every model job, including a failed one, a quota failure and an `infra` failure, SHALL be recorded in the workflow's store with one schema for all job kinds: record ID, job kind, thread, subject, context hash, prompt version, provider, model and effort, start and end, duration, usage (and cost when the provider reports it), the result or the failure kind with its message, the validated output, and labels. The check outcome of a cluster SHALL be added as the `check` label of every one of its jobs' records, also those of attempts that ended the run with `infra` before a resume. The thread's `diagnosis.json` SHALL list each cluster's context hash, hypothesis, challenge, check outcome and record IDs.

#### Scenario: Failed job recorded
- **WHEN** a challenge job fails with `invalid_output`
- **THEN** its record has result `invalid_output` with the validation errors, no output, and the cluster's subject

#### Scenario: Label added
- **WHEN** a cluster's check outcome is `refuted`
- **THEN** the records of its hypothesis and challenge jobs carry the label `check: refuted`
