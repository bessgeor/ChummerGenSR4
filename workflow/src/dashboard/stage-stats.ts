import type { EvalRecord } from "../evals/eval-record.js";
import type { ActivityLine } from "./loop-documents.js";
import { isRoutingNode, nodeStage } from "./stages.js";
import { stageIds, type Count, type Duration, type StageId, type StageStats } from "./snapshot.js";

/** What a thread's documents contribute: its triage totals and its clusters' dispositions, each null when the document is absent. */
export type ThreadFacts = {
  readonly thread: string;
  readonly triage: { readonly discrepancies: number; readonly clusters: number; readonly newClusters: number } | null;
  readonly dispositions: readonly string[] | null;
};

/** Everything the stats are computed from, already limited to the selected loop's threads (or every thread). */
export type StatsInput = {
  /** Workflow threads in scope. */
  readonly threads: readonly ThreadFacts[];
  /** Threads whose triage or outcome could not be read: counted as left out. */
  readonly unreadableThreads: number;
  readonly records: readonly EvalRecord[];
  /** Finished tasks of the loop's activity log; null without a loop (or when the log cannot be read). */
  readonly activity: readonly ActivityLine[] | null;
  /** Tuning runs in scope, or null when unknown. */
  readonly tunings: number | null;
};

/** The nearest-rank 80th percentile. */
export function p80(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(0.8 * sorted.length) - 1]!;
}

/** The job kinds whose records stand in for a stage's tasks when the activity log has none. */
const recordKinds: Partial<Record<StageId, readonly EvalRecord["jobKind"][]>> = {
  diagnose: ["hypothesis", "challenge"], repair: ["repair"], discovery: ["rank", "scenario"], tune: ["tune"],
};

function duration(stage: StageId, input: StatsInput): Duration {
  const logged = (input.activity ?? []).filter((line) => !isRoutingNode(line.node) && nodeStage(line.graph, line.node) === stage)
    .map((line) => Math.max(0, Date.parse(line.finishedUtc) - Date.parse(line.startedUtc) - line.pausedMs));
  if (logged.length > 0) return { p80Ms: p80(logged), samples: logged.length, source: "activity" };
  const kinds = recordKinds[stage] ?? [];
  const recorded = input.records.filter((record) => record.origin === "workflow" && kinds.includes(record.jobKind)).map((record) => record.durationMs);
  if (recorded.length > 0) return { p80Ms: p80(recorded), samples: recorded.length, source: "records" };
  return { p80Ms: null, samples: 0, source: null };
}

const count = (name: string, value: Count, detail: string | null = null) => ({ name, value, detail });

function tally(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([left], [right]) => (left < right ? -1 : 1)).map(([value, n]) => `${n} ${value}`).join(" · ");
}

function sum(values: readonly number[]): Count {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

/** A note on the counts of thread documents when some could not be read. */
function leftOut(input: StatsInput): string | null {
  return input.unreadableThreads === 0 ? null : `leaves out ${input.unreadableThreads} unreadable ${input.unreadableThreads === 1 ? "thread" : "threads"}`;
}

/** Repair records grouped by thread and cluster: one group per hypothesis that reached repair. */
function repairGroups(records: readonly EvalRecord[]): EvalRecord[][] {
  const groups = new Map<string, EvalRecord[]>();
  for (const record of records) {
    if (record.jobKind !== "repair") continue;
    const key = `${record.threadId}\u0000${record.subject.id}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()];
}

function counts(stage: StageId, input: StatsInput): StageStats["counts"] {
  const workflow = input.records.filter((record) => record.origin === "workflow");
  const triaged = input.threads.flatMap((thread) => (thread.triage === null ? [] : [thread.triage]));
  switch (stage) {
    case "start":
      return [count("threads", input.threads.length)];
    case "capture":
      return [
        count("discrepancies", sum(triaged.map((triage) => triage.discrepancies)), leftOut(input)),
        count("clusters", sum(triaged.map((triage) => triage.clusters)), triaged.length === 0 ? null : `${sum(triaged.map((triage) => triage.newClusters))} new`),
      ];
    case "discovery": {
      const scenarios = workflow.filter((record) => record.jobKind === "scenario");
      const labelled = scenarios.filter((record) => record.labels.discovery !== null);
      return [
        count("discoveries", labelled.length === 0 ? null : labelled.filter((record) => record.labels.discovery?.outcome === "proven").length,
          labelled.length === 0 ? null : `of ${scenarios.length} scenarios`),
      ];
    }
    case "diagnose": {
      const hypotheses = workflow.filter((record) => record.jobKind === "hypothesis");
      return [count("hypotheses", hypotheses.length === 0 ? null : hypotheses.length, tally(hypotheses.flatMap((record) => record.labels.check ?? [])))];
    }
    case "repair": {
      const groups = repairGroups(workflow);
      const rejected = groups.map((group) => group.filter((record) => record.labels.repair?.outcome === "rejected").length);
      const tries = groups.reduce((total, group) => total + group.length, 0);
      return [
        count("rejections per hypothesis", groups.length === 0 ? null : (sum(rejected) ?? 0) / groups.length,
          groups.length === 0 ? null : `max ${Math.max(...rejected)} · ${sum(rejected)} rejected of ${tries} tries`),
      ];
    }
    case "widen": {
      const groups = repairGroups(workflow);
      const widened = groups.map((group) => group.filter((record) => record.labels.widening !== null));
      const promoted = widened.filter((group) => group.some((record) => record.labels.widening?.outcome === "promoted")).length;
      const ended = widened.filter((group) => !group.some((record) => record.labels.widening?.outcome === "promoted"));
      return [
        count("widenings before rejection", ended.length === 0 ? null : (sum(ended.map((group) => group.length)) ?? 0) / ended.length,
          widened.flat().length === 0 ? null : `${widened.flat().length} widenings · ${promoted} promoted`),
      ];
    }
    case "conclude": {
      const concluded = input.threads.flatMap((thread) => (thread.dispositions === null ? [] : [thread.dispositions]));
      const all = concluded.flat();
      return [
        count("fixes merged", concluded.length === 0 ? null : all.filter((disposition) => disposition === "fixed").length,
          concluded.length === 0 ? null : `${all.filter((disposition) => disposition === "merge_failed").length} merges failed · ${concluded.length} threads concluded`),
      ];
    }
    case "tune":
      return [count("tunings run", input.tunings)];
  }
}

/** Each stage's p80 and counts. */
export function stageStats(input: StatsInput): Record<StageId, StageStats> {
  return Object.fromEntries(stageIds.map((stage) => [stage, { duration: duration(stage, input), counts: counts(stage, input) }])) as Record<StageId, StageStats>;
}
