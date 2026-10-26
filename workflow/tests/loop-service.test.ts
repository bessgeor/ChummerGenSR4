import { deepStrictEqual, equal } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import type { ThreadDiscovery } from "../src/discovery/thread-discovery.js";
import { LoopService, type ConcludeInput } from "../src/loop/loop-service.js";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import type { RunOptions } from "../src/options/run-options.js";
import type { StepOutcome } from "../src/steps/step-outcome.js";
import type { TriageDocument } from "../src/triage/triage-document.js";

const options: RunOptions = {
  caseFile: "cases.json", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: null, canonicalCacheSource: "default", noOcr: false,
  tessdata: null, only: null, recapture: false, diagnosis: true, agents: resolveAgentSettings(undefined), unattended: false, certificates: "certificates", repair: null,
  widening: false,
};

const item: PlannedCase = {
  name: "build-a", characterFile: "a.chum", fixturePath: "a.chum", mode: "build", actions: [], startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null,
};

/** Concludes a thread with a clean scope (no cluster, no other finding, every step 0) and the given discovery; returns `outcome.json`. */
function conclude(discovery: ThreadDiscovery | null): OutcomeDocument {
  const root = mkdtempSync(join(tmpdir(), "loop-service-"));
  const triage: TriageDocument = {
    threadId: "wf-1", cases: [], clusters: [], otherFindings: [],
    totals: { cases: 1, discrepancies: 0, clusters: 0, newClusters: 0, knownClusters: 0, otherFindings: 0 },
  };
  const triagePath = join(root, "triage.json");
  writeFileSync(triagePath, JSON.stringify(triage));
  const step: StepOutcome = { case: item.name, status: 0, runFolder: "runs/a", key: "k", reusedFrom: null };
  const input: ConcludeInput = {
    threadId: "wf-1", options, plan: [item], captures: { [item.name]: step }, compares: { [item.name]: step }, triagePath, otherFindings: 0, clusters: {}, check: null,
    repairs: {}, widenings: {}, accepted: null, agentMilliseconds: 0, startedUtc: null, discovery,
  };
  try {
    const service = new LoopService({ threadFolder: (threadId) => join(root, "threads", threadId), now: () => new Date("2026-10-01T12:00:00Z") });
    const { document, path } = service.conclude(input);
    const written = JSON.parse(readFileSync(path, "utf8")) as OutcomeDocument;
    deepStrictEqual(written, document);
    return written;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("outcome.json records the thread's discovery, and an admitted scenario that differs leaves the outcome verified for the scope", () => {
  const discovery: ThreadDiscovery = {
    threadId: "disc-wf-1", exitStatus: 1, admitted: ["build-a@s1", "build-a@s2"], differing: ["build-a@s1"], documentPath: "discovery.json",
  };
  const outcome = conclude(discovery);
  deepStrictEqual([outcome.outcome, outcome.discovery], ["verified_for_scope", discovery]);
});

test("outcome.json of a thread that did not discover holds discovery null", () => {
  const outcome = conclude(null);
  equal(outcome.outcome, "verified_for_scope");
  equal(outcome.discovery, null);
});
