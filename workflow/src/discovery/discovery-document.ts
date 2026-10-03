import { writeFileSync } from "node:fs";
import type { DiscoveryPaths } from "./discovery-paths.js";
import type { Coverage, DiscoveryStateValue, ScenarioJob } from "./discovery-state.js";
import type { ScenarioProof } from "./proof.js";
import { scenarioOutcome } from "./scenario-run.js";

/** One selected target's scenario as the document reports it. */
type ScenarioReport = {
  readonly targetId: string;
  readonly index: number;
  readonly status: ScenarioJob["status"];
  readonly records: readonly string[];
  readonly record: string | null;
  readonly failure: ScenarioJob["failure"];
  /** The `discovery` label's outcome, or null when the job did not answer. */
  readonly outcome: string | null;
  readonly reason: string | null;
  readonly plan: unknown;
  readonly validation: readonly string[] | null;
  readonly case: string | null;
  readonly execution: ScenarioProof["execution"] | null;
  readonly failures: readonly string[];
  readonly visual: ScenarioProof["visual"];
  readonly proofs: ScenarioProof["proofs"] | null;
  readonly admission: "admitted" | "duplicate" | "not-admitted" | null;
};

export type DiscoveryDocument = {
  readonly schemaVersion: 1;
  readonly threadId: string;
  readonly baselineThread: string;
  readonly sourceSha256: string | null;
  readonly startedUtc: string;
  readonly finishedUtc: string;
  readonly targets: { readonly path: string | null; readonly count: number; readonly selected: readonly string[] };
  readonly rank: { readonly status: string; readonly record: string | null; readonly records: readonly string[]; readonly failure: unknown; readonly rankings: unknown };
  readonly scenarios: readonly ScenarioReport[];
  /** The capture run's execution outcome, apart from its rows passed and failed. */
  readonly run: DiscoveryStateValue["execution"];
  readonly coverage: { readonly before: Coverage | null; readonly after: Coverage | null };
  readonly registry: { readonly before: number | null; readonly after: number | null; readonly admitted: readonly string[]; readonly duplicates: readonly string[] };
  readonly scenarioManifest: string | null;
  readonly modelMilliseconds: number;
};

function scenarioReport(job: ScenarioJob, state: DiscoveryStateValue): ScenarioReport {
  const proof = job.case === null ? undefined : state.registered?.proofs[job.case];
  const admission = job.case === null || state.registered === null || proof === undefined ? null
    : state.registered.admitted.includes(job.case) ? "admitted" : state.registered.duplicates.includes(job.case) ? "duplicate" : "not-admitted";
  return {
    targetId: job.targetId, index: job.index, status: job.status, records: job.records, record: job.answer?.recordId ?? null, failure: job.failure,
    outcome: scenarioOutcome(job, proof), reason: job.answer?.output.reason ?? null, plan: job.answer?.output.plan ?? null, validation: job.validation, case: job.case,
    execution: proof?.execution ?? null, failures: proof?.failures ?? [], visual: proof?.visual ?? null, proofs: proof?.proofs ?? null, admission,
  };
}

function after(before: Coverage, proofs: readonly ScenarioProof[]): Coverage {
  const controls = new Set(proofs.flatMap((proof) => proof.proofs.controls));
  const interactions = new Set(proofs.flatMap((proof) => proof.proofs.interactions));
  return {
    controls: { active: before.controls.active, observed: before.controls.observed + controls.size },
    interactions: { active: before.interactions.active, exercised: before.interactions.exercised + interactions.size },
  };
}

export function discoveryDocument(state: DiscoveryStateValue, finished: Date): DiscoveryDocument {
  const { prepared, registered } = state;
  const scenarios = Object.values(state.scenarios).sort((left, right) => left.index - right.index).map((job) => scenarioReport(job, state));
  const before = prepared?.coverageBefore ?? null;
  return {
    schemaVersion: 1, threadId: state.threadId, baselineThread: state.options.from, sourceSha256: prepared?.sourceSha256 ?? null,
    startedUtc: state.startedUtc, finishedUtc: finished.toISOString(),
    targets: { path: prepared?.targetsPath ?? null, count: prepared?.targets ?? 0, selected: state.selected ?? [] },
    rank: { status: state.rankJob.status, record: state.rankJob.answer?.recordId ?? null, records: state.rankJob.records, failure: state.rankJob.failure, rankings: state.rankJob.answer?.output.rankings ?? null },
    scenarios, run: state.execution,
    coverage: { before, after: before === null ? null : after(before, Object.values(registered?.proofs ?? {})) },
    registry: { before: prepared?.registryEntries ?? null, after: registered?.registryEntries ?? prepared?.registryEntries ?? null, admitted: registered?.admitted ?? [], duplicates: registered?.duplicates ?? [] },
    scenarioManifest: registered?.manifestPath ?? null, modelMilliseconds: state.agentMilliseconds,
  };
}

/**
 * 2 when the capture run had status 2 or invalid coverage or a job failed with `invalid_output` or `refused`; else 1 when an
 * admitted scenario differs; else 0.
 */
export function discoveryExitStatus(document: DiscoveryDocument): number {
  const jobFailed = document.rank.status === "failed" || document.scenarios.some((item) => item.status === "failed");
  if (jobFailed || (document.run !== null && (document.run.status === 2 || !document.run.coverageValid))) return 2;
  return document.scenarios.some((item) => item.admission === "admitted" && item.visual?.outcome === "finding") ? 1 : 0;
}

export function discoveryLines(document: DiscoveryDocument, path: string): string[] {
  const lines = document.scenarios.map((item) => {
    const parts = [`Scenario ${item.targetId}: ${item.outcome ?? item.status}${item.failure === null ? "" : ` (${item.failure.kind})`}`];
    if (item.case !== null) parts.push(`case ${item.case}`);
    if (item.validation !== null && item.validation.length > 0) parts.push(`${item.validation.length} validation reasons`);
    if (item.execution !== null) parts.push(`execution ${item.execution}`);
    if (item.visual !== null) parts.push(`visual ${item.visual.outcome}${item.visual.differing.length > 0 ? ` (${item.visual.differing.join(", ")})` : ""}`);
    if (item.proofs !== null) parts.push(`proved ${item.proofs.controls.length} controls and ${item.proofs.interactions.length} bindings`);
    if (item.admission !== null) parts.push(item.admission);
    return parts.join("; ");
  });
  const run = document.run === null ? "no capture run" : `capture run ${document.run.runId} status ${document.run.status}, coverage ${document.run.coverageValid ? "valid" : "invalid"}, `
    + `${document.run.failures} failures; rows ${document.run.rows.passed} passed, ${document.run.rows.failed} failed`;
  const coverage = document.coverage.before === null || document.coverage.after === null ? "coverage not read"
    : `controls observed ${document.coverage.before.controls.observed} -> ${document.coverage.after.controls.observed} of ${document.coverage.before.controls.active}, `
      + `interactions exercised ${document.coverage.before.interactions.exercised} -> ${document.coverage.after.interactions.exercised} of ${document.coverage.before.interactions.active}`;
  const proven = document.scenarios.filter((item) => item.outcome === "proven").length;
  return [
    ...lines,
    `Discovery: ${document.targets.count} targets, ${document.targets.selected.length} selected, rank ${document.rank.status}; ${proven} proven; ${run}; ${coverage}; `
      + `registry ${document.registry.before ?? 0} -> ${document.registry.after ?? 0} entries (${document.registry.admitted.length} admitted, ${document.registry.duplicates.length} duplicates); ${path}`,
  ];
}

/** Writes the thread's `discovery.json` and returns its path, exit status and report lines. */
export function concludeDiscovery(state: DiscoveryStateValue, folders: DiscoveryPaths, finished: Date): { path: string; exitStatus: number; lines: string[] } {
  const document = discoveryDocument(state, finished);
  const path = folders.thread(state.threadId).document;
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return { path, exitStatus: discoveryExitStatus(document), lines: discoveryLines(document, path) };
}
