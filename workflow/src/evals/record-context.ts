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

/** Whether a record's context and its thread's snapshot are still on disk. */
export function contextExists(threadFolder: (threadId: string) => string, record: EvalRecord): boolean {
  const folders = diagnosisFolders(threadFolder(record.threadId));
  return existsSync(join(folders.cluster(record.subject.id), "context.json")) && existsSync(folders.source);
}

/** Finds a record's context in its thread's folder; a missing or changed context is a setup error naming it. */
export function recordContext(threadFolder: (threadId: string) => string, record: EvalRecord): RecordContext {
  const folders = diagnosisFolders(threadFolder(record.threadId));
  const contextFolder = folders.cluster(record.subject.id);
  const path = join(contextFolder, "context.json");
  if (!contextExists(threadFolder, record)) {
    throw new SetupError(`The context of record ${record.recordId} (${contextFolder}) or its snapshot (${folders.source}) no longer exists.`);
  }
  const manifest = readDocument(path, ContextManifestSchema);
  if (contextHash(manifest) !== record.contextHash) {
    throw new SetupError(`The context ${contextFolder} differs from the one record ${record.recordId} saw (hash ${record.contextHash.slice(0, 12)}).`);
  }
  return { contextFolder, sourceFolder: folders.source, manifest };
}

/**
 * The hypothesis a challenge record challenged, named by the record itself. Null when the challenge names none, or
 * names a record that is not in `records` or has no explanation.
 */
export function challengedHypothesis(records: readonly EvalRecord[], challenge: EvalRecord): { record: EvalRecord; explanation: Explanation } | null {
  const named = challenge.challenged === null ? undefined : records.find((item) => item.recordId === challenge.challenged);
  if (named === undefined || named.jobKind !== "hypothesis" || named.result.status !== "succeeded") return null;
  const explanation = HypothesisOutputSchema.parse(named.output).explanation;
  return explanation === null ? null : { record: named, explanation };
}

/** Why a challenge record has no hypothesis to show. */
export function missingHypothesisMessage(challenge: EvalRecord): string {
  return challenge.challenged === null
    ? `Challenge record ${challenge.recordId} does not name the hypothesis it challenged.`
    : `Challenge record ${challenge.recordId} challenged ${challenge.challenged}, which is not a stored hypothesis with an explanation.`;
}
