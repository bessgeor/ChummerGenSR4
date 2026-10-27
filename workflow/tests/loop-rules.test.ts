import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { CheckResult } from "../src/diagnosis/check.js";
import type { ClusterDiagnosis } from "../src/diagnosis/cluster-diagnosis.js";
import { exitStatus } from "../src/graph/run-workflow.js";
import { clusterEnd, type ClusterEnd, type DispositionInput } from "../src/loop/disposition.js";
import { threadOutcome } from "../src/loop/outcome.js";
import { latestRejection, nextAttempts, retryLimits, retryPlan } from "../src/loop/retry.js";
import type { RunOptions } from "../src/options/run-options.js";
import { finishedAttempts, mergeRepairs, type AttemptSummary, type CheckExecution, type ClusterRepair } from "../src/repair/cluster-repair.js";
import type { ClusterWidening, WideningStage } from "../src/widening/cluster-widening.js";

const execution = (status: 0 | 1 | 2, coverageValid = status !== 2): CheckExecution => ({
  runFolder: "narrow", status, coverageValid, invalidReasons: coverageValid ? [] : ["failure:build-alpha/candidate"], failures: coverageValid ? 0 : 1, passed: 0, failed: 1,
});

const attempt = (number: number, stage: AttemptSummary["stage"], check: CheckExecution | null = null): AttemptSummary => ({
  attempt: number, recordId: `t/d-1/repair/${number}`, folder: `repair/d-1/attempt-${number}`, outcome: stage === null ? "passed" : "rejected",
  stage, reason: stage === null ? null : `${stage} reason`, check,
});

function repair(status: ClusterRepair["status"], latest: AttemptSummary | null, earlier = 0, clusterId = "d-1"): ClusterRepair {
  return {
    clusterId, status, attempt: latest, waiting: null, records: [],
    earlier: Array.from({ length: earlier }, (_, index) => ({ attempt: index + 1, recordId: `r${index + 1}`, archive: "a", rejectedBy: "repair" as const, stage: "check", reason: "r" })),
  };
}

function widening(status: ClusterWidening["status"], stage: WideningStage | null = null, executionFailure = false, number = 1): ClusterWidening {
  return {
    clusterId: "d-1", attempt: number, recordId: `t/d-1/repair/${number}`, archive: `repair/d-1/attempt-${number}`, folder: `widening/d-1/attempt-${number}`,
    scope: { cases: ["build-alpha"], captures: ["skills"] }, targets: ["build-alpha/skills"], status, build: null, levels: [],
    rejection: stage === null ? null : { stage, reason: `${stage} failed`, executionFailure }, commit: status === "promoted" ? "c0ffee" : null,
  };
}

const limits = { maxAttempts: 2, budgetSpent: false };

test("a rejection by repair or by widening is followed by a next attempt unless it was an execution failure or a final widening stage", () => {
  for (const stage of ["model", "deadline", "patch", "build", "check"] as const) {
    deepStrictEqual(retryPlan({ "d-1": repair("rejected", attempt(1, stage, stage === "check" ? execution(1) : null)) }, {}, limits), { retry: ["d-1"], budget: [] }, stage);
  }
  for (const stage of ["build", "narrow", "character", "mode", "suite"] as const) {
    deepStrictEqual(retryPlan({ "d-1": repair("passed", attempt(1, null)) }, { "d-1": widening("rejected", stage) }, limits).retry, ["d-1"], stage);
  }
  const none = (repairs: Record<string, ClusterRepair>, widenings: Record<string, ClusterWidening> = {}) => deepStrictEqual(retryPlan(repairs, widenings, limits), { retry: [], budget: [] });
  none({ "d-1": repair("rejected", attempt(1, "check", execution(2))) });
  none({ "d-1": repair("rejected", attempt(1, "check", execution(1, false))) });
  none({ "d-1": repair("passed", attempt(1, null)) }, { "d-1": widening("rejected", "mode", true) });
  none({ "d-1": repair("passed", attempt(1, null)) }, { "d-1": widening("rejected", "apply") });
  none({ "d-1": repair("passed", attempt(1, null)) }, { "d-1": widening("rejected", "promote") });
  none({ "d-1": repair("passed", attempt(1, null)) }, { "d-1": widening("promoted") });
  none({ "d-1": repair("passed", attempt(1, null)) });
  none({ "d-1": repair("failed", attempt(1, "model")) });
  none({ "d-1": repair("budget_exhausted", null) });
  // The widening of an earlier attempt does not count for a later one.
  none({ "d-1": repair("passed", attempt(2, null), 1) }, { "d-1": widening("rejected", "mode", false, 1) });
});

test("the attempt limit and the run budget stop the next attempts", () => {
  const rejected = { "d-1": repair("rejected", attempt(2, "check", execution(1)), 1) };
  deepStrictEqual(retryPlan(rejected, {}, limits), { retry: [], budget: [] });
  deepStrictEqual(retryPlan(rejected, {}, { maxAttempts: 3, budgetSpent: false }), { retry: ["d-1"], budget: [] });
  deepStrictEqual(retryPlan(rejected, {}, { maxAttempts: 3, budgetSpent: true }), { retry: [], budget: ["d-1"] });
  const options = { repair: { deadlineMinutes: 60, maxAttempts: 3 }, agents: resolveAgentSettings({ runBudgetMinutes: 1 }) } as unknown as RunOptions;
  deepStrictEqual(retryLimits(options, 59_999), { maxAttempts: 3, budgetSpent: false });
  deepStrictEqual(retryLimits(options, 60_000), { maxAttempts: 3, budgetSpent: true });
  // A thread stored before the option existed has one attempt per cluster; a thread without repair has none to repeat.
  equal(retryLimits({ ...options, repair: { deadlineMinutes: 60 } }, 0).maxAttempts, 1);
  equal(retryLimits({ ...options, repair: null }, 0).maxAttempts, 1);
});

test("a next attempt sets the cluster pending with its latest attempt among the earlier ones and sets its widening aside", () => {
  const repairs = { "d-1": repair("passed", attempt(1, null)), "d-2": repair("rejected", attempt(1, "check", execution(1)), 0, "d-2") };
  const rejectedWidening = widening("rejected", "character");
  const next = nextAttempts(["d-1", "d-2"], repairs, { "d-1": rejectedWidening });
  deepStrictEqual(next.repairs["d-1"], {
    clusterId: "d-1", status: "pending", attempt: null,
    earlier: [{ attempt: 1, recordId: "t/d-1/repair/1", archive: "repair/d-1/attempt-1", rejectedBy: "widening", stage: "character", reason: "character failed" }],
  });
  deepStrictEqual(next.repairs["d-2"]!.earlier, [{ attempt: 1, recordId: "t/d-1/repair/1", archive: "repair/d-1/attempt-1", rejectedBy: "repair", stage: "check", reason: "check reason" }]);
  deepStrictEqual(next.widenings, { "d-1": null });
  deepStrictEqual(next.earlierWidenings, [rejectedWidening]);
  throws(() => nextAttempts(["d-1"], { "d-1": repair("passed", attempt(1, null)) }, {}), /no rejected attempt/);
  // A repair stored before earlier attempts were kept reads with none.
  const stored = { clusterId: "d-1", status: "rejected", attempt: attempt(1, "build"), waiting: null, records: [] } as unknown as ClusterRepair;
  equal(finishedAttempts(stored), 1);
  equal(latestRejection(stored, undefined)?.stage, "build");
  deepStrictEqual(nextAttempts(["d-1"], { "d-1": stored }, {}).repairs["d-1"]!.earlier!.map((item) => item.attempt), [1]);
  // A next attempt's update fills in what a stored repair lacks.
  deepStrictEqual(mergeRepairs({ "d-1": stored }, nextAttempts(["d-1"], { "d-1": stored }, {}).repairs)["d-1"]!.status, "pending");
});

const diagnosis = (status: ClusterDiagnosis["status"], extra: Partial<ClusterDiagnosis> = {}): ClusterDiagnosis => ({
  clusterId: "d-1", contextFolder: "c", contextHash: "h", status, hypothesis: null, challenge: null, waiting: null, failure: null, records: [], ...extra,
});

const check = (outcome: "confirmed" | "refuted" | "undecided") => ({ clusters: { "d-1": { outcome } } }) as unknown as CheckResult;

function end(input: Partial<DispositionInput>): Pick<ClusterEnd, "disposition" | "attempts" | "stage" | "commit"> {
  const result = clusterEnd("d-1", { clusters: {}, check: null, repairs: {}, widenings: {}, budgetBlocked: [], merges: null, ...input });
  return { disposition: result.disposition, attempts: result.attempts, stage: result.stage, commit: result.commit };
}

test("each cluster ends at the stage where its route stopped", () => {
  const challenged = { "d-1": diagnosis("challenged") };
  deepStrictEqual(end({}), { disposition: "not_diagnosed", attempts: 0, stage: null, commit: null });
  deepStrictEqual(end({ clusters: { "d-1": diagnosis("failed", { failure: { job: "challenge", kind: "refused", message: "no" } }) } }), { disposition: "diagnosis_failed", attempts: 0, stage: "challenge", commit: null });
  deepStrictEqual(end({ clusters: { "d-1": diagnosis("abstained") } }).disposition, "abstained");
  deepStrictEqual(end({ clusters: { "d-1": diagnosis("budget_exhausted") } }).disposition, "budget_exhausted");
  deepStrictEqual(end({ clusters: challenged, check: check("refuted") }).disposition, "refuted");
  deepStrictEqual(end({ clusters: challenged, check: check("undecided") }).disposition, "undecided");
  deepStrictEqual(end({ clusters: challenged }).disposition, "undecided");
  deepStrictEqual(end({ clusters: challenged, check: check("confirmed") }).disposition, "not_repaired");
  const confirmed = { clusters: challenged, check: check("confirmed") };
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("budget_exhausted", null) } }).disposition, "budget_exhausted");
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("failed", attempt(1, "model")) } }), { disposition: "repair_failed", attempts: 1, stage: "model", commit: null });
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("rejected", attempt(2, "check", execution(1)), 1) } }), { disposition: "repair_rejected", attempts: 2, stage: "check", commit: null });
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("rejected", attempt(2, "check", execution(1)), 1) }, budgetBlocked: ["d-1"] }), { disposition: "budget_exhausted", attempts: 2, stage: "check", commit: null });
  // A next attempt that was refused at the budget keeps the rejection it followed.
  const refused = clusterEnd("d-1", { clusters: challenged, check: check("confirmed"), repairs: { "d-1": repair("budget_exhausted", null, 1) }, widenings: {}, budgetBlocked: [], merges: null });
  deepStrictEqual([refused.disposition, refused.attempts, refused.stage, refused.reason], ["budget_exhausted", 1, "check", "the run budget was spent before a next attempt; r"]);
  // An attempt the budget stopped after some of its jobs finished keeps its own reason and the rejection it followed.
  const stopped = clusterEnd("d-1", { clusters: challenged, check: check("confirmed"), repairs: { "d-1": repair("budget_exhausted", { ...attempt(2, "model"), reason: "spent after 1 job" }, 1) }, widenings: {}, budgetBlocked: [], merges: null });
  deepStrictEqual([stopped.disposition, stopped.attempts, stopped.stage, stopped.reason], ["budget_exhausted", 2, "model", "spent after 1 job; the attempt it followed was rejected by repair at check: r"]);
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("passed", attempt(1, null)) } }).disposition, "not_widened");
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("passed", attempt(1, null)) }, widenings: { "d-1": widening("rejected", "suite") } }), { disposition: "widening_rejected", attempts: 1, stage: "suite", commit: null });
  deepStrictEqual(end({ ...confirmed, repairs: { "d-1": repair("passed", attempt(2, null), 1) }, widenings: { "d-1": widening("promoted", null, false, 2) } }), { disposition: "fixed", attempts: 2, stage: null, commit: "c0ffee" });
  // A promoted fix is fixed only when it merged; a thread stored before merging existed takes the promotion as fixed.
  const promoted = { ...confirmed, repairs: { "d-1": repair("passed", attempt(1, null)) }, widenings: { "d-1": widening("promoted") } };
  const merged = clusterEnd("d-1", { ...promoted, budgetBlocked: [], merges: { "d-1": { merged: true, mergeCommit: "m1", reason: null } } });
  deepStrictEqual([merged.disposition, merged.stage, merged.reason, merged.commit, merged.mergeCommit], ["fixed", null, null, "c0ffee", "m1"]);
  const failed = clusterEnd("d-1", { ...promoted, budgetBlocked: [], merges: { "d-1": { merged: false, mergeCommit: null, reason: "the rebase onto master conflicts in Chummer/frmCreate.cs" } } });
  deepStrictEqual([failed.disposition, failed.attempts, failed.stage, failed.reason, failed.commit, failed.mergeCommit], ["merge_failed", 1, "merge", "the rebase onto master conflicts in Chummer/frmCreate.cs", "c0ffee", null]);
  throws(() => clusterEnd("d-1", { ...promoted, budgetBlocked: [], merges: {} }), /promoted but not merged/);
  throws(() => end({ clusters: { "d-1": diagnosis("pending") } }), /is pending when the thread concludes/);
  throws(() => end({ ...confirmed, repairs: { "d-1": repair("pending", null) } }), /is pending when the thread concludes/);
  throws(() => end({ ...confirmed, repairs: { "d-1": repair("passed", attempt(1, null)) }, widenings: { "d-1": widening("verified") } }), /is verified when the thread concludes/);
});

test("a thread is verified for its scope only when every cluster is fixed and the scope had no problem", () => {
  const fixed = { clusterId: "d-1", disposition: "fixed", attempts: 1, stage: null, reason: null, commit: "c", mergeCommit: "m" } as const;
  const clean = { cases: [], otherFindings: 0 };
  equal(threadOutcome([], clean), "verified_for_scope");
  equal(threadOutcome([fixed], clean), "verified_for_scope");
  equal(threadOutcome([], { cases: [{ case: "build-alpha", capture: 2, compare: 0 }], otherFindings: 0 }), "findings_remaining");
  equal(threadOutcome([fixed], { cases: [], otherFindings: 1 }), "findings_remaining");
  equal(threadOutcome([fixed, { ...fixed, clusterId: "d-2", disposition: "refuted" }], clean), "findings_remaining");
  equal(threadOutcome([fixed, { ...fixed, clusterId: "d-2", disposition: "merge_failed", mergeCommit: null }], clean), "findings_remaining");
  equal(threadOutcome([{ ...fixed, disposition: "budget_exhausted" }, { ...fixed, clusterId: "d-2", disposition: "refuted" }], clean), "budget_exhausted");
  equal(threadOutcome([{ ...fixed, disposition: "budget_exhausted" }], { cases: [], otherFindings: 2 }), "budget_exhausted");
});

test("an execution failure of an earlier widening counts in the exit status", () => {
  const level = { level: "mode" as const, cases: ["build-gamma"], captures: null, run: execution(2), baseline: null, findings: [], outcome: "failed" as const, reason: "lost", executionFailure: true };
  const lost = { ...widening("rejected", "mode", true), levels: [level] };
  equal(exitStatus({ captures: {}, compares: {}, widenings: {}, earlierWidenings: [lost] }), 2);
  equal(exitStatus({ captures: {}, compares: {}, widenings: {}, earlierWidenings: [widening("rejected", "mode")] }), 0);
  equal(exitStatus({ captures: {}, compares: {}, widenings: { "d-1": lost } }), 2);
});