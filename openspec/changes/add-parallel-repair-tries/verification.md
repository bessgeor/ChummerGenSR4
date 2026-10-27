# Verification

## Task 1.1: several hypotheses per cluster

| Command | Result |
| --- | --- |
| `npm run workflow:typecheck` | Passed (exit 0) on the final source. |
| `npm run workflow:test`, run 1 | Failed before the router test was updated: 576 tests, 575 passed, 1 failed (exit 1). `not ok 84 - the router waits first, then hypothesizes, then challenges, then checks once` (`diagnosis-graph.test.ts`): `Expected values to be strictly deep-equal` with actual `{ kind: 'hypothesize', jobs: [{ clusterId: 'a', variant: 1 }] }` and expected `{ kind: 'hypothesize', clusters: ['a'] }`. Cause: the route now names one job per hypothesis; the test was updated to the new route and extended to several hypotheses. |
| `npm run workflow:test`, run 2 | Passed with the new tests: 586 tests, 586 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 3 | Passed after a whole cluster replaces the one it names in the state and with the merge test: 587 tests, 587 passed, 0 failed (exit 0). |
| `npm run workflow:test`, run 4 | Passed on the final source, with a budget-stopped hypothesis ending an unconfirmed cluster as `budget_exhausted` and no quota wait for a failed cluster: 588 tests, 588 passed, 0 failed, 0 skipped (exit 0). |
| `npm run openspec:validate` | Passed strict validation: 21 passed, 0 failed. |
| SHA-256 of `bin/ChummerGenSR4.exe` | `9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56`; the executable was not built, launched or touched. |

Every test below runs the workflow graph with fake model jobs and fake check captures over fixture run folders. No live run belongs to this task.

| Evidence named by the task | Tests |
| --- | --- |
| Two hypotheses, one confirmed and one refuted | `diagnosis-hypotheses.test.ts`: both hypotheses start side by side, then each is challenged with its own hypothesis only; their records are numbered from one sequence and each challenge record names its own hypothesis; one check run covers the predictions of both hypotheses and both alternatives; hypothesis 1 is `refuted`, hypothesis 2 `confirmed`, the cluster `confirmed`; each record is labelled with its own hypothesis's outcome; `diagnosis.json` lists both hypotheses, and the report line and check line name each outcome. Also: every hypothesis refuted refutes the cluster, and the repair starts from the confirmed hypothesis 2 (its prompt and `hypothesisRecord`). `check.test.ts`: the cluster rule (any confirmed, every predicting one refuted, else undecided) and the plan over every challenged hypothesis. |
| An abstaining variant | `diagnosis-hypotheses.test.ts`: an abstaining hypothesis gets no challenge and no label while the other decides the cluster; a cluster whose every hypothesis abstained is `abstained`, not checked, and concludes `abstained`. Also a failed hypothesis fails its cluster (exit 2). |
| A resumed thread | `diagnosis-hypotheses.test.ts`: a run killed during hypothesis 2's challenge ends with 3; on resume no hypothesis is asked again, only that challenge runs again, record IDs stay distinct and the labels stay per hypothesis. |
| A thread stored with one hypothesis | `diagnosis-hypotheses.test.ts`: a thread whose options lack `hypotheses` and whose clusters lack `variants` and `firstRecords` is killed during its challenge and resumed as one hypothesis; every record gets the cluster's label, as before. `options.test.ts`: `diagnosis.hypotheses` is 1 to 3, 1 by default and in options stored without it. |

Review findings not changed:

- A failed hypothesis ends its cluster's jobs, so the cluster's other hypotheses are not challenged: the cluster is failed whatever they would show, and it is not checked.
- The record of a job interrupted before its task's write was checkpointed is listed by the cluster only and gets the cluster's label: a record holds no hypothesis number.
