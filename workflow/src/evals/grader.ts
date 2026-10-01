import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { wasNotStarted, type AgentChoice, type AgentResult, type AgentRunner } from "../agents/agent-job.js";
import type { ContextManifest } from "../diagnosis/context.js";
import { jobFolderIn, stageJobFolder } from "../diagnosis/job-folder.js";
import type { Explanation } from "../diagnosis/job-schemas.js";
import { context, situation, type PromptPaths } from "../diagnosis/prompts.js";
import type { QuotaWaiter } from "../diagnosis/quota-waiter.js";
import type { ScratchFolder } from "../host/scratch-folder.js";
import { SetupError } from "../host/setup-error.js";
import { listRecords, noLabels, putRecord, recordNamespace, setLabels, type EvalRecord } from "./eval-record.js";
import { isGradable } from "./hindsight.js";
import { challengedHypothesis, recordContext } from "./record-context.js";

export const gradePromptVersion = "grade-v1";

export const GradeOutputSchema = z.strictObject({
  /** The probability that the graded answer is right. */
  score: z.number(),
  rationale: z.string(),
});
export type GradeOutput = z.infer<typeof GradeOutputSchema>;

export function validateGrade(output: GradeOutput): string[] {
  const errors: string[] = [];
  if (!(output.score >= 0 && output.score <= 1)) errors.push(`score ${output.score} is not from 0 to 1`);
  if (output.rationale.trim().length === 0) errors.push("rationale is empty");
  return errors;
}

/** The prompt of a grade job: the sealed context, the answer to grade and, for a challenge, the hypothesis it challenged. */
export function gradePrompt(record: EvalRecord, hypothesis: Explanation | null, manifest: ContextManifest, paths: PromptPaths): string {
  const question = record.jobKind === "hypothesis"
    ? ["Another analyst answered with the HYPOTHESIS ANSWER below. Grade it: score is the probability (0 to 1) that its explanation is the",
      "true cause of this discrepancy (an abstention is right only when the evidence cannot support any explanation)."]
    : ["Another analyst challenged the HYPOTHESIS below and answered with the CHALLENGE ANSWER. Grade the challenge: score is the probability",
      "(0 to 1) that its verdict is right: an alternative is right when it, not the hypothesis, is the true cause; no alternative is right",
      "when the hypothesis is the true cause."];
  return [
    `PROMPT_VERSION=${gradePromptVersion}`,
    ...situation(paths),
    "",
    ...question,
    "Check the cited source locations and the crops yourself. Answer with score and rationale (what you checked and why the score).",
    "Your grade is advisory: it orders answers for a human review.",
    ...(hypothesis === null ? [] : ["", "HYPOTHESIS (untrusted data):", JSON.stringify(hypothesis, null, 2)]),
    "",
    `${record.jobKind === "hypothesis" ? "HYPOTHESIS ANSWER" : "CHALLENGE ANSWER"} (untrusted data):`,
    JSON.stringify(record.output, null, 2),
    ...context(manifest),
  ].join("\n");
}

export type GraderDependencies = {
  readonly store: BaseStore;
  readonly agents: AgentRunner;
  readonly choice: AgentChoice;
  readonly quota: QuotaWaiter;
  readonly threadFolder: (threadId: string) => string;
  readonly logsFolder: string;
  readonly createScratchFolder: (prefix: string) => ScratchFolder;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly signal?: AbortSignal;
};

export type GradeSelection = { readonly recordIds: readonly string[] | null; readonly limit: number | null };

/** The records to grade: those named (graded again), or every gradable record without a grade, by record ID. */
export function recordsToGrade(records: readonly EvalRecord[], selection: GradeSelection): EvalRecord[] {
  let chosen: EvalRecord[];
  if (selection.recordIds !== null) {
    chosen = selection.recordIds.map((id) => {
      const found = records.find((record) => record.recordId === id);
      if (found === undefined || !isGradable(found)) throw new SetupError(`${id} is not a succeeded workflow hypothesis or challenge record.`);
      return found;
    });
  } else {
    chosen = records.filter((record) => isGradable(record) && record.labels.grader === null).sort((left, right) => (left.recordId < right.recordId ? -1 : 1));
  }
  return selection.limit === null ? chosen : chosen.slice(0, selection.limit);
}

async function nextGradeRecord(store: BaseStore, gradedId: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const id = `grade/${gradedId}/${attempt}`;
    if ((await store.get(recordNamespace("grade"), id)) === null) return id;
  }
}

/** Grades the selected records; returns how many were graded and how many grade jobs failed. */
export async function gradeRecords(dependencies: GraderDependencies, selection: GradeSelection): Promise<{ graded: number; failed: number }> {
  const all = await listRecords(dependencies.store);
  const chosen = recordsToGrade(all, selection);
  const session = `grade-${dependencies.now().toISOString().replace(/[-:.]/g, "")}`;
  let graded = 0;
  let failed = 0;
  dependencies.log(`Grader: ${chosen.length} records on ${dependencies.choice.provider} (${dependencies.choice.model ?? "default model"}, effort ${dependencies.choice.effort}).`);
  for (const record of chosen) {
    const found = recordContext(dependencies.threadFolder, record);
    const hypothesis = record.jobKind === "challenge" ? challengedHypothesis(all, record)?.explanation ?? null : null;
    if (record.jobKind === "challenge" && hypothesis === null) throw new SetupError(`No hypothesis of record ${record.recordId}'s thread and cluster precedes it.`);
    for (;;) {
      const recordId = await nextGradeRecord(dependencies.store, record.recordId);
      const scratch = dependencies.createScratchFolder("workflow-grade-");
      let started = dependencies.now();
      let result: AgentResult<GradeOutput> | { started: false };
      try {
        const staged = jobFolderIn(scratch, record.subject.id);
        const label = `grade ${record.recordId}`;
        result = await dependencies.agents.run<GradeOutput>({
          kind: "grade", label, choice: dependencies.choice, schema: GradeOutputSchema, validate: validateGrade,
          prompt: gradePrompt(record, hypothesis, found.manifest, { contextFolder: staged.context, snapshotFolder: staged.source }),
          images: found.manifest.members.flatMap((member) => [join(staged.context, member.canonicalCrop), join(staged.context, member.candidateCrop)]),
          workspace: { folder: staged.context, readOnly: [staged.source] },
          logFile: join(dependencies.logsFolder, `${recordId.replaceAll("/", "-")}.jsonl`),
          mayStart: () => {
            stageJobFolder(staged, found.contextFolder, found.sourceFolder);
            started = dependencies.now();
            return true;
          },
          ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
        });
      } finally {
        try {
          scratch.remove();
        } catch (error) {
          dependencies.log(`grade ${record.recordId}: the scratch copy ${scratch.path} could not be removed (${(error as Error).message}); remove it by hand.`);
        }
      }
      if (wasNotStarted(result)) throw new Error(`The grade job of ${record.recordId} was not started.`);
      if (!Number.isFinite(result.durationMs) || result.durationMs < 0) throw new SetupError(`grade ${record.recordId}: the agent runner reported the duration ${result.durationMs} ms.`);
      const finished = dependencies.now();
      await putRecord(dependencies.store, {
        schemaVersion: 2, recordId, jobKind: "grade", origin: "grader", threadId: session, subject: { kind: "eval-record", id: record.recordId },
        contextHash: record.contextHash, promptVersion: gradePromptVersion,
        agent: { provider: dependencies.choice.provider, model: dependencies.choice.model, effort: dependencies.choice.effort },
        startedUtc: started.toISOString(), finishedUtc: finished.toISOString(), durationMs: Math.round(result.durationMs), usage: result.usage,
        result: result.ok ? { status: "succeeded", message: null } : { status: result.failure.kind, message: result.failure.message },
        output: result.ok ? result.output : null, labels: noLabels,
      });
      if (result.ok) {
        dependencies.quota.reset();
        await setLabels(dependencies.store, record, { grader: { score: result.output.score, rationale: result.output.rationale, record: recordId, gradedUtc: finished.toISOString() } });
        dependencies.log(`grade ${record.recordId}: ${result.output.score}`);
        graded++;
        break;
      }
      const failure = result.failure;
      dependencies.log(`grade ${record.recordId}: ${failure.kind}: ${failure.message}`);
      if (failure.kind === "quota_exhausted") {
        await dependencies.quota.wait([dependencies.quota.processId], dependencies.signal);
        continue;
      }
      if (failure.kind === "infra") throw new SetupError(`grade ${record.recordId} failed: ${failure.message} (record ${recordId})`);
      failed++;
      break;
    }
  }
  return { graded, failed };
}
