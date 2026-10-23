import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { certificateFor, certificatePath, readCertificate, writeCertificate, type Certificate, type Thresholds } from "../evals/certificate.js";
import { compareRuns } from "../evals/comparison.js";
import type { EvaluatedJobKind } from "../evals/evaluated-job-kinds.js";
import { SetupError } from "../host/setup-error.js";
import { readActiveFile, writeActiveFile, type ActiveFile, type ComparisonSummary, type Entry } from "./active-configuration.js";
import { comparisonSummary, runState } from "./development.js";
import { activeOf, exposureOf, measuredOf, pairingProblems, readLedger } from "./holdout.js";
import { requireCurrent, staleness, tuningId } from "./tuning.js";

export type ActivationFolders = { readonly evalsFolder: string; readonly tuningFolder: string; readonly certificatesFolder: string };

export type ActivationRequest = { readonly run: string; readonly baseline: string; readonly thresholds: Thresholds };

export type ActivationOutcome =
  | { readonly refused: readonly string[]; readonly comparison: ComparisonSummary | null }
  | { readonly activated: Entry; readonly comparison: ComparisonSummary; readonly certificate: Certificate };

/** The code's prompt as an entry, with the job kind's certificate as it is now. */
function codeEntry(certificate: Certificate | null): Entry {
  return { tuning: null, activatedUtc: null, evidence: null, certificate };
}

/**
 * Makes the candidate of a holdout run active when the run is complete, not worse than the active configuration's
 * test run on the same items and meets the certificate rule; otherwise returns every reason and changes nothing.
 */
export function activate(folders: ActivationFolders, request: ActivationRequest, now: Date): ActivationOutcome {
  const runs = join(folders.evalsFolder, "runs");
  const candidate = runState(join(runs, request.run));
  // Activated by this run already, on this request (stopped before its certificate was written): the certificate is written again.
  // Another baseline, metric or threshold is another claim and goes through the checks below.
  const done = readActiveFile(folders.tuningFolder, candidate.settings.jobKind)?.active;
  const { evidence } = done ?? { evidence: null };
  if (done !== undefined && evidence !== null && done.certificate !== null && evidence.test.candidate === request.run && evidence.test.baseline === request.baseline
    && evidence.test.metric === request.thresholds.metric && evidence.minPass === request.thresholds.minPass && evidence.maxMeanCostUsd === request.thresholds.maxMeanCostUsd) {
    writeCertificate(folders.certificatesFolder, done.certificate);
    return { activated: done, comparison: evidence.test, certificate: done.certificate };
  }
  const baseline = runState(join(runs, request.baseline));
  const jobKind = candidate.settings.jobKind;
  const exposure = exposureOf(readLedger(folders.tuningFolder), request.run);
  const reasons: string[] = [];
  if (exposure === undefined) reasons.push(`the run ${request.run} is not the test run of a holdout exposure`);
  else if (measuredOf(candidate.settings) !== exposure.candidate) reasons.push(`the run ${request.run} measured ${measuredOf(candidate.settings)}, not ${exposure.candidate}`);
  // The candidate is activated on the metric it was gated on: another one is a different claim.
  if (exposure !== undefined && exposure.development.metric !== request.thresholds.metric) {
    reasons.push(`the candidate was gated on development by ${exposure.development.metric}, not ${request.thresholds.metric}`);
  }
  if (candidate.settings.tuning === null) reasons.push(`the run ${request.run} measured the code's prompt, not a candidate`);
  else requireCurrent(candidate.settings.tuning, `The candidate of run ${request.run}`);
  if (!candidate.complete) reasons.push(`the run ${request.run} is not complete; resume it first`);
  if (!baseline.complete) reasons.push(`the baseline run ${request.baseline} is not complete; resume it first`);
  if (baseline.settings.jobKind !== jobKind) reasons.push(`the baseline run is of ${baseline.settings.jobKind}, not ${jobKind}`);
  const active = activeOf(folders.tuningFolder, jobKind);
  if (measuredOf(baseline.settings) !== active) reasons.push(`the baseline run measured ${measuredOf(baseline.settings)}, but ${active} is active`);
  if (active === measuredOf(candidate.settings)) reasons.push(`${active} is already active`);
  const pairing = pairingProblems(baseline.settings, candidate.settings, "test");
  reasons.push(...pairing);
  let comparison: ComparisonSummary | null = null;
  if (pairing.length === 0 && candidate.complete && baseline.complete) {
    comparison = comparisonSummary(compareRuns(join(runs, request.baseline), join(runs, request.run), request.thresholds.metric, now));
    if (comparison.unpaired > 0) {
      reasons.push(`on ${comparison.unpaired} items the candidate has a value of ${request.thresholds.metric} on fewer repetitions than the active configuration`);
    }
    if (comparison.verdict === "worse") {
      reasons.push(`the candidate is worse than the active configuration on the test partition: mean difference ${comparison.meanDifference}, 95% interval `
        + `[${comparison.interval!.low.toFixed(3)}, ${comparison.interval!.high.toFixed(3)}] over ${comparison.pairs} pairs`);
    }
  }
  const certified = certificateFor(join(runs, request.run), request.thresholds, now);
  if ("refused" in certified) reasons.push(...certified.refused.map((reason) => `certificate: ${reason}`));
  if (reasons.length > 0 || comparison === null || "refused" in certified || exposure === undefined) return { refused: reasons, comparison };

  const entry: Entry = {
    tuning: candidate.settings.tuning, activatedUtc: now.toISOString(), certificate: certified.certificate,
    evidence: {
      datasetHash: exposure.datasetHash, development: exposure.development, test: comparison,
      minPass: request.thresholds.minPass, maxMeanCostUsd: request.thresholds.maxMeanCostUsd,
    },
  };
  const current = readCertificate(folders.certificatesFolder, jobKind);
  const file = readActiveFile(folders.tuningFolder, jobKind);
  // The entry that is replaced keeps the certificate file as it is now, so a rollback restores exactly that.
  const replaced = file === null ? codeEntry(current) : { ...file.active, certificate: current };
  const next: ActiveFile = {
    schemaVersion: 1, jobKind, active: entry, history: [...(file?.history ?? []), replaced], rolledBack: file?.rolledBack ?? [],
  };
  // The active file first: stopped before the certificate, dispatch is refused unattended until activate runs again and writes it.
  writeActiveFile(folders.tuningFolder, next);
  writeCertificate(folders.certificatesFolder, certified.certificate);
  return { activated: entry, comparison, certificate: certified.certificate };
}

/**
 * Restores the job kind's previous entry and its certificate (or removes the certificate when it had none), and keeps
 * the entry it replaces with the time and reason. Returns the restored entry and why it cannot be dispatched, if so.
 */
export function rollback(folders: Pick<ActivationFolders, "tuningFolder" | "certificatesFolder">, jobKind: EvaluatedJobKind, reason: string | null, now: Date): { restored: Entry; stale: string | null } {
  const file = readActiveFile(folders.tuningFolder, jobKind);
  if (file === null || file.history.length === 0) throw new SetupError(`There is no earlier ${jobKind} configuration to roll back to.`);
  const restored = file.history[file.history.length - 1]!;
  const current = readCertificate(folders.certificatesFolder, jobKind);
  // The restored certificate is already in place when an earlier rollback stopped after writing it: the entry then keeps the certificate it holds.
  const stopped = isDeepStrictEqual(current, restored.certificate);
  // The certificate first: stopped before the active file, a second rollback ends in the same state, with the entry's certificate kept.
  if (restored.certificate !== null) writeCertificate(folders.certificatesFolder, restored.certificate);
  else if (existsSync(certificatePath(folders.certificatesFolder, jobKind))) rmSync(certificatePath(folders.certificatesFolder, jobKind));
  writeActiveFile(folders.tuningFolder, {
    ...file, active: restored, history: file.history.slice(0, -1),
    rolledBack: [...file.rolledBack, { ...file.active, certificate: stopped ? file.active.certificate : current, rolledBackUtc: now.toISOString(), reason }],
  });
  return { restored, stale: restored.tuning === null ? null : staleness(restored.tuning) };
}

/** A line naming an entry: its configuration or the code's prompt. */
export function entryName(entry: Entry): string {
  return entry.tuning === null ? "the code's prompt" : tuningId(entry.tuning);
}
