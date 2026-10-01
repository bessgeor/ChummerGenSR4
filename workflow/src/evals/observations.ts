import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { observe, type Observation } from "../diagnosis/check.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { TriageDocumentSchema } from "../triage/triage-document.js";

export type ObservationRow = { readonly case: string; readonly capture: string; readonly observation: Observation };

/** The part of `diagnosis.json` that names the check run. */
const DiagnosisCheckSchema = z.object({ check: z.object({ runFolder: z.string() }).nullable() });

function runObservations(runFolder: string): ObservationRow[] {
  const results = readDocument(join(runFolder, "results.json"), CaptureResultsSchema);
  return results.results.map((row) => ({ case: row.case, capture: row.capture, observation: observe(results, row.case, row.capture).observation }));
}

/**
 * What a thread observed for every case and capture it captured: each capture run of its triage and its check run,
 * by the diagnosis check's rule. A thread folder without `triage.json` is a setup error.
 */
export function threadObservations(threadFolder: string): ObservationRow[] {
  const triagePath = join(threadFolder, "triage.json");
  if (!existsSync(triagePath)) throw new SetupError(`The thread folder ${threadFolder} has no triage.json.`);
  const triage = readDocument(triagePath, TriageDocumentSchema);
  const rows = triage.cases.flatMap((item) => runObservations(item.runFolder));
  const diagnosisPath = join(threadFolder, "diagnosis.json");
  if (existsSync(diagnosisPath)) {
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(diagnosisPath, "utf8"));
    } catch (error) {
      throw new SetupError(`${diagnosisPath} cannot be read: ${(error as Error).message}`);
    }
    const parsed = DiagnosisCheckSchema.safeParse(document);
    if (!parsed.success) throw new SetupError(`${diagnosisPath} has no valid check entry: ${z.prettifyError(parsed.error)}`);
    if (parsed.data.check !== null) rows.push(...runObservations(parsed.data.check.runFolder));
  }
  return rows;
}
