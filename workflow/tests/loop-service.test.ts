import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import type { ThreadDiscovery } from "../src/discovery/thread-discovery.js";
import { LoopService, type ConcludeInput } from "../src/loop/loop-service.js";
import { describeOutcome, type OutcomeDocument } from "../src/loop/outcome.js";
import type { RunOptions } from "../src/options/run-options.js";
import type { StepOutcome } from "../src/steps/step-outcome.js";
import type { TriageDocument } from "../src/triage/triage-document.js";
import type { AcceptedState, ClusterWidening } from "../src/widening/cluster-widening.js";
import { triageDocument } from "./diagnosis-fixtures.js";

const options: RunOptions = {
  caseFile: "cases.json", cases: [], captures: [], settingsOverlay: null, threshold: null, canonicalCache: null, canonicalCacheSource: "default", noOcr: false,
  tessdata: null, only: null, recapture: false, diagnosis: true, agents: resolveAgentSettings(undefined), unattended: false, certificates: "certificates", repair: null,
  widening: false,
};

const item: PlannedCase = {
  name: "build-a", characterFile: "a.chum", fixturePath: "a.chum", mode: "build", actions: [], startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null,
};

const cleanTriage: TriageDocument = {
  threadId: "wf-1", cases: [], clusters: [], otherFindings: [],
  totals: { cases: 1, discrepancies: 0, clusters: 0, newClusters: 0, knownClusters: 0, otherFindings: 0 },
};

/** Concludes a thread with a clean scope (by default no cluster, no other finding, every step 0) and the given discovery; returns `outcome.json`. */
function conclude(discovery: ThreadDiscovery | null, extra: Partial<ConcludeInput> = {}, triage = cleanTriage): OutcomeDocument {
  const root = mkdtempSync(join(tmpdir(), "loop-service-"));
  const triagePath = join(root, "triage.json");
  writeFileSync(triagePath, JSON.stringify(triage));
  const step: StepOutcome = { case: item.name, status: 0, runFolder: "runs/a", key: "k", reusedFrom: null };
  const input: ConcludeInput = {
    threadId: "wf-1", options, plan: [item], captures: { [item.name]: step }, compares: { [item.name]: step }, triagePath, otherFindings: 0, clusters: {}, check: null,
    repairs: {}, widenings: {}, accepted: null, base: { branch: "main", commit: "c0ffee" }, agentMilliseconds: 0, startedUtc: null, discovery, ...extra,
  };
  try {
    const service = new LoopService({
      threadFolder: (threadId) => join(root, "threads", threadId), now: () => new Date("2026-10-01T12:00:00Z"),
      integrate: () => {
        throw new Error("Nothing is merged here.");
      },
    });
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

test("a thread stored before its start branch was recorded concludes its promoted fix as fixed without merging, and says so", () => {
  const id = "d-0000000000000100";
  const triage = triageDocument("wf-1", [{ case: "build-alpha", capture: "skills", x: 100 }], { "build-alpha": "runs/a" });
  const widening = { clusterId: id, attempt: 1, status: "promoted", commit: "f1" } as ClusterWidening;
  const accepted: AcceptedState = { branch: "accepted/wf-1", base: "b0", commit: "f1", source: "source", build: null, baselineRuns: [], promoted: [id] };
  const outcome = conclude(null, { base: null, widenings: { [id]: widening }, accepted }, triage);
  deepStrictEqual(outcome.clusters.map((end) => [end.disposition, end.commit, end.mergeCommit]), [["fixed", "f1", null]]);
  deepStrictEqual(outcome.merge, {
    branch: null, before: null, after: null, integrationBranch: null, fixes: [],
    skipped: "the thread was stored before the branch it started on was recorded, so its fixes stay on accepted/wf-1",
  });
  ok(describeOutcome(outcome, "outcome.json").includes("Merge: none; the thread was stored before the branch it started on was recorded, so its fixes stay on accepted/wf-1"));
});
