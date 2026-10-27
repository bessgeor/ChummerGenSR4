# Design

## Context

`npm run discover` is its own composition root and LangGraph graph, checkpointed in `out/discovery/checkpoints.sqlite`, and its options name the workflow thread whose `inventory/` is the baseline. Its preparation requires that the working tree's designer files, scope and compiled source are those the baseline and the candidate build describe, which holds right after the workflow thread's inventory. The registry (`parity/discovery/registry.json`) and its rendering (`parity/cases/discovered.json`) are written into the working tree and never committed by the tool. A workflow thread's case file is one file, passed to every capture runner call, to diagnosis and to widening's levels.

## Goals / Non-Goals

**Goals:**

- A thread that finds nothing to fix looks for what it did not reach, without an operator.
- What discovery admits is captured by the next default run.
- Resuming the workflow thread resumes its discovery; no second discovery thread is started for it.

**Non-Goals:**

- No change to discovery's own rules: targets, jobs, validation, proof and admission stay as they are.
- No commit of the registry: it stays a working-tree change that a person (or a later change) commits.
- No discovery while differences remain: those go through diagnosis and repair first.

## Decisions

### When a thread discovers

The workflow graph gains a stage `discovery`, a subgraph between `capture` and `conclude`. After `capture` (whose last node is the inventory), the workflow graph routes to `discovery` instead of `diagnose` when all of these hold: discovery is on (`options.discovery` holds the fixture case file and the targets; it is null with `--no-discovery`, `--only` or `--no-diagnosis`, and when the case file is the registry's case file); the inventory ran (not a thread stored before it); every planned case has capture and compare status 0; triage has no cluster and no other finding. Otherwise the graph goes on as before. After `discovery` the graph concludes.

### The discovery stage

The stage's node runs one discovery thread through the same composition `npm run discover` uses, factored out of `discover-main.ts` into a function that takes the paths, host, lanes, agents and store and returns a runner. Its thread ID is `disc-<workflow thread>`: when the discovery checkpointer has that thread unfinished, the node resumes it; when it is finished, the node reads its conclusion without running it again; otherwise it starts it with options derived from the workflow thread: `from` = the workflow thread, the fixture case file (the thread's `--case-file`, or `parity/cases/characters.json` for the suite), settings overlay, threshold, canonical cache, `unattended`, the stored rank and scenario configurations, and `targets` from the profile. A setup error of the discovery thread ends the workflow run with status 3 and the discovery stays resumable through the workflow thread.

The node's result is `{ threadId, exitStatus, admitted: string[], differing: string[], documentPath }`, read from the discovery's `discovery.json`. It is stored in the workflow state as `threadDiscovery` (null when the thread did not discover); LangGraph does not let a state field share the name of the `discovery` stage. The exit status takes the discovery's status (1 or 2) into account. `conclude` writes it into `outcome.json`, and the outcome stays about the planned scope: an admitted scenario that differs is a finding for the next run, which captures it.

### The default suite

`resolveRunOptions` keeps `caseFile` as the file the thread captures. Without `--case-file`, the thread's start writes `out/workflow/threads/<thread>/suite-cases.json`: the fixture file's document with its `characters` paths rewritten relative to the suite's folder, followed by the discovered file's characters with their paths rewritten the same way; sequences and mode actions come from the fixture file, which is the only one that has them. `readRegistry` validates the registry and its rendering first. The suite is written once, when the thread starts, and a resumed thread keeps using it even when discovery changed the registry since. `--case-file` uses that file as before, and a thread's diagnosis and widening read the suite like any case file.

Capture keys hold the case's name, entry, actions, timings and fixture hash, not the case file's path, so a fixture case planned from the suite reuses the steps recorded from `characters.json`.

### Unattended and tuning

`dispatchedJobKinds` includes `rank` and `scenario` when discovery is on, so a new thread stores their active configurations and `--unattended` requires their certificates at the start, before anything runs.

## Risks / Trade-offs

- A thread that discovers holds the desktop for one more capture run and spends model time on the rank and scenario jobs; `--no-discovery` keeps the earlier behaviour.
- Discovery writes the registry into the working tree while the thread runs; a person editing those files during a run makes the discovery fail with a setup error, as it does today.

## Fixture and live evidence

Workflow tests prove the routing, the suite composition and its errors, the resumption of a discovery thread by ID and the reporting, with a fake discovery runner. Only a live run proves that discovery runs from a fresh inventory and that admitted cases are captured by the next default run; it records the canonical hash before and after.
