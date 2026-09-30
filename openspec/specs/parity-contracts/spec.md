# parity-contracts Specification

## Purpose
Defines how data shared between the .NET parity tools and TypeScript tooling is specified once as JSON Schema and turned into checked-in, drift-checked code for both languages.

## Requirements

### Requirement: JSON Schema is the single source for cross-language data
Every file format that is read or written by more than one language SHALL be defined by a JSON Schema under `contracts/schemas/`. C# code (System.Text.Json) and TypeScript zod code SHALL be generated from those schemas with a pinned `quicktype` version and checked in under `contracts/generated/`. Generated files SHALL NOT be edited by hand.

#### Scenario: Regenerating produces the checked-in code
- **WHEN** a contributor runs `npm run contracts:generate` on a clean checkout
- **THEN** the files under `contracts/generated/` are unchanged

#### Scenario: Schema change without regeneration is caught
- **WHEN** a schema is edited and the generated code is not regenerated
- **THEN** `npm run contracts:check` names the stale files
- **AND** exits with a non-zero status

#### Scenario: Stray generated file is caught
- **WHEN** a file under `contracts/generated/` has no matching schema
- **THEN** `npm run contracts:check` names the extra file
- **AND** exits with a non-zero status

### Requirement: Every schema has a round-trip contract test
Each schema SHALL have an example document under `contracts/examples/`. A C# test SHALL deserialize it with the generated types and serialize it again, and a TypeScript test SHALL parse it with the generated zod schema and serialize it again. Both SHALL require the result to equal the example as a JSON value.

#### Scenario: Round-trip passes for an up-to-date schema
- **WHEN** the generated code matches the schemas
- **THEN** the C# and TypeScript round-trip tests pass for every schema

#### Scenario: Schema without an example fails the tests
- **WHEN** a schema has no example document
- **THEN** the contract tests fail and name the schema

### Requirement: C# readers reject invalid documents
C# code that reads a contract document SHALL reject missing required properties, unknown properties and explicit nulls for non-nullable properties, and SHALL name the offending file in the error. It SHALL NOT substitute defaults for invalid input.

#### Scenario: Unknown property
- **WHEN** a case file contains a property the schema does not define
- **THEN** loading fails with an error naming the file and the property

#### Scenario: Missing required property
- **WHEN** a case file omits a required property
- **THEN** loading fails with an error naming the file and the property
