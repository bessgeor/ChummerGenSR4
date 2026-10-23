# Design

## Context

The repository holds the WinForms app (`Chummer/`) and its output folder `bin/`. `bin/` is not a disposable build folder: it tracks game data, translations, settings, print sheets, sample saves, and the canonical `bin/ChummerGenSR4.exe`, which is tracked even though `.gitignore` ignores `*.exe`. The Release configuration of `Chummer/Chummer.csproj` writes `ChummerGenSR4.exe` into that same folder. There is no Node tooling, no agent guidance, and no spec history yet. See proposal.md for why the process comes first.

## Goals / Non-Goals

**Goals:**
- A reproducible `npm run openspec:validate` from a fresh clone.
- Claude Code and Codex share one generated set of OpenSpec workflows.
- Project rules reach an agent through two paths: the OpenSpec CLI while it writes artifacts, and `AGENTS.md` for everything else.

**Non-Goals:**
- No new application code, tooling or CI; later changes add what they need.
- No change to the app, its build, or anything under `bin/`.
- No custom OpenSpec schema.

## Decisions

**Pin an exact CLI version and commit the lockfile.** `@fission-ai/openspec` is pinned to `1.13.2`, the latest stable release, without a range. Strict validation and the generated skills both depend on the CLI version, so an unplanned upgrade could fail validation or leave the skills stale. A version bump is its own small change that also regenerates the skills. *Alternative:* a caret range, rejected because it lets validation behavior drift between clones.

**Stock `spec-driven` schema, with `verification.md` as a plain file in the change.** The stock schema keeps the generated skills and `openspec validate` standard. `verification.md` sits beside the schema artifacts and moves with the change when it is archived. *Alternative:* a custom schema with verification as a tracked artifact; deferred until the stock schema proves insufficient.

**Generated skills are committed and never hand-edited.** `openspec init --tools claude,codex` with the `core` profile (propose, explore, apply, update, sync, archive) writes skills and `/opsx:*` commands to `.claude/`, and skills to `.agents/skills/` for Codex, which has no command files. Project-specific guidance lives in `openspec/config.yaml` and `AGENTS.md` instead, so `openspec update` can regenerate the skills without merge work.

**Rules live where the agent will read them.** `openspec/config.yaml` holds the per-artifact rules and the apply and archive guidance; the CLI injects them into the instructions for each artifact. `AGENTS.md` holds the few rules an agent needs outside OpenSpec: the workflow, one change per pull request, verification evidence, and the canonical executable. It grows only when a later change needs a new rule.

**Targeted ignores, root `bin/` stays tracked.** `.gitignore` gains `node_modules/`, a root-anchored `/out/` for run output, IDE state (`.idea/`, `*.DotSettings.user`, `.claude/settings.local.json`), `TestResults/`, and `[Bb]in/` with a `!/bin/` exception. The exception keeps the root `bin/` visible while build output folders of future projects stay ignored. *Alternative:* a blanket `bin/`, rejected because new data or settings files under `bin/` would silently stop showing up.

## Risks / Trade-offs

- [A Release build of the app overwrites the canonical executable] → `AGENTS.md` forbids building into `bin/`; live runs compare the SHA-256 before and after, and `git status` shows any change to the tracked file.
- [`verification.md` is not checked by the CLI] → it is reviewed with the pull request; the `development-process` spec states what it must contain.
- [Generated skill text is large and owned upstream] → it is regenerated rather than edited, so a CLI upgrade is a mechanical diff.

## Migration Plan

Additive only. Rolling back means reverting the pull request.
