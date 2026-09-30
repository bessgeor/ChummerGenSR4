# Verification

Scope: process and docs only. Nothing here launches the app, so there is no live evidence to collect; every check below ran locally with the tools named. Node.js 22.17.0, npm 10.9.2, Windows 10.

## Checked

### Fresh clone, install and strict validation (development-process: validation from a fresh clone)

A new clone of the `setup-openspec` branch (with `core.longpaths=true`, needed on Windows because `bin/saves/` has deep paths):

| Command | Result |
|---|---|
| `npm install` | exit 0, `found 0 vulnerabilities` |
| `npx openspec --version` | `1.13.2`, the latest stable release on npm (`dist-tags.latest`) |
| `npm run openspec:validate` | exit 0, `✓ change/setup-openspec`, `Totals: 1 passed, 0 failed (1 items)` |

### Invalid change fails (development-process: invalid change fails validation)

In the same scratch clone, a throwaway change `broken-change` held one ADDED requirement with no scenario. `npm run openspec:validate` exited 1:

```
✗ change/broken-change
  ✗ [ERROR] demo/spec.md: ADDED "No scenario" must include at least one scenario
✓ change/setup-openspec
Totals: 1 passed, 1 failed (2 items)
```

The throwaway change was deleted afterwards; it never reached the branch.

### Archive keeps the evidence (development-process: archive merges deltas and keeps evidence)

A trial `npx openspec archive setup-openspec --yes` in the scratch clone created `openspec/specs/development-process/spec.md` with 4 requirements, moved the change to `openspec/changes/archive/2026-10-01-setup-openspec/` with `verification.md` inside it, and `npm run openspec:validate` then passed with `✓ spec/development-process`. The real archive is this change's final commit.

### Project rules reach the agent

- `openspec instructions proposal|specs|design|tasks --change setup-openspec` prints the project context and each artifact's rules from `openspec/config.yaml`.
- `openspec instructions apply --change setup-openspec` prints the four apply guidance lines under "Operation Guidance".
- `AGENTS.md` states the same rules as `config.yaml` and the `development-process` spec: artifact order, about eight tasks, one change per pull request, `verification.md` contents, real failures preserved, execution apart from visual results, and the canonical executable.

### Generated skills

`openspec init --tools claude,codex --profile core` wrote 6 skills and 6 `/opsx` commands to `.claude/` and 6 skills to `.agents/skills/`; Codex gets no command files. A later `openspec update` printed `✓ All 2 tool(s) up to date (v1.13.2)`.

The first `openspec update` also rewrote the machine's global OpenSpec config from the default `core` profile to an explicit `custom` profile with the same six workflows. The profile keys were reset with `openspec config unset`, and a second `openspec update` left the global config unchanged.

### Ignore rules

`git check-ignore --no-index` results:

| Path | Result |
|---|---|
| `node_modules/x`, `workflow/node_modules/x` | ignored |
| `out/x`, `out/runs/1/a.png` | ignored |
| `src/App/bin/x`, `src/App/obj/x`, `Chummer/bin/Debug/x` | ignored |
| `.idea/x`, `a.DotSettings.user`, `.claude/settings.local.json`, `TestResults/x` | ignored |
| `bin/data/x.xml`, `bin/settings/x.xml`, `bin/sheets/x.xsl`, `bin/saves/x.chum`, `bin/lang/x.xml`, `bin/data/out/x`, `bin/changelog.txt` | not ignored |
| `.claude/skills/x/SKILL.md` | not ignored |

No tracked file newly matches an ignore rule. (The `base_data/*.zip` files already matched `*.zip` before this change.)

### Diff scope

`git diff origin/master --stat` lists only `.agents/skills/**`, `.claude/commands/opsx/**`, `.claude/skills/**`, `.gitignore`, `AGENTS.md`, `README.md`, `openspec/**`, `package.json` and `package-lock.json`. `git diff --quiet origin/master -- bin Chummer` reports no change. Every `resolved` URL in `package-lock.json` points at `registry.npmjs.org`.

### Canonical executable

`sha256sum bin/ChummerGenSR4.exe` returned `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56` at the start and at the end of the work. The executable was not launched.

## Not verified

- Invoking the generated workflows from inside Claude Code (`/opsx:*`) and Codex (`openspec-*` skills). The files are the CLI's own output and were not exercised in either tool here.
- Whether the one-change-per-pull-request and commit-order requirements are followed. These are process rules checked in review; nothing enforces them automatically yet.
- The canonical-hash scenario for a live run. No change runs the app yet; the first one that does records it.
