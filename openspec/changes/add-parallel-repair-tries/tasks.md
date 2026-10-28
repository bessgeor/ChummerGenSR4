# Tasks

Each task names the tasks it builds on as `(after: …)`, by number in this list or as `<change>#<number>` for a task of another change; `[desktop]` marks a task that needs a live run on the desktop.

## 1. Several hypotheses

- [x] 1.1 (after: add-repair-worktrees#2.1) Add `diagnosis.hypotheses`, the variants of a cluster's diagnosis, their challenges, the check over every variant and the labels per variant. Evidence: diagnosis graph tests for two variants with one confirmed and one refuted, an abstaining variant, a resumed thread and a thread stored with one hypothesis.

## 2. Parallel tries

- [x] 2.1 (after: 1.1) Add `repair.tries`, run an attempt's tries side by side in their own worktrees and select the best passed try. Evidence: repair tests for two passed tries with different sizes, a tie, every try rejected, a usage limit in one try, a spent budget, and the archive's `try-<k>/` folders.

## 3. Widening and reports

- [x] 3.1 (after: 2.1) Widen the selected try and show tries in `repair.json`, `widening.json` and the report. Evidence: widening graph tests with a two-try attempt and the report lines.

## 4. Docs

- [x] 4.1 (after: 3.1) Document hypotheses and tries in `AGENTS.md` and `README.md`. Evidence: `npm run workflow:typecheck`, `npm run workflow:test` and `npm run openspec:validate` pass (recorded in `verification.md`).

## 5. Verification and archive

- [ ] 5.1 (after: 4.1) [desktop] Run `npm start` live with two hypotheses and two tries on a confirmed cluster; record in `verification.md` the canonical hash before and after, each try's execution outcome apart from its visual result, the selection, fixture-tested scope apart from live evidence, and what remains unverified.
- [ ] 5.2 (after: 5.1) Archive the change with `openspec archive add-parallel-repair-tries`. Evidence: `npm run openspec:validate` passes after the archive.
