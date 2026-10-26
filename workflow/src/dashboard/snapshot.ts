// The dashboard's snapshot, shared by the server and the React client: types only, so the client bundle imports nothing of the server.

export const stageIds = ["start", "capture", "discovery", "diagnose", "repair", "widen", "conclude", "tune"] as const;
export type StageId = (typeof stageIds)[number];

export const graphKinds = ["loop", "workflow", "discovery", "tuning"] as const;
export type GraphKind = (typeof graphKinds)[number];

/** A number the page shows, or null when there is no data for it (shown as missing, never as zero). */
export type Count = number | null;

export type Duration = {
  /** The nearest-rank 80th percentile, in milliseconds; null without samples. */
  readonly p80Ms: number | null;
  readonly samples: number;
  /** Where the samples came from: the loop's activity log, or the eval records' job durations. */
  readonly source: "activity" | "records" | null;
};

export type StageStats = {
  readonly duration: Duration;
  /** The stage's counts by name, in the order the page shows them. */
  readonly counts: readonly { readonly name: string; readonly value: Count; readonly detail: string | null }[];
};

export type StageView = {
  readonly id: StageId;
  readonly title: string;
  /** The graph nodes this stage groups, as `<graph>:<node>`. */
  readonly nodes: readonly string[];
  readonly running: number;
  readonly paused: number;
  readonly stats: StageStats;
};

export type TaskView = {
  readonly graph: GraphKind;
  readonly thread: string;
  /** The nodes of the parent graphs that run the task, outermost first, such as its stage subgraph; empty for a node of the graph itself. */
  readonly path: readonly string[];
  readonly node: string;
  readonly stage: StageId | null;
  /** The case, cluster or discovery target the task works on, or null. */
  readonly subject: string | null;
  readonly lane: string | null;
  /** The creation of the checkpoint the task was scheduled from. */
  readonly sinceUtc: string;
  /** `paused`: the task stopped at an interrupt. */
  readonly state: "running" | "paused";
};

export const loopStatuses = ["running", "pausing", "paused", "ended", "stale"] as const;
export type LoopStatus = (typeof loopStatuses)[number];

export type LaneView = {
  readonly name: string;
  readonly paused: boolean;
  readonly busy: { readonly thread: string; readonly node: string; readonly subject: string | null } | null;
};

export type LoopView = {
  readonly id: string;
  readonly status: LoopStatus;
  readonly startedUtc: string;
  readonly endedUtc: string | null;
  /** How old the loop's state was when the snapshot was taken, in milliseconds; null without a state file. */
  readonly stateAgeMs: number | null;
  readonly paused: boolean;
  readonly lanes: readonly LaneView[];
  readonly threads: readonly { readonly thread: string; readonly graph: GraphKind; readonly startedUtc: string; readonly endedUtc: string | null; readonly reason: string | null }[];
};

/** A source the dashboard could not read: shown on the page, never treated as empty. */
export type Problem = { readonly source: string; readonly message: string };

export type Snapshot = {
  readonly generatedUtc: string;
  /** The loops, newest first. */
  readonly loops: readonly string[];
  /** The selected loop, or null when there is none and the stats cover every thread. */
  readonly loop: LoopView | null;
  /** Whether the running tasks are known to run: false without a loop, where an interrupted thread looks the same. */
  readonly live: boolean;
  readonly stages: readonly StageView[];
  readonly tasks: readonly TaskView[];
  readonly problems: readonly Problem[];
};

/** Each graph's own Mermaid drawing, from `getGraphAsync({ xray: true }).drawMermaid()`. */
export type GraphDrawings = Readonly<Partial<Record<GraphKind, string>>>;

/** What the page posts to pause or resume the loop (lane null) or one lane. */
export type ControlRequest = { readonly loop: string; readonly lane: string | null; readonly paused: boolean };
