import { sha256Text } from "../steps/fingerprint.js";
import type { EvalRecord } from "./eval-record.js";
import { isGradable } from "./hindsight.js";
import { isRight } from "./root-cause.js";

export type QueueEntry = { readonly record: EvalRecord; readonly reason: "disagreement" | "sample" };

export type QueueOptions = { readonly seed: string; readonly perStratum: number };

export const defaultQueueOptions: QueueOptions = { seed: "review", perStratum: 3 };

/** A hypothesis whose check outcome and hindsight grade disagree: confirmed but not right, or refuted but right. */
export function isDisagreement(record: EvalRecord): boolean {
  const grade = record.labels.hindsight?.grade;
  if (record.jobKind !== "hypothesis" || grade === undefined) return false;
  return (record.labels.check === "confirmed" && !isRight(grade)) || (record.labels.check === "refuted" && isRight(grade));
}

/** The grader's least certain answers first; ungraded ones after every graded one. */
function uncertainty(record: EvalRecord): number {
  return record.labels.grader === null ? Number.POSITIVE_INFINITY : Math.abs(record.labels.grader.score - 0.5);
}

/**
 * The records waiting for a review verdict: every disagreement, and per job kind and check label the first
 * `perStratum` records in the seed's order. Disagreements first, then by the grader's uncertainty, then record ID.
 */
export function reviewQueue(records: readonly EvalRecord[], options: QueueOptions = defaultQueueOptions): QueueEntry[] {
  const open = records.filter((record) => isGradable(record) && record.labels.review === null);
  const chosen = new Map<string, QueueEntry>();
  for (const record of open.filter(isDisagreement)) chosen.set(record.recordId, { record, reason: "disagreement" });
  const strata = new Map<string, EvalRecord[]>();
  for (const record of open) {
    const key = `${record.jobKind}/${record.labels.check ?? "none"}`;
    strata.set(key, [...(strata.get(key) ?? []), record]);
  }
  for (const members of strata.values()) {
    const ordered = members
      .map((record) => ({ record, order: sha256Text(`${options.seed}:${record.recordId}`) }))
      .sort((left, right) => (left.order < right.order ? -1 : left.order > right.order ? 1 : 0))
      .slice(0, options.perStratum);
    for (const { record } of ordered) if (!chosen.has(record.recordId)) chosen.set(record.recordId, { record, reason: "sample" });
  }
  return [...chosen.values()].sort((left, right) =>
    Number(right.reason === "disagreement") - Number(left.reason === "disagreement")
    || uncertainty(left.record) - uncertainty(right.record)
    || (left.record.recordId < right.record.recordId ? -1 : left.record.recordId > right.record.recordId ? 1 : 0));
}

/** One line per queued record, for `npm run eval -- queue`. */
export function queueLines(queue: readonly QueueEntry[]): string[] {
  return [
    `Review queue: ${queue.length} records (${queue.filter((entry) => entry.reason === "disagreement").length} disagreements).`,
    ...queue.map(({ record, reason }) => `${reason === "disagreement" ? "!" : "-"} ${record.recordId} ${record.jobKind}; check ${record.labels.check ?? "none"}; `
      + `hindsight ${record.labels.hindsight?.grade ?? "none"}; grader ${record.labels.grader?.score ?? "none"}`),
  ];
}
