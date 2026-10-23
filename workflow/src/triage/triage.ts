import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { CompareReport } from "../../../contracts/generated/typescript/parity-compare-report.js";
import type { TriageInput } from "../graph/workflow-graph.js";
import type { TriageSummary } from "../graph/workflow-state.js";
import { SetupError } from "../host/setup-error.js";
import { readCaseDetails } from "../steps/case-details.js";
import { reportPath } from "../steps/compare-step.js";
import { clusterMembers, type Member } from "./clusters.js";
import { assignIdentities } from "./identity.js";
import { TriageDocumentSchema, type OtherFinding, type TriageDocument } from "./triage-document.js";

function members(report: CompareReport, runFolder: string): Member[] {
  return report.discrepancies.map((discrepancy) => {
    const row = report.rows.find((item) => item.case === discrepancy.case && item.capture === discrepancy.capture);
    const captureSize = row?.canonicalSize ?? row?.candidateSize;
    if (captureSize === undefined) {
      throw new SetupError(`${join(runFolder, reportPath)}: discrepancy ${discrepancy.id} has no row with a capture size.`);
    }
    return {
      case: discrepancy.case, capture: discrepancy.capture, runFolder, discrepancy: discrepancy.id, imageHash: discrepancy.imageHash,
      core: discrepancy.core, crop: discrepancy.crop, captureSize, differingPixels: discrepancy.differingPixels,
      canonicalCrop: join(runFolder, discrepancy.canonicalCrop), candidateCrop: join(runFolder, discrepancy.candidateCrop),
    };
  });
}

function otherFindings(report: CompareReport): OtherFinding[] {
  const findings: OtherFinding[] = [];
  for (const row of report.rows) {
    if (row.status === "failed" || row.status === "size-mismatch" || row.status === "missing-canonical" || row.status === "missing-candidate") {
      findings.push({ case: row.case, capture: row.capture, kind: row.status, ...(row.failure === undefined ? {} : { detail: row.failure }) });
    }
  }
  for (const entry of report.completeness.entries) {
    if (entry.state === "execution-lost" || entry.state === "unaccounted") {
      findings.push({ case: entry.case, capture: entry.capture, kind: entry.state, ...(entry.detail === undefined ? {} : { detail: entry.detail }) });
    }
  }
  return findings;
}

/**
 * Reads every compared case's run, clusters the discrepancies across cases, gives each cluster its stable
 * identity and writes `triage.json` into the thread's folder.
 */
export async function runTriage(input: TriageInput, store: BaseStore, threadFolder: string, now: Date): Promise<TriageSummary> {
  const cases: TriageDocument["cases"] = [];
  const allMembers: Member[] = [];
  const others: OtherFinding[] = [];
  for (const item of input.plan) {
    const capture = input.captures[item.name];
    const compare = input.compares[item.name];
    if (capture === undefined || compare === undefined) throw new SetupError(`Triage found no capture and compare for ${item.name}.`);
    const runFolder = capture.runFolder;
    const { execution, visual } = readCaseDetails(runFolder, true);
    const report = visual.report!;
    cases.push({
      case: item.name,
      runFolder,
      capture: { status: capture.status, reusedFrom: capture.reusedFrom },
      compare: { status: compare.status, reusedFrom: compare.reusedFrom },
      execution: { coverageValid: execution.coverageValid, invalidReasons: [...execution.invalidReasons], canonicalSource: execution.canonicalSource },
      visual: {
        passed: visual.passed,
        failed: visual.failed,
        reportStatus: report.status,
        discrepancies: report.totals.discrepancies,
        groups: report.totals.groups,
        completeness: report.completeness.totals,
      },
    });
    allMembers.push(...members(report, runFolder));
    others.push(...otherFindings(report));
  }

  const clusters = clusterMembers(allMembers);
  const identities = await assignIdentities(clusters, store, input.threadId, now);
  const document = TriageDocumentSchema.parse({
    threadId: input.threadId,
    cases,
    clusters: clusters.map((cluster, index) => ({
      id: identities[index]!.id,
      known: identities[index]!.known,
      imageHash: cluster.imageHash,
      cases: [...new Set(cluster.members.map((member) => member.case))],
      captures: [...new Set(cluster.members.map((member) => member.capture))],
      members: cluster.members.map(({ runFolder: _runFolder, imageHash: _imageHash, captureSize: _captureSize, ...member }) => member),
    })),
    otherFindings: others,
    totals: {
      cases: cases.length,
      discrepancies: allMembers.length,
      clusters: clusters.length,
      newClusters: identities.filter((identity) => !identity.known).length,
      knownClusters: identities.filter((identity) => identity.known).length,
      otherFindings: others.length,
    },
  });
  mkdirSync(threadFolder, { recursive: true });
  const path = join(threadFolder, "triage.json");
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return {
    path, discrepancies: document.totals.discrepancies, clusters: document.totals.clusters,
    newClusters: document.totals.newClusters, otherFindings: document.totals.otherFindings,
  };
}
