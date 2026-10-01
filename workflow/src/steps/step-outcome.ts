import type { RunOptions } from "../options/run-options.js";
import type { InputFingerprints } from "./input-fingerprints.js";

/** `run` executes a step unless a valid record exists; `reuse-only` requires the record. */
export type StepMode = "run" | "reuse-only";

export type StepContext = {
  readonly threadId: string;
  readonly options: RunOptions;
  readonly fingerprints: InputFingerprints;
  readonly mode: StepMode;
  /** Aborts when the run stops (another step of the same super-step failed); running children are killed. */
  readonly signal?: AbortSignal;
};

/** What a capture or compare step produced for one case. */
export type StepOutcome = {
  readonly case: string;
  /** 0 passed or clear, 1 differences, 2 execution or analysis failures. */
  readonly status: 0 | 1 | 2;
  readonly runFolder: string;
  readonly key: string;
  /** The thread whose step is reused, or null when the step ran in this thread. */
  readonly reusedFrom: string | null;
};

/** The status as a finished run's status, or null for a setup error or anything a tool never returns. */
export function finishedStatus(status: number): 0 | 1 | 2 | null {
  return status === 0 || status === 1 || status === 2 ? status : null;
}
