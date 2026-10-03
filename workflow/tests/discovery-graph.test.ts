import { deepStrictEqual, match, ok, strictEqual, throws } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentJob } from "../src/agents/agent-job.js";
import { recordCandidateSha256 } from "../src/diagnosis/candidate-source.js";
import { parseDiscoverArguments } from "../src/discovery/discover-arguments.js";
import type { DiscoveryDocument } from "../src/discovery/discovery-document.js";
import type { Plan } from "../src/discovery/job-schemas.js";
import { emptyRegistry, readRegistry, registryPaths, writeRegistry } from "../src/discovery/registry.js";
import { getRecord } from "../src/evals/eval-record.js";
import { SetupError } from "../src/host/setup-error.js";
import { baselineThread, discoveryHarness, discoveryRepository, fixtureCase, threadOf, type Reply } from "./discovery-harness.js";

const skills = "frmCreate/tabSkills";
const selection = "frmCreate.tabCharacterTabs#selection";
const act = (type: string, fields: Record<string, unknown> = {}) => ({ type, name: null, label: null, milliseconds: null, optional: null, ...fields });
const plan = (tab = "Skills"): Plan => ({
  case: fixtureCase, expect: [],
  actions: [act("capture", { name: "common" }), act("selectTab", { name: tab }), act("waitFor", { label: "Karma" }), act("capture", { name: "skills" })] as Plan["actions"],
});
const rankAnswer = (overrides: Record<string, unknown> = {}) => ({
  rankings: [
    { targetId: skills, score: 0.9, feasibility: "feasible", case: fixtureCase, reason: "Selecting the Skills tab shows it.", ...overrides },
    { targetId: selection, score: 0.5, feasibility: "uncertain", case: null, reason: "Two captures around a tab change." },
  ],
});

function replies(scenario: (job: AgentJob<unknown>, attempt: number) => Reply = () => ({ answer: { outcome: "plan", reason: "Select Skills.", plan: plan() } }), rank: Reply = { answer: rankAnswer() }) {
  return (job: AgentJob<unknown>, attempt: number): Reply => (job.kind === "rank" ? rank : scenario(job, attempt));
}

function documentOf(out: string, lines: readonly string[]): DiscoveryDocument {
  return JSON.parse(readFileSync(join(out, "out", "discovery", "threads", threadOf(lines), "discovery.json"), "utf8")) as DiscoveryDocument;
}

test("a proven scenario is admitted with its proofs, its records are labelled and coverage grows only by what its trees showed", async () => {
  const harness = await discoveryHarness(replies());
  strictEqual(await harness.run({ targets: 1 }), 0, harness.lines.join("\n"));
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual(document.targets.count, 2);
  deepStrictEqual(document.targets.selected, [skills]);
  const [scenario] = document.scenarios;
  deepStrictEqual([scenario!.outcome, scenario!.execution, scenario!.visual?.outcome, scenario!.admission], ["proven", "executed", "clear", "admitted"]);
  deepStrictEqual(scenario!.proofs, { controls: ["frmCreate.tabSkills", "frmCreate.lblKarma"], interactions: ["frmCreate.tabCharacterTabs.SelectedIndexChanged"] });
  match(scenario!.case!, /^build-Alpha@frmcreate-tabskills-[0-9a-f]{8}$/);
  deepStrictEqual(harness.capture.calls.map((call) => call.cases), [[scenario!.case]]);
  deepStrictEqual([document.coverage.before!.controls.observed + 2, document.coverage.before!.interactions.exercised + 1],
    [document.coverage.after!.controls.observed, document.coverage.after!.interactions.exercised]);
  deepStrictEqual([document.run!.status, document.run!.coverageValid, document.registry.before, document.registry.after], [0, true, 0, 1]);
  const registry = readRegistry(registryPaths(harness.root))!;
  deepStrictEqual(registry.entries.map((entry) => [entry.case, entry.target, entry.fixture, entry.provenance.records.length]), [[scenario!.case, skills, "../fixtures/characters/Alpha.chum", 2]]);
  const scenarioRecord = await getRecord(harness.store, "scenario", scenario!.record!);
  deepStrictEqual([scenarioRecord.labels.discovery?.outcome, scenarioRecord.labels.discovery?.differing, scenarioRecord.subject], ["proven", 0, { kind: "discovery-target", id: skills }]);
  deepStrictEqual((await getRecord(harness.store, "rank", document.rank.record!)).labels.discovery?.outcome, "proven");
  ok(harness.lines.some((line) => line.startsWith(`Scenario ${skills}: proven; case build-Alpha@`)), harness.lines.join("\n"));
  ok(harness.lines.some((line) => line.startsWith("Discovery: 2 targets, 1 selected, rank done; 1 proven; capture run")), harness.lines.join("\n"));
  match(harness.agents.calls[0]!.prompt, /^PROMPT_VERSION=rank-v1/);
  match(harness.agents.calls[1]!.prompt, /^PROMPT_VERSION=scenario-v1/);
});

test("two plans with the same fixture case and actions run side by side and the second is a duplicate", async () => {
  const harness = await discoveryHarness(replies((job) => ({ answer: { outcome: "plan", reason: "r", plan: { ...plan(), expect: job.label.endsWith(skills) ? ["lblKarma"] : ["tabCharacterTabs"] } } })));
  strictEqual(await harness.run(), 0, harness.lines.join("\n"));
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual(document.scenarios.map((item) => [item.targetId, item.outcome, item.admission]), [[skills, "proven", "admitted"], [selection, "proven", "duplicate"]]);
  deepStrictEqual(harness.capture.calls[0]!.cases.length, 2);
});

test("an invalid plan never reaches the lane and the rank is untested", async () => {
  const harness = await discoveryHarness(replies(() => ({ answer: { outcome: "plan", reason: "r", plan: plan("Skillz") } })));
  strictEqual(await harness.run({ targets: 1 }), 0);
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([document.scenarios[0]!.outcome, document.scenarios[0]!.validation], ["invalid-plan", ["action 2 (selectTab): 'Skillz' is not a known tab text of frmCreate"]]);
  deepStrictEqual([harness.capture.calls.length, document.run], [0, null]);
  deepStrictEqual((await getRecord(harness.store, "rank", document.rank.record!)).labels.discovery?.outcome, "untested");
  strictEqual(existsSync(registryPaths(harness.root).registry), false);
});

test("an abstention is labelled and changes nothing", async () => {
  const harness = await discoveryHarness(replies(() => ({ answer: { outcome: "abstain", reason: "The page needs a selected row.", plan: null } })));
  strictEqual(await harness.run({ targets: 1 }), 0);
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([document.scenarios[0]!.outcome, document.scenarios[0]!.reason, harness.capture.calls.length], ["abstained", "The page needs a selected row.", 0]);
});

test("a rank answer that leaves a target out fails the rank job and no scenario job runs", async () => {
  const harness = await discoveryHarness(replies(undefined, { answer: { rankings: rankAnswer().rankings.slice(0, 1) } }));
  strictEqual(await harness.run(), 2);
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([document.rank.status, document.scenarios.length, harness.agents.calls.length], ["failed", 0, 1]);
  match(JSON.stringify(document.rank.failure), /targets not ranked: frmCreate\.tabCharacterTabs#selection/);
});

test("an infeasible target is not selected", async () => {
  const harness = await discoveryHarness(replies(undefined, { answer: rankAnswer({ feasibility: "infeasible" }) }));
  strictEqual(await harness.run({ targets: 1 }), 0);
  deepStrictEqual(documentOf(harness.out, harness.lines).targets.selected, [selection]);
});

test("a usage limit is waited out and the job runs again with both attempts recorded", async () => {
  const harness = await discoveryHarness(replies((_, attempt) => (attempt === 1
    ? { failure: { kind: "quota_exhausted", message: "You've hit your usage limit." } }
    : { answer: { outcome: "plan", reason: "r", plan: plan() } })));
  strictEqual(await harness.run({ targets: 1 }), 0);
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([harness.waits, document.scenarios[0]!.records.length, document.scenarios[0]!.outcome], [[60_000], 2, "proven"]);
});

test("a spent run budget leaves the scenario jobs unstarted", async () => {
  const harness = await discoveryHarness(replies(undefined, { answer: rankAnswer(), durationMs: 120_000 }), undefined, { budgetMinutes: 1 });
  strictEqual(await harness.run({ targets: 1 }), 0);
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([document.scenarios[0]!.status, document.scenarios[0]!.records.length, harness.capture.calls.length], ["budget_exhausted", 0, 0]);
});

test("a differing capture of a proven scenario is admitted as a finding and the exit status is 1", async () => {
  // The fake marks the rows it is told: a first thread names the generated case.
  const probe = await discoveryHarness(replies());
  await probe.run({ targets: 1 });
  const caseName = documentOf(probe.out, probe.lines).scenarios[0]!.case!;
  const finding = await discoveryHarness(replies(), undefined, { capture: { differing: [`${caseName}/skills`] } });
  strictEqual(await finding.run({ targets: 1 }), 1, finding.lines.join("\n"));
  const document = documentOf(finding.out, finding.lines);
  deepStrictEqual([document.scenarios[0]!.visual, document.scenarios[0]!.admission], [{ outcome: "finding", differing: ["skills"] }, "admitted"]);
  deepStrictEqual(readRegistry(registryPaths(finding.root))!.entries[0]!.visual, { outcome: "finding", differing: ["skills"] });
  deepStrictEqual((await getRecord(finding.store, "scenario", document.scenarios[0]!.record!)).labels.discovery?.differing, 1);
});

test("a failed action is an execution failure: no proof, no admission, exit status 2", async () => {
  const probe = await discoveryHarness(replies());
  await probe.run({ targets: 1 });
  const caseName = documentOf(probe.out, probe.lines).scenarios[0]!.case!;
  const harness = await discoveryHarness(replies(), undefined, { capture: { failed: caseName } });
  strictEqual(await harness.run({ targets: 1 }), 2);
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([document.scenarios[0]!.outcome, document.scenarios[0]!.admission, document.run!.coverageValid], ["execution-failed", "not-admitted", false]);
  strictEqual(existsSync(registryPaths(harness.root).registry), false);
  deepStrictEqual(document.coverage.after, document.coverage.before);
});

test("a thread stopped by a setup error resumes without running its finished jobs again", async () => {
  const harness = await discoveryHarness(replies(), undefined, { capture: { error: new SetupError("the desktop lane is gone") } });
  strictEqual(await harness.run({ targets: 1 }), 3);
  ok(harness.lines.some((line) => line.includes("the desktop lane is gone")));
  strictEqual(await harness.resume(threadOf(harness.lines)), 0, harness.lines.join("\n"));
  deepStrictEqual(harness.agents.calls.map((call) => call.kind), ["rank", "scenario"]);
  strictEqual(harness.capture.calls.length, 2);
  strictEqual(await harness.resume(threadOf(harness.lines)), 3);
  ok(harness.lines.some((line) => line.includes("already finished")));
});

test("targets the registry proved for this source are covered, and a thread without targets runs no job", async () => {
  const repository = await discoveryRepository();
  const manifest = JSON.parse(readFileSync(join(repository.paths.threadFolder(baselineThread), "inventory", "coverage-manifest.json"), "utf8")) as { sourceSha256: string };
  const entry = (await (async () => {
    const probe = await discoveryHarness(replies());
    await probe.run({ targets: 1 });
    return readRegistry(registryPaths(probe.root))!.entries[0]!;
  })());
  writeRegistry(registryPaths(repository.root), { ...emptyRegistry({ startupDelaySeconds: 3, settleMilliseconds: 300 }), entries: [{ ...entry, sourceSha256: manifest.sourceSha256 }] });
  const harness = await discoveryHarness(replies(), undefined, { repository });
  strictEqual(await harness.run(), 0, harness.lines.join("\n"));
  const document = documentOf(harness.out, harness.lines);
  deepStrictEqual([document.targets.count, harness.agents.calls.length, document.rank.status], [0, 0, "pending"]);
});

test("the baseline guards: changed designer files, another candidate and a hand-edited registry case file are setup errors", async () => {
  const changed = await discoveryRepository();
  writeFileSync(join(changed.root, "Chummer", "frmCreate.cs"), `${readFileSync(join(changed.root, "Chummer", "frmCreate.cs"), "utf8")}// changed\n`);
  const first = await discoveryHarness(replies(), undefined, { repository: changed });
  strictEqual(await first.run(), 3);
  ok(first.lines.some((line) => /differ(s)? from the (baseline's|source the candidate was built from)/.test(line)), first.lines.join("\n"));

  const other = await discoveryRepository();
  recordCandidateSha256(other.paths, "d".repeat(64));
  const second = await discoveryHarness(replies(), undefined, { repository: other });
  strictEqual(await second.run(), 3);
  ok(second.lines.some((line) => line.includes("not the built one")), second.lines.join("\n"));

  const edited = await discoveryRepository();
  writeRegistry(registryPaths(edited.root), emptyRegistry({ startupDelaySeconds: 3, settleMilliseconds: 300 }));
  writeFileSync(registryPaths(edited.root).caseFile, "{}");
  const third = await discoveryHarness(replies(), undefined, { repository: edited });
  strictEqual(await third.run(), 3);
  ok(third.lines.some((line) => line.includes("differs from the rendering")), third.lines.join("\n"));
  deepStrictEqual([first.agents.calls.length, second.agents.calls.length, third.agents.calls.length], [0, 0, 0]);
});

test("the command line is parsed strictly", () => {
  deepStrictEqual(parseDiscoverArguments(["--from", "wf-1", "--targets", "5", "--live-canonical", "--unattended"]), {
    kind: "start", arguments: { from: "wf-1", targets: 5, caseFile: null, settingsOverlay: null, threshold: null, canonicalCache: null, liveCanonical: true, unattended: true },
  });
  deepStrictEqual(parseDiscoverArguments(["--resume", "disc-1"]), { kind: "resume", threadId: "disc-1" });
  deepStrictEqual(parseDiscoverArguments(["--help"]), { kind: "help" });
  throws(() => parseDiscoverArguments(["--from", "t", "--targets", "0"]), /--targets must be a whole number from 1 to 10, got '0'/);
  throws(() => parseDiscoverArguments(["--targets", "2"]), /needs --from/);
  throws(() => parseDiscoverArguments(["--from", "t", "--case", "x"]), /Unknown option '--case'/);
  throws(() => parseDiscoverArguments(["--from", "t", "--live-canonical", "--canonical-cache", "c"]), /contradict/);
  throws(() => parseDiscoverArguments(["--resume", "d", "--from", "t"]), /takes no other options/);
  throws(() => parseDiscoverArguments(["--from", "a", "--from", "b"]), /Option '--from' is given twice/);
  throws(() => parseDiscoverArguments(["--resume"]), /Option '--resume' needs a value/);
});
