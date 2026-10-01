## MODIFIED Requirements

### Requirement: Model jobs run through one agent runner with typed failures
Every model job SHALL run through one agent runner that takes the job kind, its subject, a prompt, images, an output schema, a workspace (read-only, or writable for a repair job) and a time limit, and returns either the output validated against the schema with its usage and duration, or a failure of kind `invalid_output`, `refused`, `quota_exhausted`, `timeout` or `infra`. Output that is not valid JSON, does not match the schema or fails the job's semantic validation SHALL be `invalid_output` and SHALL NOT be used. A job that exceeds its time limit SHALL be stopped and SHALL be `timeout`; a CLI that cannot start or crashes, and a missing sign-in, SHALL be `infra`. Diagnosis jobs, grader jobs and eval-run jobs SHALL treat `timeout` like `infra`: the run ends with status 3 and stays resumable. A failure SHALL be `quota_exhausted` only when the provider reports HTTP status 429 or one of the subscription's own usage-limit messages; a failure that merely mentions a limit, a quota or a refused network connection SHALL be `infra`, and `refused` SHALL be a refusal by the model. The class SHALL be taken from the provider's own failure words (the failed turn's message, the CLI's error events and its standard error), never from the model's text or the contents of files in the stream, and the message of a failed turn SHALL NOT be replaced by the exit error that follows it. A read-only job SHALL NOT be able to write files, and no job SHALL be able to use the network beyond its model provider: a Claude job has no tool that runs commands, and a Codex job reads files with commands that its sandbox keeps from the network and, for a read-only job, from writing. A job log that cannot be created or written SHALL end the run with status 3 naming the file, after stopping the job. A usage count the provider does not report SHALL be recorded as unknown, never as zero, and a duration or cost below zero from the runner SHALL end the run with status 3 instead of being recorded.

#### Scenario: Output that does not match the schema
- **WHEN** a hypothesis job returns JSON without its `predictions`
- **THEN** the job fails with `invalid_output` and the cluster's diagnosis is failed with that kind

#### Scenario: Timeout
- **WHEN** a diagnosis job runs longer than its job kind's time limit
- **THEN** the job is stopped and fails with `timeout`, and the run ends with status 3 and prints the thread to resume

#### Scenario: A text that only mentions a limit
- **WHEN** a job fails with a message such as "Connection refused" or "limit reached in the parser" and no HTTP status 429
- **THEN** it fails with `infra`, not `refused` or `quota_exhausted`

### Requirement: Adapters run under subscription sign-in only
The Claude adapter SHALL run the Claude Code CLI in headless mode with stream-json output, a JSON schema for the answer, without any allowance rule, no MCP servers, no saved session and the job's folder as working directory: a read-only job gets only the Read, Grep and Glob tools in don't-ask mode (so that it reads only the job's folder and the folders added for it), and a writable job gets Read, Grep, Glob, Edit and Write in accept-edits mode, and never a tool that runs commands. A CLI that Windows cannot start without a shell (a `.cmd` script shim) SHALL fail the job with `infra` and a message naming the profile's `agents.executables` setting. The Codex adapter SHALL run the Codex SDK with no approvals, no web search, no network access for commands and without the repository's instruction files, in a read-only sandbox for a read-only job and a workspace-write sandbox for a writable job; Codex reads files with commands, which the sandbox keeps from the network and, read-only, from writing. Both SHALL remove API-key variables from the child's environment. The Claude adapter SHALL list the evidence images in the prompt and SHALL fail the job with `invalid_output` when the model answers without a Read of each of them that succeeded, that is, one whose tool result is no error (the Codex adapter attaches them as image inputs), and SHALL fail the job with `infra` when the CLI reports any API-key source other than none; the Codex adapter SHALL fail the job with `infra` before it starts when the Codex sign-in is not a ChatGPT subscription. A file change reported by Codex SHALL fail a read-only job with `infra`, and a writable job when it names a path outside the job's folder; an MCP tool call or a web search SHALL fail any job with `infra`.

#### Scenario: API key in the environment
- **WHEN** `ANTHROPIC_API_KEY` is set in the workflow's environment and a Claude job runs
- **THEN** the CLI is started without that variable

#### Scenario: CLI reports an API-key source
- **WHEN** the Claude CLI's init event reports an API-key source other than `none`
- **THEN** the job is stopped and fails with `infra` before the model's answer is used

#### Scenario: Codex signed in with an API key
- **WHEN** the Codex sign-in file says the sign-in is an API key
- **THEN** the Codex job fails with `infra` and no Codex process starts

#### Scenario: Writable Claude job
- **WHEN** a repair job runs on Claude
- **THEN** the CLI gets the tools Read, Grep, Glob, Edit and Write, the permission mode `acceptEdits` and no allowance rule

#### Scenario: Codex writes outside the job's folder
- **WHEN** a writable Codex job reports a file change of a path outside its working folder
- **THEN** the job is stopped and fails with `infra`

### Requirement: Provider, model and effort are chosen per job kind
The local workflow profile SHALL be able to choose, for each job kind (`hypothesis`, `challenge`, `grade`, `repair`), the provider (`claude` or `codex`), the model (or the CLI's default), the effort and the time limit, and SHALL be able to set the model pool size, the run budget for model time, the CLI executables, the certificates folder and the repair deadline. Without a profile, hypothesis, grade and repair jobs SHALL run on Claude and challenge jobs on Codex. The provider, model and effort SHALL be recorded with every job. An invalid profile SHALL be a setup error, a time limit above 35 000 minutes included.

#### Scenario: Challenger on another provider by default
- **WHEN** no profile sets the job kinds and a cluster is diagnosed
- **THEN** its hypothesis job runs on Claude and its challenge job on Codex, and both records name their provider

#### Scenario: Unknown provider
- **WHEN** the profile names provider `other` for `challenge`
- **THEN** the run ends with status 3 naming the profile
