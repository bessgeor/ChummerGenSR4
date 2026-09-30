# Tasks

## 1. Tooling

- [x] 1.1 Extend `.gitignore` for `node_modules/`, `/out/`, IDE state and nested build output, keeping the root `bin/` tracked; verify `git check-ignore` ignores `node_modules/x`, `out/x` and `src/App/bin/x` but not `bin/data/x` or `bin/settings/x`
- [x] 1.2 Add a root `package.json` pinning `@fission-ai/openspec` exactly, with the `openspec:validate` script; verify `npm install` succeeds and `npx openspec --version` prints the pinned version

## 2. OpenSpec setup

- [x] 2.1 Initialize `openspec/` and write the project context and rules in `openspec/config.yaml`; verify `openspec instructions proposal --change setup-openspec` shows them
- [x] 2.2 Generate the OpenSpec skills and commands for Claude Code and Codex with the pinned CLI; verify `openspec update` reports them up to date

## 3. Agent and contributor docs

- [x] 3.1 Add `AGENTS.md` with the OpenSpec workflow, one change per pull request, `verification.md` evidence and the canonical executable rule; verify each rule matches `openspec/config.yaml` and the `development-process` spec
- [x] 3.2 Add a "Development" section to `README.md` on how changes are made and validated; verify the commands it names run as written

## 4. Verification and archive

- [x] 4.1 Record `npm install`, `npm run openspec:validate`, the diff file list and the canonical executable's SHA-256 in `verification.md`, separating what was checked from what remains unverified
- [x] 4.2 Archive the change with `openspec archive setup-openspec`; verify `openspec/specs/development-process/spec.md` exists and `npm run openspec:validate` passes
