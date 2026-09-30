# Proposal

## Why

Modernizing this codebase is too large to review as one piece. Each step needs a written intent, a checkable spec, and recorded evidence before it lands. OpenSpec gives that structure, and both Claude Code and Codex can drive it through generated skills. Nothing else can start until the process itself is in place.

## What Changes

- Add `openspec/` with `config.yaml` (schema `spec-driven`), holding the project context and the rules every change must follow: preserve real failures, report execution and visual outcomes separately, keep fixture evidence apart from live evidence, never touch the canonical `bin/ChummerGenSR4.exe`, keep tasks small.
- Generate the OpenSpec skills and slash commands for Claude Code (`.claude/`) and Codex (`.agents/skills/`) from the pinned CLI.
- Add a root `package.json` that pins `@fission-ai/openspec` as a dev dependency and adds `npm run openspec:validate` (`openspec validate --all --strict`).
- Add a minimal `AGENTS.md` with the workflow rules this iteration needs: the OpenSpec workflow, one change per pull request, `verification.md` evidence, and the canonical executable rule.
- Extend `.gitignore` for Node dependencies, run output under `out/`, and IDE and build output, without ignoring the tracked content of `bin/`.
- Add a short "Development" section to the README on how changes are made and validated.

Area: process and docs only. The Chummer app and `bin/` are untouched. Evidence: `npm install` and `npm run openspec:validate` pass, and the diff contains only the files listed here.

## Capabilities

### New Capabilities

- `development-process`: how a change is proposed, validated, verified with recorded evidence, and archived.

### Modified Capabilities

None; `openspec/specs/` is empty before this change.

## Impact

- New files: `openspec/**`, `.claude/skills/openspec-*`, `.claude/commands/opsx/*`, `.agents/skills/openspec-*`, `package.json`, `package-lock.json`, `AGENTS.md`.
- Edited files: `.gitignore`, `README.md`.
- New dev dependency: Node.js 20.19 or later and `@fission-ai/openspec`. The app's own build needs neither.
