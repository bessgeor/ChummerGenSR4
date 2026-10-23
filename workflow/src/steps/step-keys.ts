import type { PlannedCase } from "../cases/case-plan.js";
import type { RunOptions } from "../options/run-options.js";
import { sha256Lines } from "./fingerprint.js";
import type { InputFingerprints } from "./input-fingerprints.js";

/** Bumped whenever the meaning of a step or its key lines changes, so older records miss. */
export const stepFormatVersion = 1;

export type StepKey = { readonly key: string; readonly lines: readonly string[] };

function key(lines: string[]): StepKey {
  return { key: sha256Lines(lines), lines };
}

/**
 * `environment` is the capture runner's fingerprint of what else decides the pixels: the screens and their scale,
 * the OS build, the Windows colour and text settings and the app's own options.
 */
export function captureKey(
  item: PlannedCase,
  fixtureSha256: string,
  environment: string,
  options: Pick<RunOptions, "threshold" | "canonicalCache">,
  fingerprints: InputFingerprints,
): StepKey {
  return key([
    `format:capture/${stepFormatVersion}`,
    `case:${item.name}`,
    `entry:${JSON.stringify({ characterFile: item.characterFile, mode: item.mode })}`,
    `actions:${JSON.stringify(item.actions)}`,
    `timing:${item.startupDelaySeconds}s/${item.settleMilliseconds}ms`,
    `fixture:${fixtureSha256}`,
    `environment:${environment}`,
    `captures:${item.captureFilter === null ? "*" : [...item.captureFilter].sort().join(",")}`,
    `threshold:${options.threshold ?? "default"}`,
    `canonical-exe:${fingerprints.canonicalExecutable}`,
    `canonical-support:${fingerprints.canonicalSupport}`,
    `candidate:${fingerprints.candidate}`,
    `overlay:${fingerprints.overlay}`,
    `canonical:${options.canonicalCache === null ? "live" : "cache"}`,
    `capture-tools:${fingerprints.captureTools}`,
  ]);
}

export function compareKey(
  captureStepKey: string,
  resultsSha256: string,
  coverageSha256: string,
  options: Pick<RunOptions, "noOcr">,
  fingerprints: Pick<InputFingerprints, "compareTools" | "tessdata">,
): StepKey {
  return key([
    `format:compare/${stepFormatVersion}`,
    `capture-step:${captureStepKey}`,
    `results:${resultsSha256}`,
    `coverage:${coverageSha256}`,
    `ocr:${options.noOcr ? "off" : "on"}`,
    `tessdata:${fingerprints.tessdata}`,
    `compare-tools:${fingerprints.compareTools}`,
  ]);
}
