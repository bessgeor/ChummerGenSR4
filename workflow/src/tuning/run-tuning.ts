import type { EvaluatedJobKind } from "../evals/evaluated-job-kinds.js";
import { SetupError } from "../host/setup-error.js";
import { activeTuning } from "./active-configuration.js";
import { candidatesFolder, readCandidate } from "./candidates.js";
import { tuningId, type Tuning } from "./tuning.js";

/** Where an eval run finds the configuration it measures. */
export type TuningSource = { readonly tuningFolder: string; readonly evalsFolder: string };

/** The configuration `--tuning active|none|<ID>` names for a job kind: the active one, the code's prompt (null) or a stored candidate. */
export function selectedTuning(selection: string, jobKind: EvaluatedJobKind, source: TuningSource): Tuning | null {
  if (selection === "active") return activeTuning(source.tuningFolder, jobKind);
  if (selection === "none") return null;
  const candidate = readCandidate(candidatesFolder(source.evalsFolder), selection);
  if (candidate.tuning.jobKind !== jobKind) throw new SetupError(`The tuning candidate ${selection} is for ${candidate.tuning.jobKind}, the dataset for ${jobKind}.`);
  return candidate.tuning;
}

/** Whether a configuration is a candidate rather than what is dispatched: neither the code's prompt nor the active configuration. */
export function isCandidate(tuning: Tuning | null, jobKind: EvaluatedJobKind, tuningFolder: string): boolean {
  if (tuning === null) return false;
  const active = activeTuning(tuningFolder, jobKind);
  return active === null || tuningId(active) !== tuningId(tuning);
}

/** A candidate sees the test partition only through `tune holdout`, which records the exposure first. */
export function requireNoHoldoutExposure(tuning: Tuning | null, jobKind: EvaluatedJobKind, partition: string, tuningFolder: string): void {
  if (partition === "development" || !isCandidate(tuning, jobKind, tuningFolder)) return;
  throw new SetupError(`The candidate ${tuningId(tuning!)} is not active, so a run of it on the ${partition} partition would use the holdout: start it with npm run eval -- tune holdout.`);
}
