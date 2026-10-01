# Spec Delta

## ADDED Requirements

### Requirement: Generated C# and the tool sources keep one line-ending form
The parity tools' C# sources, project files, props, targets and solution, and the generated C# under `contracts/generated/csharp/`, SHALL have their line endings pinned to CRLF in `.gitattributes`, and the contract generator SHALL write generated C# with CRLF, so that every checkout compiles the same assemblies. `npm run contracts:check` SHALL compare generated C# byte for byte and generated TypeScript ignoring line endings, and SHALL name a C# file whose line endings differ as stale. `npm run contracts:test` SHALL cover that check.

#### Scenario: Generated C# with LF endings
- **WHEN** a generated C# file holds LF line endings and its content is otherwise current
- **THEN** `npm run contracts:check` names the file as stale
- **AND** exits with a non-zero status

#### Scenario: Generated TypeScript with CRLF endings
- **WHEN** a generated TypeScript file holds CRLF line endings and its content is otherwise current
- **THEN** `npm run contracts:check` passes

#### Scenario: Regenerating keeps the pinned endings
- **WHEN** a contributor runs `npm run contracts:generate` on a clean checkout
- **THEN** the generated C# files hold CRLF line endings and `git diff` shows no change
