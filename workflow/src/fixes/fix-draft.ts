import { basename } from "node:path";
import type { CheckResult, ObservedCapture } from "../diagnosis/check.js";
import type { ClusterDiagnosis } from "../diagnosis/cluster-diagnosis.js";
import type { ContextManifest } from "../diagnosis/context.js";
import type { CheckExecution } from "../repair/cluster-repair.js";
import type { Patch } from "../repair/patch.js";
import type { PlannedWork } from "../repair/planned-attempt.js";
import { renderProposal, renderTasks } from "./fix-documents.js";
import type { LevelResult } from "../widening/cluster-widening.js";
import { fixChangeName, FixRecordSchema, type FixLevel, type FixRecord, type FixRun } from "./fix-record.js";

/** A capture run's execution and visual counts, with the run folder by its name. */
export function fixRun(execution: CheckExecution): FixRun {
  return {
    run: basename(execution.runFolder), status: execution.status, coverageValid: execution.coverageValid, failures: execution.failures,
    passed: execution.passed, failed: execution.failed,
  };
}

export type DraftInput = {
  readonly threadId: string;
  readonly manifest: ContextManifest;
  readonly diagnosis: ClusterDiagnosis;
  readonly check: CheckResult;
  /** The check's observations of the captures the cluster's explanations predicted. */
  readonly observations: readonly ObservedCapture[];
  readonly planned: PlannedWork;
  readonly patch: Patch;
  readonly narrowCheck: CheckExecution;
};

/** The fix record of a passed planned attempt, without its widening, which promotion adds. */
export function draftFixRecord(input: DraftInput): FixRecord {
  const { manifest, diagnosis, planned } = input;
  const hypothesis = diagnosis.hypothesis;
  const explanation = hypothesis?.output.explanation ?? null;
  const plan = planned.plan.output;
  if (hypothesis === null || explanation === null || plan === null) throw new Error(`The fix change of ${manifest.cluster.id} needs a hypothesis and a plan.`);
  const challenge = diagnosis.challenge;
  return FixRecordSchema.parse({
    schemaVersion: 1, name: fixChangeName(manifest.cluster.id, input.threadId), threadId: input.threadId,
    cluster: { id: manifest.cluster.id, imageHash: manifest.cluster.imageHash, cases: manifest.cluster.cases, captures: manifest.cluster.captures, members: manifest.cluster.members },
    members: manifest.members.map((member) => ({
      case: member.case, capture: member.capture, core: member.core, differingPixels: member.differingPixels,
      canonicalOcr: member.canonicalOcr.text, candidateOcr: member.candidateOcr.text,
    })),
    hypothesis: {
      recordId: hypothesis.recordId, claim: explanation.claim, mechanism: explanation.mechanism, locations: explanation.locations,
      evidence: explanation.evidence, confidence: explanation.confidence,
    },
    challenge: challenge === null ? null : {
      recordId: challenge.recordId, outcome: challenge.output.outcome, reason: challenge.output.reason, alternative: challenge.output.alternative?.claim ?? null,
    },
    check: {
      outcome: input.check.clusters[manifest.cluster.id]?.outcome ?? "undecided", run: basename(input.check.runFolder),
      observations: input.observations.map((item) => ({ case: item.case, capture: item.capture, observation: item.observation, detail: item.detail })),
    },
    plan: { recordId: planned.plan.recordId, reason: plan.reason, summary: plan.summary },
    tasks: plan.tasks.map((task) => {
      const outcome = planned.subtasks.find((item) => item.id === task.id);
      if (outcome?.answer === null || outcome === undefined) throw new Error(`Subtask ${task.id} of ${manifest.cluster.id} has no answer.`);
      return {
        id: task.id, title: task.title, instructions: task.instructions, blockedBy: task.blockedBy, files: [...outcome.files],
        recordId: outcome.recordId, summary: outcome.answer.summary,
      };
    }),
    patch: {
      files: input.patch.files.map((file) => ({ path: file.path, change: file.change, added: file.added, removed: file.removed })),
      added: input.patch.added, removed: input.patch.removed,
    },
    narrowCheck: fixRun(input.narrowCheck),
    widening: null,
  });
}

/** A widening level as its fix change records it. */
export function fixLevel(level: LevelResult): FixLevel {
  return {
    level: level.level, cases: [...level.cases], captures: level.captures === null ? null : [...level.captures],
    run: level.run === null ? null : fixRun(level.run), baseline: level.baseline === null ? null : fixRun(level.baseline), outcome: level.outcome,
    findings: level.findings.map((finding) => ({ case: finding.case, capture: finding.capture, attribution: finding.attribution, difference: finding.difference, detail: finding.detail })),
  };
}

/** The draft's files in a passed attempt's archive, under `fix/`: the record and the two artifacts repair can write. */
export function draftFiles(record: FixRecord): Record<string, string> {
  return { "fix/fix.json": `${JSON.stringify(record, null, 2)}\n`, "fix/proposal.md": renderProposal(record), "fix/tasks.md": renderTasks(record) };
}
