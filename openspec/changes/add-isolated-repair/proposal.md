# Proposal

## Why

Diagnosis ends with a confirmed hypothesis: a cause in the candidate's source that a check capture backed up. Nothing turns it into a change of the source, and nothing tells whether a change made from it removes the discrepancy. A model that edits the source needs a place where it cannot read the repository's history (a `git log` or a revert would stand in for understanding the cause), cannot touch the canonical executable, the parity tools or the cases that judge it, and whose result can be built and captured without disturbing the working tree, the candidate of the thread or other attempts. A failed attempt has to stay inspectable instead of disappearing.

## What Changes

- **Repair node.** After diagnosis, the workflow starts one repair attempt for each cluster whose check outcome is `confirmed`, in parallel up to the model pool size (`Send` fan-out). `--no-repair` ends the run after diagnosis.
- **Owned, history-less workspace.** Each attempt works in its own scratch folder outside the repository: a writable copy of the thread's source snapshot (no version history) and a read-only copy of the cluster's sealed context. A new job kind `repair` (Claude by default) gets the hypothesis, the challenge and the check observations, and may edit only files in its source copy: Claude gets Read, Grep, Glob, Edit and Write and no command tool; Codex runs in a workspace-write sandbox without network, and a file change outside the copy fails the job.
- **Patch guard.** The attempt's patch is what differs between its copy and the snapshot. It must be non-empty, change only text files under `Chummer/`, delete none, stay within a size limit and name exactly the files the model said it changed; otherwise the attempt is rejected before any build.
- **Build in the CPU pool.** The patched copy is built with MSBuild into the attempt's own folder through the host runner's CPU pool (`build-candidate.mjs` gains `--source`, `--output` and `--log`); a failed build rejects the attempt.
- **Narrow check on the desktop lane.** One capture runner call with the attempt's executable as candidate (`--candidate-exe`), the cluster's cases and captures, and the thread's case file, overlay, threshold and canonical cache. The attempt passes only when the run has valid coverage and every selected capture is within the threshold; execution failures are reported apart and make the run's status 2.
- **Deadline.** The profile's `repair.deadlineMinutes` (default 60) bounds the model job and the build of an attempt; past it the attempt is rejected at stage `deadline`. Agent runners report a job that exceeds its time limit as a new failure kind, `timeout`, which diagnosis and evaluation still treat as a setup error.
- **Archive.** Every attempt is kept under the thread's `repair/<cluster>/attempt-<n>/`: the model's answer, the patch (`patch.diff` and the files before and after), the build log, the check run and the outcome, with the rejection stage and reason of a rejected attempt. `repair.json` lists every cluster's attempts.
- **Records.** Each repair job is an eval record (job kind `repair`), and a new automatic `repair` label holds its attempt's outcome. `--unattended` refuses to start a run that would dispatch repair jobs, since no certificate covers them.

Area: tooling only (the `workflow/` workspace, `parity/scripts/build-candidate.mjs`, docs). The Chummer app, `bin/`, the capture runner, the comparer and the contracts are untouched; the canonical executable is only read. Evidence: unit tests with fake agents, a fake host and real folders (workspace, patch guard, build and check calls, deadline, archive, records, graph routing, quota waits, resume), and a live `npm start` run on one case with a temporarily seeded discrepancy: diagnosis, a repair attempt on Claude that is built and narrowly checked, a kill during the repair and a resume, with the canonical hash recorded before and after.

## Capabilities

### New Capabilities

- `isolated-repair`: repair attempts for confirmed clusters in owned, history-less workspaces, the patch guard, the attempt build, the narrow check, the deadline, the archive and the repair records.

### Modified Capabilities

- `discrepancy-diagnosis`: agent runners report `timeout`, may give a repair job a writable workspace, and the profile chooses the `repair` job kind.
- `parity-workflow`: the graph repairs confirmed clusters after diagnosis (`--no-repair`), the exit status covers repair, and `--unattended` refuses repair.
- `agent-evaluation`: eval records get the automatic `repair` label.

## Impact

- New files: `workflow/src/repair/` (workspace, patch, guard, prompt and schema, build, narrow check, archive, service, report), their tests.
- Edited files: the agent job types, both adapters, the agent settings and profile, the diagnosis service, grader and eval runs (`timeout`), the eval record labels, the capture arguments (`--candidate-exe`), the graph, its state and report, the options and arguments, the certificate gate, `parity/scripts/build-candidate.mjs`, `AGENTS.md`, `README.md`.
- No new dependency. Output stays in the git-ignored `out/` (the thread's folder) and in scratch folders that are removed after each attempt.
