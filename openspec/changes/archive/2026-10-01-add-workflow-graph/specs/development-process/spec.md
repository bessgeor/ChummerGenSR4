# Spec Delta

## ADDED Requirements

### Requirement: Continuous integration checks what needs no desktop
The repository SHALL run a GitHub Actions job on a Windows runner for every push and pull request. It SHALL install the locked npm dependencies, type-check the workflow, run its unit tests, build the parity tools in Release and check the generated contracts for drift. Any failing step SHALL fail the job.

#### Scenario: Contract drift
- **WHEN** a commit changes a schema without regenerating `contracts/generated/`
- **THEN** the job fails at the drift check

#### Scenario: Type error in the workflow
- **WHEN** a commit introduces a TypeScript type error in `workflow/`
- **THEN** the job fails at the type check
