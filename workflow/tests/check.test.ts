import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CaptureResults } from "../../contracts/generated/typescript/parity-capture-results.js";
import { judge, observe, planCheck, type ObservedCapture } from "../src/diagnosis/check.js";
import { hostCheckCapture } from "../src/diagnosis/check-capture.js";
import type { ClusterDiagnosis } from "../src/diagnosis/cluster-diagnosis.js";
import type { DiagnosisDocument } from "../src/diagnosis/diagnosis-document.js";
import type { ChallengeOutput, HypothesisOutput } from "../src/diagnosis/job-schemas.js";
import { EvalRecordSchema, recordNamespace } from "../src/evals/eval-record.js";
import type { HostCommand, HostRunner } from "../src/host/host-runner.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import { parseArguments, type Arguments } from "../src/options/arguments.js";
import { resolveRunOptions } from "../src/options/run-options.js";
import { workflowPaths } from "../src/paths.js";
import { captureArguments } from "../src/steps/capture-step.js";
import { scratch } from "./diagnosis-fixtures.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters } from "./diagnosis-harness.js";

function cluster(id: string, hypothesis: HypothesisOutput, challenge: ChallengeOutput | null, status: ClusterDiagnosis["status"] = "challenged"): ClusterDiagnosis {
  const answer = <T>(output: T, kind: string) => ({ recordId: `t/${id}/${kind}/1`, provider: "claude" as const, model: null, effort: "medium" as const, output });
  return {
    clusterId: id, contextFolder: "f", contextHash: "h", status, waiting: null, failure: null, records: [],
    hypothesis: answer(hypothesis, "hypothesis"), challenge: challenge === null ? null : answer(challenge, "challenge"),
  };
}

const seen = (pairs: [string, ObservedCapture["observation"]][]): ObservedCapture[] =>
  pairs.map(([key, observation]) => ({ case: key.split("/")[0]!, capture: key.split("/")[1]!, observation, detail: "" }));

test("the check plan is the union of every challenged cluster's predicted cases and captures", () => {
  const other = hypothesisAnswer("Another cause.");
  other.explanation!.predictions = [{ case: "build-gamma", capture: "armor", expect: "differs", why: "w" }];
  const plan = planCheck({
    a: cluster("a", hypothesisAnswer(), challengeAnswer()),
    b: cluster("b", other, { outcome: "no_alternative", reason: "r", alternative: null }),
    c: cluster("c", other, null, "failed"),
  });
  deepStrictEqual(plan, {
    cases: ["build-alpha", "career-beta", "build-gamma"], captures: ["skills", "common", "armor"], checked: ["a", "b"],
    predicted: [{ case: "build-alpha", capture: "skills" }, { case: "career-beta", capture: "common" }, { case: "build-gamma", capture: "armor" }],
  });
  equal(planCheck({ c: cluster("c", other, null, "abstained") }), null);
});

test("observations: a pass matches, a visual difference differs, a missing side or row is not observed", () => {
  const results: CaptureResults = {
    runId: "r", threshold: 0.1, results: [
      { case: "a", characterFile: "a.chum", mode: "build", capture: "x", passed: true, reason: "within-threshold", difference: 0 },
      { case: "a", characterFile: "a.chum", mode: "build", capture: "y", passed: false, reason: "visual-difference", difference: 0.2 },
      { case: "a", characterFile: "a.chum", mode: "build", capture: "z", passed: false, reason: "missing-candidate", difference: 1 },
    ],
  };
  deepStrictEqual(["x", "y", "z", "w"].map((capture) => observe(results, "a", capture).observation), ["matches", "differs", "not-observed", "not-observed"]);
  equal(observe(results, "a", "z").detail, "missing-candidate");
});

test("a cluster is confirmed, refuted or undecided by its predictions", () => {
  const both = cluster("a", hypothesisAnswer(), challengeAnswer());
  equal(judge(both, seen([["build-alpha/skills", "differs"], ["career-beta/common", "matches"]])).outcome, "confirmed");
  equal(judge(both, seen([["build-alpha/skills", "matches"], ["career-beta/common", "matches"]])).outcome, "refuted");
  equal(judge(both, seen([["build-alpha/skills", "differs"], ["career-beta/common", "not-observed"]])).outcome, "undecided");
  const alone = cluster("b", hypothesisAnswer(), { outcome: "no_alternative", reason: "r", alternative: null });
  const checked = judge(alone, seen([["build-alpha/skills", "differs"], ["career-beta/common", "matches"]]));
  equal(checked.outcome, "confirmed");
  equal(checked.alternative, null);
  deepStrictEqual(checked.hypothesis.map((item) => [item.observed, item.held]), [["differs", true], ["matches", true]]);
  // An alternative whose predictions all hold as well leaves the two undistinguished.
  const agreeing = cluster("c", hypothesisAnswer(), {
    ...challengeAnswer(), alternative: { ...challengeAnswer().alternative!, predictions: [{ case: "career-beta", capture: "common", expect: "differs", why: "w" }] },
  });
  equal(judge(agreeing, seen([["build-alpha/skills", "differs"], ["career-beta/common", "matches"]])).outcome, "confirmed");
  equal(judge(agreeing, seen([["build-alpha/skills", "differs"], ["career-beta/common", "differs"]])).outcome, "refuted");
});

test("two clusters are checked in one capture with the union of cases and captures; records get the label", async () => {
  const spots = [{ case: "build-alpha", capture: "skills", x: 100 }, { case: "career-beta", capture: "common", x: 400 }];
  const agents = new FakeAgents((call) => {
    if (call.kind === "challenge") return { answer: challengeAnswer() };
    const answer = hypothesisAnswer();
    if (call.cluster.endsWith("400")) answer.explanation!.predictions = [{ case: "career-beta", capture: "armor", expect: "differs", why: "w" }, { case: "career-beta", capture: "common", expect: "matches", why: "w" }];
    return { answer };
  });
  const harness = diagnosisHarness({ spots, agents, observed: { "build-alpha/skills": "failed", "career-beta/common": "passed", "career-beta/armor": "passed" } });
  equal(await harness.start(), 1);
  equal(harness.checks.length, 1);
  deepStrictEqual([harness.checks[0]!.cases, harness.checks[0]!.captures], [["build-alpha", "career-beta"], ["skills", "common", "armor"]]);
  const state = await harness.state(harness.threadId());
  deepStrictEqual(Object.fromEntries(Object.entries(state.diagnosisCheck!.clusters).map(([id, item]) => [id, item.outcome])),
    { "d-0000000000000100": "confirmed", "d-0000000000000400": "refuted" });
  for (const [kind, id] of [["hypothesis", "d-0000000000000400"], ["challenge", "d-0000000000000400"]] as const) {
    const record = EvalRecordSchema.parse((await harness.store.get(recordNamespace(kind), `${harness.threadId()}/${id}/${kind}/1`))!.value);
    equal(record.labels.check, "refuted");
  }
  const document = JSON.parse(readFileSync(state.diagnosisPath!, "utf8")) as DiagnosisDocument;
  deepStrictEqual([document.totals.clusters, document.totals.confirmed, document.totals.refuted, document.totals.undecided], [2, 1, 1, 0]);
  equal(document.clusters[0]!.check?.outcome, "confirmed");
  equal(document.check?.runFolder, state.diagnosisCheck!.runFolder);
  ok(harness.lines.some((line) => /^Diagnosis d-0000000000000100: hypothesis \(claude default\/medium\): .*; challenge \(codex default\/medium\): alternative: .*; check confirmed; 2 records$/.test(line)));
  ok(harness.lines.some((line) => /^Diagnosis check: execution: capture status 1, coverage valid, \d+ failures; run folder /.test(line)));
  ok(harness.lines.some((line) => line === "Diagnosis check: observations: build-alpha/skills differs, career-beta/common matches, career-beta/armor matches"));
});

test("a check run with execution failures leaves predictions not observed, is reported apart and gives status 2", async () => {
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], observed: { "build-alpha/skills": "failed", "career-beta/common": "missing" }, checkStatus: 2 });
  equal(await harness.start(), 2);
  const check = (await harness.state(harness.threadId())).diagnosisCheck!;
  deepStrictEqual(check.execution, { status: 2, coverageValid: false, invalidReasons: ["an action failed"], failures: check.execution.failures });
  equal(Object.values(check.clusters)[0]!.outcome, "undecided");
  ok(harness.lines.some((line) => /capture status 2, coverage INVALID: an action failed/.test(line)));
});

test("no check capture runs when no cluster has predictions; diagnosis.json is still written", async () => {
  const agents = new FakeAgents(() => ({ answer: { outcome: "abstain", reason: "nothing to see", explanation: null } }));
  const harness = diagnosisHarness({ spots: twoClusters, agents });
  equal(await harness.start(), 1);
  equal(harness.checks.length, 0);
  const state = await harness.state(harness.threadId());
  equal(state.diagnosisCheck, null);
  const document = JSON.parse(readFileSync(state.diagnosisPath!, "utf8")) as DiagnosisDocument;
  deepStrictEqual([document.totals.abstained, document.check], [2, null]);
  ok(harness.lines.some((line) => /hypothesis \(claude default\/medium\) abstained: nothing to see/.test(line)));
});

test("a failed cluster makes the exit status 2 and is reported with its failure", async () => {
  const agents = new FakeAgents((call) => (call.kind === "hypothesis" ? { failure: { kind: "refused", message: "The model refused." } } : { answer: challengeAnswer() }));
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents });
  equal(await harness.start(), 2);
  ok(harness.lines.some((line) => /FAILED: hypothesis refused: The model refused\./.test(line)));
});

test("the check capture is one capture runner call on the desktop lane with the thread's options", async () => {
  const root = scratch();
  const runFolder = join(root, "run");
  const commands: HostCommand[] = [];
  const host: HostRunner = {
    lanes: ["desktop"],
    async run(command) {
      commands.push(command);
      mkdirSync(runFolder, { recursive: true });
      for (const file of ["summary.json", "results.json", "coverage.json"]) writeFileSync(join(runFolder, file), "{}");
      writeFileSync(command.args[command.args.indexOf("--run-folder-file") + 1]!, runFolder);
      return 1;
    },
  };
  const paths = workflowPaths(root);
  const capture = hostCheckCapture(paths, host, createScratchFolder);
  const options = { ...resolveRunOptions(parsed(["--threshold", "0.001", "--settings-overlay", "o", "--canonical-cache", "c"]), {}, { LOCALAPPDATA: root }, root) };
  deepStrictEqual(await capture({ cases: ["build-a", "career-b"], captures: ["skills", "common"], options }), { status: 1, runFolder });
  const command = commands[0]!;
  deepStrictEqual([command.resource, command.command, command.label], ["desktop", "dotnet", "diagnosis check capture"]);
  const value = (flag: string) => command.args[command.args.indexOf(flag) + 1];
  deepStrictEqual([value("--case"), value("--capture"), value("--case-file"), value("--threshold"), value("--settings-overlay"), value("--canonical-cache")],
    ["build-a,career-b", "skills,common", options.caseFile, "0.001", join(root, "o"), join(root, "c")]);
  ok(command.args[0]!.endsWith("Parity.Capture.dll"));
  // The same arguments the capture step builds, so an option added there reaches the check too.
  deepStrictEqual(command.args, captureArguments(paths, options, { cases: ["build-a", "career-b"], captures: ["skills", "common"] }, value("--run-folder-file")!));
  ok(!captureArguments(paths, options, { cases: ["build-a"], captures: null }, "f").includes("--capture"));
  // Only the thread's own captures record UI trees, for the inventory; a check does not.
  ok(!command.args.includes("--ui-tree"));
  // The thread's candidate unless another executable is named.
  ok(!command.args.includes("--candidate-exe"));
  const attempt = captureArguments(paths, options, { cases: ["build-a"], captures: ["skills"] }, "f", "C:/attempt/build/bin/ChummerGenSR4.exe");
  equal(attempt[attempt.indexOf("--candidate-exe") + 1], "C:/attempt/build/bin/ChummerGenSR4.exe");
  const failing = hostCheckCapture(paths, { lanes: ["desktop"], run: async () => 3 }, createScratchFolder);
  await rejects(failing({ cases: ["a"], captures: ["x"], options }), (error: Error) => error instanceof SetupError && /exited with 3/.test(error.message));
  const silent = hostCheckCapture(paths, { lanes: ["desktop"], run: async () => 0 }, createScratchFolder);
  await rejects(silent({ cases: ["a"], captures: ["x"], options }), /did not report its run folder/);
});

function parsed(args: string[]): Arguments {
  const command = parseArguments(args);
  if (command.kind !== "start") throw new Error("expected start");
  return command.arguments;
}
