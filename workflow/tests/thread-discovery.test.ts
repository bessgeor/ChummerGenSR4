import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { discoveryThreadId, RunnerDiscovery, threadDiscoveryOptions } from "../src/discovery/thread-discovery.js";
import { SetupError } from "../src/host/setup-error.js";
import type { RunOptions } from "../src/options/run-options.js";
import { FakeDiscoveryRunner } from "./thread-discovery-fixtures.js";
import { tuning } from "./tuning-fixtures.js";

const options: RunOptions = {
  caseFile: "suite-cases.json", cases: ["a"], captures: ["common"], settingsOverlay: "overlay", threshold: 0.001, canonicalCache: "cache", canonicalCacheSource: "profile",
  noOcr: false, tessdata: null, only: null, recapture: false, diagnosis: true, agents: resolveAgentSettings(undefined), unattended: true, certificates: "certificates",
  tuning: { hypothesis: tuning({ jobKind: "hypothesis" }), scenario: tuning({ jobKind: "scenario" }) }, repair: null, widening: false,
  discovery: { caseFile: "characters.json", targets: 4 },
};

const scratch = () => mkdtempSync(join(tmpdir(), "workflow-thread-discovery-"));

test("the discovery thread takes the workflow thread as its baseline, the fixture case file, the targets and the options they share", () => {
  strictEqual(discoveryThreadId("wf-1"), "disc-wf-1");
  deepStrictEqual(threadDiscoveryOptions("wf-1", options), {
    from: "wf-1", caseFile: "characters.json", settingsOverlay: "overlay", threshold: 0.001, canonicalCache: "cache", canonicalCacheSource: "profile", targets: 4,
    unattended: true, agents: options.agents, certificates: "certificates", tuning: { scenario: tuning({ jobKind: "scenario" }) },
  });
  const { tuning: _none, ...older } = options;
  strictEqual("tuning" in threadDiscoveryOptions("wf-1", older), false);
});

test("a finished discovery thread's conclusion is read without running it again", async () => {
  const runner = new FakeDiscoveryRunner(scratch(), { exitStatus: 1, scenarios: [{ case: "build-x@s1", admission: "admitted", outcome: "finding" }] });
  const concluded = runner.finish("disc-wf-1", threadDiscoveryOptions("wf-1", options));
  const lines: string[] = [];
  const found = await new RunnerDiscovery(runner, (line) => lines.push(line)).discover({ threadId: "wf-1", options });
  deepStrictEqual(found, { threadId: "disc-wf-1", exitStatus: 1, admitted: ["build-x@s1"], differing: ["build-x@s1"], documentPath: concluded.path });
  deepStrictEqual(runner.calls, []);
  deepStrictEqual(lines[0], "Discovery thread disc-wf-1 already finished; its conclusion is read without running it again.");
});

test("a discovery document that cannot be read is a setup error", async () => {
  const runner = new FakeDiscoveryRunner(scratch());
  const concluded = runner.finish("disc-wf-1", threadDiscoveryOptions("wf-1", options));
  writeFileSync(concluded.path, JSON.stringify({ registry: {} }));
  await rejects(new RunnerDiscovery(runner, () => {}).discover({ threadId: "wf-1", options }), (error: unknown) => error instanceof SetupError && error.message.includes("does not match its schema"));
});

test("a discovery conclusion with an exit status other than 0, 1 or 2 is a setup error", async () => {
  const runner = new FakeDiscoveryRunner(scratch(), { exitStatus: 3, scenarios: [] });
  runner.finish("disc-wf-1", threadDiscoveryOptions("wf-1", options));
  await rejects(new RunnerDiscovery(runner, () => {}).discover({ threadId: "wf-1", options }),
    (error: unknown) => error instanceof SetupError && error.message === "Discovery thread disc-wf-1 concluded with exit status 3; a conclusion has 0, 1 or 2.");
});
