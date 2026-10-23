import { deepStrictEqual, equal, match, ok, strictEqual, throws } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { resolveDiscoveryOptions } from "../src/discovery/discover-arguments.js";
import { certificatePath, certificateProblems } from "../src/evals/certificate.js";
import { getRecord } from "../src/evals/eval-record.js";
import { SetupError } from "../src/host/setup-error.js";
import { parseArguments } from "../src/options/arguments.js";
import { resolveRunOptions } from "../src/options/run-options.js";
import { readDispatchedTuning, tuningFiles, writeActiveFile } from "../src/tuning/active-configuration.js";
import { tuningId, type Tuning } from "../src/tuning/tuning.js";
import { scratch } from "./diagnosis-fixtures.js";
import { diagnosisHarness } from "./diagnosis-harness.js";
import { discoveryHarness, threadOf } from "./discovery-harness.js";
import { tuning } from "./tuning-fixtures.js";

function activate(folder: string, configuration: Tuning): void {
  writeActiveFile(folder, {
    schemaVersion: 1, jobKind: configuration.jobKind, active: { tuning: configuration, activatedUtc: "2026-10-10T00:00:00.000Z", evidence: null, certificate: null },
    history: [{ tuning: null, activatedUtc: null, evidence: null, certificate: null }], rolledBack: [],
  });
}

const start = (args: string[]) => {
  const command = parseArguments(args);
  if (command.kind !== "start") throw new Error("not a start");
  return command.arguments;
};

const discover = { from: "wf-1", targets: 1, caseFile: null, settingsOverlay: null, threshold: null, canonicalCache: null, liveCanonical: true, unattended: false };

test("a new thread stores the active configurations of the job kinds it dispatches; none without a folder", () => {
  const root = scratch();
  const folder = join(root, "tuning");
  activate(folder, tuning({ jobKind: "hypothesis" }));
  activate(folder, tuning({ jobKind: "scenario" }));
  deepStrictEqual(resolveRunOptions(start([]), { tuning: folder }, { LOCALAPPDATA: root }, root).tuning, { hypothesis: tuning({ jobKind: "hypothesis" }) });
  deepStrictEqual(resolveRunOptions(start(["--no-diagnosis"]), { tuning: folder }, { LOCALAPPDATA: root }, root).tuning, {});
  deepStrictEqual(resolveRunOptions(start([]), {}, { LOCALAPPDATA: root }, root).tuning, {});
  deepStrictEqual(resolveDiscoveryOptions(discover, { tuning: folder }, { LOCALAPPDATA: root }, root).tuning, { scenario: tuning({ jobKind: "scenario" }) });
});

test("a stale configuration of a job kind a thread does not dispatch does not stop it", () => {
  const root = scratch();
  const folder = join(root, "tuning");
  activate(folder, tuning({ jobKind: "hypothesis", basePromptVersion: "hypothesis-v1" }));
  deepStrictEqual(resolveDiscoveryOptions(discover, { tuning: folder }, { LOCALAPPDATA: root }, root).tuning, {});
  throws(() => resolveRunOptions(start([]), { tuning: folder }, { LOCALAPPDATA: root }, root), /extends hypothesis-v1/);
  throws(() => resolveRunOptions(start(["--only", "diagnose"]), { tuning: folder }, { LOCALAPPDATA: root }, root), /extends hypothesis-v1/);
  deepStrictEqual(resolveRunOptions(start(["--only", "capture"]), { tuning: folder }, { LOCALAPPDATA: root }, root).tuning, {});
  deepStrictEqual(resolveRunOptions(start(["--only", "triage"]), { tuning: folder }, { LOCALAPPDATA: root }, root).tuning, {});
});

test("a stale or invalid active file stops a thread from starting", () => {
  const folder = join(scratch(), "tuning");
  activate(folder, tuning({ jobKind: "rank", basePromptVersion: "rank-v1" }));
  throws(() => readDispatchedTuning(folder, ["rank"]), (error: Error) => error instanceof SetupError && /active[\\/]rank\.json: .*extends rank-v1, but the code's rank prompt is rank-v2/.test(error.message));
  const other = join(scratch(), "tuning");
  mkdirSync(join(other, "active"), { recursive: true });
  writeFileSync(tuningFiles(other).active("scenario"), JSON.stringify({ schemaVersion: 1, jobKind: "rank", active: { tuning: null, activatedUtc: null, evidence: null, certificate: null }, history: [], rolledBack: [] }));
  throws(() => readDispatchedTuning(other, ["scenario"]), (error: Error) => error instanceof SetupError && /is for rank/.test(error.message));
  writeFileSync(tuningFiles(other).active("scenario"), "{");
  throws(() => readDispatchedTuning(other, ["scenario"]), (error: Error) => error instanceof SetupError && /cannot be read/.test(error.message));
});

test("diagnosis prompts and records the hypothesis with its active configuration and the challenge with the code's prompt", async () => {
  const configuration = tuning({ jobKind: "hypothesis" });
  const harness = diagnosisHarness({ spots: [{ case: "build-alpha", capture: "skills", x: 100 }], tuning: { hypothesis: configuration } });
  await harness.start({ noRepair: true });
  const version = `hypothesis-v2+${tuningId(configuration)}`;
  ok(harness.agents.calls.find((call) => call.kind === "hypothesis")!.prompt.startsWith(`PROMPT_VERSION=${version}\n`));
  ok(harness.agents.calls.find((call) => call.kind === "challenge")!.prompt.startsWith("PROMPT_VERSION=challenge-v2\n"));
  const threadId = harness.threadId();
  equal((await getRecord(harness.store, "hypothesis", `${threadId}/d-0000000000000100/hypothesis/1`)).promptVersion, version);
  equal((await getRecord(harness.store, "challenge", `${threadId}/d-0000000000000100/challenge/1`)).promptVersion, "challenge-v2");
  deepStrictEqual((await harness.state(threadId)).options.tuning, { hypothesis: configuration });
});

test("a thread whose stored configuration went stale stops at its job with a setup error", async () => {
  const harness = diagnosisHarness({ spots: [{ case: "build-alpha", capture: "skills", x: 100 }], tuning: { hypothesis: tuning({ jobKind: "hypothesis", basePromptVersion: "hypothesis-v1" }) } });
  strictEqual(await harness.start({ noRepair: true }), 3);
  ok(harness.lines.some((line) => /The thread's hypothesis configuration: .*extends hypothesis-v1/.test(line)), harness.lines.join("\n"));
  strictEqual(harness.agents.calls.length, 0);
});

test("discovery prompts and records the scenario job with its active configuration", async () => {
  const configuration = tuning();
  const harness = await discoveryHarness((job) => (job.kind === "rank"
    ? { answer: { rankings: [{ targetId: "frmCreate/tabSkills", score: 0.9, feasibility: "feasible", case: "build-Alpha", reason: "r" }, { targetId: "frmCreate.tabCharacterTabs#selection", score: 0.1, feasibility: "infeasible", case: null, reason: "r" }] } }
    : { answer: { outcome: "abstain", reason: "No plan.", plan: null } }), undefined, { tuning: { scenario: configuration } });
  await harness.run({ targets: 1 });
  match(harness.agents.calls[0]!.prompt, /^PROMPT_VERSION=rank-v2\n/);
  const version = `scenario-v1+${tuningId(configuration)}`;
  ok(harness.agents.calls[1]!.prompt.startsWith(`PROMPT_VERSION=${version}\n`), harness.agents.calls[1]!.prompt.slice(0, 80));
  const threadId = threadOf(harness.lines);
  equal((await getRecord(harness.store, "scenario", `${threadId}/frmCreate/tabSkills/scenario/1`)).promptVersion, version);
});

test("an unattended run needs certificates for the prompt versions it dispatches", () => {
  const folder = scratch();
  const settings = resolveAgentSettings({});
  const configuration = tuning({ jobKind: "hypothesis" });
  writeFileSync(certificatePath(folder, "hypothesis"), JSON.stringify({
    schemaVersion: 1, jobKind: "hypothesis", agent: { provider: "claude", model: null, effort: "medium" }, promptVersion: "hypothesis-v2", run: "er-1",
    dataset: { name: "d", version: 1, hash: "h", partition: "test" }, metric: "prediction", items: 10, passes: 10, rate: 1, interval: { low: 0.7, high: 1 },
    thresholds: { minPass: 0.5, maxMeanCostUsd: null }, meanCostUsd: null, issuedUtc: "2026-10-10T00:00:00.000Z",
  }));
  deepStrictEqual(certificateProblems(folder, ["hypothesis"], settings), []);
  deepStrictEqual(certificateProblems(folder, ["hypothesis"], settings, { hypothesis: configuration }),
    [`hypothesis: the certificate is for prompt version hypothesis-v2, the run uses hypothesis-v2+${tuningId(configuration)}`]);
});
