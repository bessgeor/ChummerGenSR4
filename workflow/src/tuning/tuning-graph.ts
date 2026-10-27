import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AutoTuningSettings } from "./auto-tuning.js";
import { proposalsPending, type Cycle, type CycleOptions } from "./cycle.js";
import type { TuningWorkspace } from "./tuning-workspace.js";

/** What a tuning thread was started for: an automatic tuning with the records it counts, or a `tune cycle` on a dataset. */
export type TuningRequest =
  | { readonly kind: "auto"; readonly records: readonly string[]; readonly forced: boolean; readonly settings: AutoTuningSettings }
  | { readonly kind: "cycle"; readonly options: CycleOptions };

export const TuningState = Annotation.Root({
  /** The thread's ID: the tuning's (`tune-…`), or the cycle's for a `tune cycle`. */
  tuningId: Annotation<string>(),
  request: Annotation<TuningRequest>(),
  /** The dataset version the cycle runs on: the frozen one of an automatic tuning, the given one of a `tune cycle`. */
  dataset: Annotation<string | null>(),
  /** The cycle's `cycle.json` after the latest step that read it. */
  cycle: Annotation<Cycle | null>(),
  /** The cycle's outcome once the thread concluded. */
  concluded: Annotation<Cycle | null>(),
  /** The worktree an automatic tuning's cycle works in; null when it works on its folders in place. */
  workspace: Annotation<TuningWorkspace | null>(),
  /** The commit of the cycle's files on its tuning branch, null when nothing changed, and its merge commit. */
  tuningCommit: Annotation<string | null>(),
  mergeCommit: Annotation<string | null>(),
});
export type TuningStateValue = typeof TuningState.State;

/** The work behind the tuning graph's nodes; each reads and writes the cycle's `cycle.json` and returns it. */
export interface TuningSteps {
  /** Records the automatic tuning as in progress with the records it counts. */
  count(state: TuningStateValue): void;
  /** Freezes the next version of the automatic dataset, or returns the one the tuning recorded. */
  freeze(state: TuningStateValue): Promise<string>;
  /** Adds the cycle's worktree when the tuning or certificates folder lies inside the repository; null when neither does. */
  worktree(state: TuningStateValue): TuningWorkspace | null;
  /** Records the cycle when it is new, then runs its development baseline. */
  baseline(state: TuningStateValue): Promise<Cycle>;
  /** One proposal, its development run and comparison. */
  propose(state: TuningStateValue): Promise<Cycle>;
  holdout(state: TuningStateValue): Promise<Cycle>;
  testBaseline(state: TuningStateValue): Promise<Cycle>;
  activate(state: TuningStateValue): Cycle;
  /** The cycle's final document, which the caller of the thread ends the tuning with. */
  conclude(state: TuningStateValue): Cycle;
  /** Commits the changes of the worktree's folders on the tuning branch; null when nothing changed. */
  commit(state: TuningStateValue): string | null;
  /** Removes the worktree and merges the commit, when there is one, into the branch the tuning started from. */
  merge(state: TuningStateValue): string | null;
}

export type TuningNode = "count" | "freeze" | "worktree" | "baseline" | "propose" | "holdout" | "test_baseline" | "activate" | "conclude" | "commit" | "merge";

/** After a cycle step: the next step while the cycle runs, else the conclusion. */
export function afterStep(next: TuningNode) {
  return (state: TuningStateValue): TuningNode => (state.cycle?.outcome === "running" ? next : "conclude");
}

/** After a proposal pass: another pass while a proposal is to make or a candidate to measure, then the holdout. */
export function afterProposal(state: TuningStateValue): TuningNode {
  if (state.cycle?.outcome !== "running") return "conclude";
  return proposalsPending(state.cycle) ? "propose" : "holdout";
}

/**
 * count → freeze → worktree → baseline → propose ⟲ → holdout → test_baseline → activate → conclude → commit → merge. A
 * `tune cycle` thread starts at baseline and ends at the conclusion, and so does a tuning without a worktree. A step that
 * ends the cycle (a failed tune job, no candidate past the development gate, a refused holdout) routes to the
 * conclusion. Each step records its runs in `cycle.json` before they start, so an interrupted node resumes its run, and
 * a finished node is never repeated.
 */
export function buildTuningGraph(steps: TuningSteps) {
  return new StateGraph(TuningState)
    .addNode("count", (state: TuningStateValue) => {
      steps.count(state);
      return {};
    })
    .addNode("freeze", async (state: TuningStateValue) => ({ dataset: await steps.freeze(state) }))
    .addNode("worktree", (state: TuningStateValue) => ({ workspace: steps.worktree(state) }))
    .addNode("baseline", async (state: TuningStateValue) => ({ cycle: await steps.baseline(state) }))
    .addNode("propose", async (state: TuningStateValue) => ({ cycle: await steps.propose(state) }))
    .addNode("holdout", async (state: TuningStateValue) => ({ cycle: await steps.holdout(state) }))
    .addNode("test_baseline", async (state: TuningStateValue) => ({ cycle: await steps.testBaseline(state) }))
    .addNode("activate", (state: TuningStateValue) => ({ cycle: steps.activate(state) }))
    .addNode("conclude", (state: TuningStateValue) => ({ concluded: steps.conclude(state) }))
    .addNode("commit", (state: TuningStateValue) => ({ tuningCommit: steps.commit(state) }))
    .addNode("merge", (state: TuningStateValue) => ({ mergeCommit: steps.merge(state) }))
    .addConditionalEdges(START, (state: TuningStateValue) => (state.request.kind === "auto" ? "count" : "baseline"), ["count", "baseline"])
    .addEdge("count", "freeze")
    .addEdge("freeze", "worktree")
    .addEdge("worktree", "baseline")
    .addConditionalEdges("baseline", afterStep("propose"), ["propose", "conclude"])
    .addConditionalEdges("propose", afterProposal, ["propose", "holdout", "conclude"])
    .addConditionalEdges("holdout", afterStep("test_baseline"), ["test_baseline", "conclude"])
    .addConditionalEdges("test_baseline", afterStep("activate"), ["activate", "conclude"])
    .addEdge("activate", "conclude")
    .addConditionalEdges("conclude", (state: TuningStateValue) => (state.workspace === null || state.workspace === undefined ? END : "commit"), ["commit", END])
    .addEdge("commit", "merge")
    .addEdge("merge", END);
}
