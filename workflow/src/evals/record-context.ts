import { existsSync } from "node:fs";
import { join } from "node:path";
import { ContextManifestSchema, contextHash, type ContextManifest } from "../diagnosis/context.js";
import { diagnosisFolders } from "../diagnosis/diagnosis-service.js";
import { HypothesisOutputSchema, type Explanation } from "../diagnosis/job-schemas.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import type { EvalRecord } from "./eval-record.js";

/** The sealed context a workflow record's job saw, and the thread's snapshot beside it. */
export type RecordContext = { readonly contextFolder: string; readonly sourceFolder: string; readonly manifest: ContextManifest };

/** Finds a record's context in its thread's folder; a missing or changed context is a setup error naming it. */
export function recordContext(threadFolder: (threadId: string) => string, record: EvalRecord): RecordContext {
  const folders = diagnosisFolders(threadFolder(record.threadId));
  const contextFolder = folders.cluster(record.subject.id);
  const path = join(contextFolder, "context.json");
  if (!existsSync(path) || !existsSync(folders.source)) {
    throw new SetupError(`The context of record ${record.recordId} (${contextFolder}) or its snapshot (${folders.source}) no longer exists.`);
  }
  const manifest = readDocument(path, ContextManifestSchema);
  if (contextHash(manifest) !== record.contextHash) {
    throw new SetupError(`The context ${contextFolder} differs from the one record ${record.recordId} saw (hash ${record.contextHash.slice(0, 12)}).`);
  }
  return { contextFolder, sourceFolder: folders.source, manifest };
}

/**
 * The hypothesis a challenge record challenged: the explanation of the last succeeded hypothesis of its thread
 * and cluster that finished before the challenge started. Null when there is none.
 */
export function challengedHypothesis(records: readonly EvalRecord[], challenge: EvalRecord): { record: EvalRecord; explanation: Explanation } | null {
  const started = Date.parse(challenge.startedUtc);
  const candidates = records
    .filter((item) => item.jobKind === "hypothesis" && item.origin === challenge.origin && item.threadId === challenge.threadId
      && item.subject.id === challenge.subject.id && item.result.status === "succeeded" && Date.parse(item.finishedUtc) <= started)
    .sort((left, right) => Date.parse(right.finishedUtc) - Date.parse(left.finishedUtc));
  for (const item of candidates) {
    const explanation = HypothesisOutputSchema.parse(item.output).explanation;
    if (explanation !== null) return { record: item, explanation };
  }
  return null;
}
