import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { BenchmarkItem } from "../evals/benchmark.js";
import type { QueueOptions } from "../evals/review-queue.js";

export type ReviewDependencies = {
  readonly store: BaseStore;
  readonly threadFolder: (threadId: string) => string;
  readonly benchmark: () => readonly BenchmarkItem[];
  readonly queue: QueueOptions;
  /** Who gives the verdicts: the OS user. */
  readonly reviewer: string;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};
