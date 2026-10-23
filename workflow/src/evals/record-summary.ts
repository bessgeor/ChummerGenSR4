import type { EvalRecord } from "./eval-record.js";

function tally(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts.size === 0 ? "none" : [...counts].sort(([left], [right]) => (left < right ? -1 : 1)).map(([value, count]) => `${value} ${count}`).join(", ");
}

/** Lines that count the records by origin and job kind, with their results and each label kind. */
export function recordSummary(records: readonly EvalRecord[]): string[] {
  const lines = [`Eval records: ${records.length}.`];
  const groups = new Map<string, EvalRecord[]>();
  for (const record of records) {
    const key = `${record.origin} ${record.jobKind}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const [key, group] of [...groups].sort(([left], [right]) => (left < right ? -1 : 1))) {
    lines.push(`${key}: ${group.length}; results ${tally(group.map((record) => record.result.status))}`);
    lines.push(`  check ${tally(group.flatMap((record) => record.labels.check ?? []))}; hindsight ${tally(group.flatMap((record) => record.labels.hindsight?.grade ?? []))}; `
      + `review ${tally(group.flatMap((record) => record.labels.review?.verdict ?? []))}; graded ${group.filter((record) => record.labels.grader !== null).length}`
      + (key.endsWith(" repair") ? `; repair ${tally(group.flatMap((record) => (record.labels.repair === null ? [] : [record.labels.repair.stage ?? record.labels.repair.outcome])))}` : ""));
  }
  return lines;
}
