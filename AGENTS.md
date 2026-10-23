# Agent guide

## OpenSpec workflow

- Every change is an OpenSpec change under `openspec/changes/<change-name>/` using the `spec-driven` schema. Project context and per-artifact rules live in `openspec/config.yaml`; the CLI feeds them into each artifact's instructions.
- Use the generated workflows: `/opsx:propose`, `/opsx:apply`, `/opsx:archive` in Claude Code, and the matching `openspec-*` skills in Codex. They are generated files; regenerate them with `npx openspec update` instead of editing them.
- Commit order on a change's branch:
  1. proposal, design, spec deltas and tasks (about eight tasks at most);
  2. small implementation commits;
  3. `verification.md`;
  4. `npx openspec archive <change-name>` as the final commit.
- Run `npm run openspec:validate` (strict) before every commit that touches `openspec/`. A failing validation blocks the change.

## One change per pull request

- A branch is named after its change and carries exactly that one change.
- Branch from `master`, or from the predecessor change's branch while its pull request is still open.

## Verification evidence

- Each change has `verification.md` beside its proposal. List the commands you ran and what they printed or produced.
- Keep fixture-tested scope separate from live evidence. When a live dependency is unavailable, list the requirement as unverified; fixture results never stand in for a live run.
- Preserve real failures: record a failed step as a failure with its output, never as a skip, a warning or a success. Report execution failures separately from visual differences.
- Mark a task done only when the evidence it names is recorded.

## Canonical executable

- `bin/ChummerGenSR4.exe` is the canonical build and is immutable. Never rebuild, replace, copy over or edit it.
- The app's Release configuration builds `ChummerGenSR4.exe` into `bin/`, so never build it with the default output path.
- Before and after any run that launches it, record its SHA-256. Both must equal `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`.
