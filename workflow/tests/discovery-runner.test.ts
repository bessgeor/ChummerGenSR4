import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import type { AgentJob } from "../src/agents/agent-job.js";
import type { Plan } from "../src/discovery/job-schemas.js";
import { SetupError } from "../src/host/setup-error.js";
import { baselineThread, discoveryHarness, fixtureCase, type Harness, type Reply } from "./discovery-harness.js";

const act = (type: string, fields: Record<string, unknown> = {}) => ({ type, name: null, label: null, milliseconds: null, optional: null, ...fields });
const plan: Plan = {
  case: fixtureCase, expect: [],
  actions: [act("capture", { name: "common" }), act("selectTab", { name: "Skills" }), act("waitFor", { label: "Karma" }), act("capture", { name: "skills" })] as Plan["actions"],
};
const reply = (job: AgentJob<unknown>): Reply => job.kind === "rank"
  ? { answer: { rankings: [
    { targetId: "frmCreate/tabSkills", score: 0.9, feasibility: "feasible", case: fixtureCase, reason: "Selecting the Skills tab shows it." },
    { targetId: "frmCreate.tabCharacterTabs#selection", score: 0.5, feasibility: "uncertain", case: null, reason: "Two captures around a tab change." },
  ] } }
  : { answer: { outcome: "plan", reason: "Select Skills.", plan } };

const threadId = "disc-wf-runner";
const options = (harness: Harness) => harness.resolveOptions({
  from: baselineThread, targets: 1, caseFile: null, settingsOverlay: null, threshold: null, canonicalCache: null, liveCanonical: true, unattended: false,
});
const isSetupError = (message: RegExp) => (error: unknown) => error instanceof SetupError && message.test(error.message);

test("start runs a new thread to its conclusion and refuses an ID that already has a thread", async () => {
  const harness = await discoveryHarness(reply);
  deepStrictEqual(await harness.runner.thread(threadId), { kind: "absent" });
  const concluded = await harness.runner.start(threadId, options(harness));
  strictEqual(concluded.exitStatus, 0, concluded.lines.join("\n"));
  ok(existsSync(concluded.path), concluded.path);
  ok(concluded.lines.some((line) => line.startsWith("Discovery: ")), concluded.lines.join("\n"));
  const found = await harness.runner.thread(threadId);
  deepStrictEqual([found.kind, found.kind === "finished" ? found.concluded : null, found.kind === "absent" ? null : found.options], ["finished", concluded, options(harness)]);
  deepStrictEqual(harness.agents.calls.map((call) => call.kind), ["rank", "scenario"]);
  await rejects(harness.runner.start(threadId, options(harness)), isSetupError(new RegExp(`^Discovery thread ${threadId} already exists; resume it instead\\.$`)));
  deepStrictEqual([harness.agents.calls.length, harness.capture.calls.length], [2, 1]);
});

test("resume continues an unfinished thread without running its finished jobs again and refuses a finished or absent thread", async () => {
  const harness = await discoveryHarness(reply, undefined, { capture: { error: new SetupError("the desktop lane is gone") } });
  await rejects(harness.runner.start(threadId, options(harness)), isSetupError(/^the desktop lane is gone$/));
  const stopped = await harness.runner.thread(threadId);
  deepStrictEqual([stopped.kind, stopped.kind === "absent" ? null : stopped.options], ["unfinished", options(harness)]);
  await rejects(harness.runner.read(threadId), isSetupError(new RegExp(`^Discovery thread ${threadId} has not finished; resume it instead\\.$`)));
  const concluded = await harness.runner.resume(threadId);
  strictEqual(concluded.exitStatus, 0, concluded.lines.join("\n"));
  deepStrictEqual(harness.agents.calls.map((call) => call.kind), ["rank", "scenario"]);
  strictEqual(harness.capture.calls.length, 2);
  strictEqual((await harness.runner.thread(threadId)).kind, "finished");
  await rejects(harness.runner.resume(threadId), isSetupError(new RegExp(`^Discovery thread ${threadId} already finished; start a new one instead\\.$`)));
  await rejects(harness.runner.resume("disc-wf-none"), isSetupError(/^There is no discovery thread disc-wf-none to resume\.$/));
  strictEqual(harness.capture.calls.length, 2);
});

test("read returns a finished thread's conclusion without running anything and refuses an absent thread", async () => {
  const harness = await discoveryHarness(reply);
  await rejects(harness.runner.read(threadId), isSetupError(new RegExp(`^There is no discovery thread ${threadId} to read\\.$`)));
  const concluded = await harness.runner.start(threadId, options(harness));
  const calls = [harness.agents.calls.length, harness.capture.calls.length];
  const records = await harness.store.search(["eval-record"], { limit: 1000 });
  strictEqual(records.length, 2);
  deepStrictEqual(await harness.runner.read(threadId), concluded);
  deepStrictEqual(await harness.runner.read(threadId), concluded);
  deepStrictEqual([harness.agents.calls.length, harness.capture.calls.length], calls);
  deepStrictEqual(await harness.store.search(["eval-record"], { limit: 1000 }), records);
});
