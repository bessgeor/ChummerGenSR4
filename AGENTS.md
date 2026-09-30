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

## Contracts

- Data read or written by more than one language is defined by a JSON Schema in `contracts/schemas/`. Edit the schema, then run `npm run contracts:generate`; never edit `contracts/generated/` by hand.
- Every schema needs an example in `contracts/examples/`. `npm run contracts:check` (drift), `npm run contracts:test` (TypeScript round-trip) and `npm run parity:test` (C# round-trip) must pass.

## Visual parity capture

- `npm run build:candidate` builds the app from the current source into `out/candidate/bin/`. Use it instead of building `Chummer/Chummer.csproj` yourself.
- `npm run parity` captures every case in `parity/cases/characters.json` on the canonical and the candidate executable; `npm start` builds the candidate first. Pass options after `--`, for example `npm run parity -- --case Diego_v_alpha2_by_bessgeor --capture common`; `--help` lists them.
- A run writes only under `out/runs/<runId>/`: staged apps, fixture copies, `captures/`, `summary.json` and `results.json`. The exit status is 0 (all passed), 1 (visual differences), 2 (execution failures) or 3 (setup error). Read the summary's per-action outcomes for execution and `results.json` for visual pass/fail, and report them separately.
- Run-specific settings go in a folder passed with `--settings-overlay`. Keep it outside the repository or under `out/`; never edit `bin/settings/` for a run.
- Add a fixture to `parity/fixtures/characters/` only after reviewing its content (names, notes, links, images), and declare its mode in the case file.

## Desktop use

- A capture run drives real windows. Only one live run may use the desktop at a time: never start a second run while one is active, and watch a slow run instead of restarting it.
- Leave the mouse and keyboard alone during a run; another window taking the foreground fails the current action with a `window-activation` reason.
