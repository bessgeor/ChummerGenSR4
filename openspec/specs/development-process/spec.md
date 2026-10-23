# development-process Specification

## Purpose
Defines how a change to this repository is proposed, validated, verified with recorded evidence, and archived, so that every step of the modernization is small, reviewable and backed by evidence.

## Requirements

### Requirement: Changes are proposed as OpenSpec changes
Every change to the repository SHALL be an OpenSpec change under `openspec/changes/<change-name>/` using the `spec-driven` schema. It SHALL contain a proposal, a design, spec deltas (or an explicit `skip_specs: true` opt-out when no behavior changes), and a task list of about eight tasks at most. Each change SHALL be delivered as exactly one pull request, on a branch named after the change.

#### Scenario: Planning artifacts come first
- **WHEN** a contributor starts a change
- **THEN** the first commit on the change's branch contains its proposal, design, spec deltas and tasks
- **AND** implementation commits follow that commit

#### Scenario: One change per pull request
- **WHEN** a pull request is opened
- **THEN** it adds or archives exactly one OpenSpec change
- **AND** its branch is named after that change

### Requirement: Specs and changes validate strictly
The repository SHALL pin an exact OpenSpec CLI version as a development dependency and SHALL provide `npm run openspec:validate`, which runs `openspec validate --all --strict`. The command SHALL exit non-zero when any spec or change is invalid, and a change SHALL NOT be merged while it fails.

#### Scenario: Validation from a fresh clone
- **WHEN** a contributor runs `npm install` and then `npm run openspec:validate` in a fresh clone
- **THEN** the pinned CLI validates every spec and change in strict mode
- **AND** the command exits with status 0 only if every item is valid

#### Scenario: Invalid change fails validation
- **WHEN** a change contains a requirement without a scenario
- **THEN** `npm run openspec:validate` reports the change as invalid
- **AND** exits with a non-zero status

### Requirement: Verification is recorded with evidence
Every change SHALL include `verification.md` beside its proposal. It SHALL list the commands that were run with their observed results, keep fixture-tested scope separate from live evidence, and name what remains unverified. Where a run drives the application's UI, it SHALL report execution outcomes separately from visual outcomes. A failed step SHALL be recorded as a failure with its output, never as a skip, a warning or a success.

#### Scenario: Live gate unavailable
- **WHEN** a live dependency needed to verify a requirement is unavailable
- **THEN** `verification.md` lists that requirement as unverified
- **AND** fixture results are not presented as live evidence

#### Scenario: Failed step is preserved
- **WHEN** a verification command fails
- **THEN** `verification.md` records the failure and its output
- **AND** the related task is not marked done

#### Scenario: Live run of the canonical executable
- **WHEN** a change runs `bin/ChummerGenSR4.exe`
- **THEN** `verification.md` records its SHA-256 before and after the run
- **AND** both values equal the recorded canonical hash

### Requirement: Completed changes are archived
A change SHALL be archived with `openspec archive <change-name>` in the final commit of its pull request, after its verification is recorded. Archiving SHALL merge the change's spec deltas into `openspec/specs/` and move the change, including `verification.md`, under `openspec/changes/archive/`.

#### Scenario: Archive merges deltas and keeps evidence
- **WHEN** the final commit archives a verified change
- **THEN** `openspec/specs/` contains the change's requirements
- **AND** the archived change folder still contains its `verification.md`
- **AND** `npm run openspec:validate` still passes
