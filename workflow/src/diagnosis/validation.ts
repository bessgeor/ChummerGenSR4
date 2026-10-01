import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { ContextManifest } from "./context.js";
import type { ChallengeOutput, Explanation, HypothesisOutput } from "./job-schemas.js";

export const maximumLocations = 8;
export const maximumPredictions = 4;

function normalized(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** A snapshot-relative path with forward slashes, or null when it is absolute or leaves the snapshot. */
export function snapshotPath(path: string): string | null {
  const trimmed = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (trimmed.length === 0 || isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed)) return null;
  const clean = normalize(trimmed).replaceAll("\\", "/");
  return clean.startsWith("../") || clean === ".." ? null : clean;
}

/** The lines of a text: a final line break ends the last line, it does not start another. */
export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const parts = text.split(/\r?\n/);
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

function explanationErrors(explanation: Explanation, manifest: ContextManifest, snapshot: string, label: string): string[] {
  const errors: string[] = [];
  if (explanation.claim.trim().length === 0) errors.push(`${label}: the claim is empty`);
  if (explanation.evidence.trim().length === 0) errors.push(`${label}: the evidence is empty`);
  if (!(explanation.confidence >= 0 && explanation.confidence <= 1)) errors.push(`${label}: confidence ${explanation.confidence} is not between 0 and 1`);
  if (explanation.locations.length < 1 || explanation.locations.length > maximumLocations) {
    errors.push(`${label}: ${explanation.locations.length} locations, expected 1 to ${maximumLocations}`);
  }
  for (const location of explanation.locations) {
    const relative = snapshotPath(location.path);
    const file = relative === null ? null : join(snapshot, relative);
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${label}: location ${location.path} is not a file of the source snapshot`);
      continue;
    }
    if (location.line !== null) {
      const lines = lineCount(readFileSync(file, "utf8"));
      if (location.line < 1 || location.line > lines) errors.push(`${label}: line ${location.line} is outside ${location.path} (${lines} lines)`);
    }
  }
  if (explanation.predictions.length < 1 || explanation.predictions.length > maximumPredictions) {
    errors.push(`${label}: ${explanation.predictions.length} predictions, expected 1 to ${maximumPredictions}`);
  }
  const seen = new Set<string>();
  for (const prediction of explanation.predictions) {
    const key = `${prediction.case}/${prediction.capture}`;
    const known = manifest.vocabulary.find((entry) => entry.case === prediction.case)?.captures.includes(prediction.capture) ?? false;
    if (!known) errors.push(`${label}: prediction ${key} names no case and capture of the vocabulary`);
    if (seen.has(key)) errors.push(`${label}: prediction ${key} is repeated`);
    if (prediction.why.trim().length === 0) errors.push(`${label}: prediction ${key} gives no reason`);
    seen.add(key);
  }
  return errors;
}

/** The errors of a hypothesis answer against its context and the source snapshot; empty when it is valid. */
export function validateHypothesis(output: HypothesisOutput, manifest: ContextManifest, snapshot: string): string[] {
  const errors: string[] = [];
  if (output.reason.trim().length === 0) errors.push("the reason is empty");
  if (output.outcome === "abstain") {
    if (output.explanation !== null) errors.push("an abstention must not carry an explanation");
    return errors;
  }
  if (output.explanation === null) return [...errors, "a hypothesis needs an explanation"];
  return [...errors, ...explanationErrors(output.explanation, manifest, snapshot, "hypothesis")];
}

/**
 * The errors of a challenge answer: an alternative must be a valid explanation with another claim that predicts
 * at least one capture the hypothesis also predicts, with the other expectation.
 */
export function validateChallenge(output: ChallengeOutput, hypothesis: Explanation, manifest: ContextManifest, snapshot: string): string[] {
  const errors: string[] = [];
  if (output.reason.trim().length === 0) errors.push("the reason is empty");
  if (output.outcome === "no_alternative") {
    if (output.alternative !== null) errors.push("no_alternative must not carry an alternative");
    return errors;
  }
  const alternative = output.alternative;
  if (alternative === null) return [...errors, "an alternative needs an explanation"];
  errors.push(...explanationErrors(alternative, manifest, snapshot, "alternative"));
  if (normalized(alternative.claim) === normalized(hypothesis.claim)) errors.push("the alternative repeats the hypothesis's claim");
  if (discriminatingPredictions(hypothesis, alternative).length === 0) {
    errors.push("the alternative predicts no capture of the hypothesis with the other expectation, so no check can tell them apart");
  }
  return errors;
}

/** The captures both explanations predict, with different expectations. */
export function discriminatingPredictions(hypothesis: Explanation, alternative: Explanation): { case: string; capture: string }[] {
  return alternative.predictions
    .filter((prediction) => hypothesis.predictions.some((other) => other.case === prediction.case && other.capture === prediction.capture && other.expect !== prediction.expect))
    .map((prediction) => ({ case: prediction.case, capture: prediction.capture }));
}
