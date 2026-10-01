import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { rootCauseOfItem, type BenchmarkItem } from "./benchmark.js";
import { listRecords, setLabels, type EvalRecord, type Grade } from "./eval-record.js";
import { explanationOf, gradeExplanation } from "./root-cause.js";

/** A workflow hypothesis or challenge that succeeded: an answer that can be graded. */
export function isGradable(record: EvalRecord): boolean {
  return record.origin === "workflow" && record.result.status === "succeeded" && (record.jobKind === "hypothesis" || record.jobKind === "challenge");
}

/** The benchmark item whose fix grades a record: the earliest fix of its cluster committed after the record finished. */
export function itemFor(record: EvalRecord, items: readonly BenchmarkItem[]): BenchmarkItem | null {
  const finished = Date.parse(record.finishedUtc);
  const covering = items
    .filter((item) => item.discrepancy.clusterId === record.subject.id && finished < Date.parse(item.fix.committedUtc))
    .sort((left, right) => Date.parse(left.fix.committedUtc) - Date.parse(right.fix.committedUtc) || (left.itemId < right.itemId ? -1 : 1));
  return covering[0] ?? null;
}

export type HindsightSummary = { readonly graded: number; readonly changed: number; readonly grades: Readonly<Record<Grade, number>> };

/** Grades every gradable record a benchmark item covers and stores the grades that changed. */
export async function labelHindsight(store: BaseStore, items: readonly BenchmarkItem[], now: () => Date): Promise<HindsightSummary> {
  const grades: Record<Grade, number> = { symbol: 0, file: 0, mechanism: 0, wrong: 0, abstained: 0 };
  let graded = 0;
  let changed = 0;
  for (const record of (await listRecords(store)).filter(isGradable)) {
    const item = itemFor(record, items);
    if (item === null) continue;
    const grade = gradeExplanation(explanationOf(record), rootCauseOfItem(item));
    graded++;
    grades[grade]++;
    if (record.labels.hindsight?.grade === grade && record.labels.hindsight.item === item.itemId) continue;
    await setLabels(store, record, { hindsight: { grade, item: item.itemId, labelledUtc: now().toISOString() } });
    changed++;
  }
  return { graded, changed, grades };
}
