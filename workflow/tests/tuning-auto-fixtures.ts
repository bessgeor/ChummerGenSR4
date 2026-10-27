import { join } from "node:path";
import type { EvalContext } from "../src/evals/eval-commands.js";
import { workflowPaths } from "../src/paths.js";
import { newHypothesisRecords, resolveAutoTuning } from "../src/tuning/auto-tuning.js";
import type { TuningSteps } from "../src/tuning/tuning-graph.js";
import { tuningId } from "../src/tuning/tuning.js";
import { FakeAgents, hypothesisAnswer, type JobCall, type Reply } from "./diagnosis-harness.js";
import { scratch } from "./diagnosis-fixtures.js";
import { evalContext } from "./eval-fixtures.js";
import { twoThreads } from "./eval-threads.js";
import { tuning } from "./tuning-fixtures.js";

// With the automatic dataset's seed `auto` and a 50 % test share, the cluster at x 100 lies in test and the one at x 600 in development.
export const testCluster = "d-0000000000000100";
export const developmentCluster = "d-0000000000000600";
const spots = [{ case: "build-alpha", capture: "skills", x: 100 }, { case: "career-beta", capture: "common", x: 600 }];

export const proposal = (guidance: string) => ({ outcome: "candidate", reason: `Try: ${guidance}`, guidance: [guidance], context: "inline" });
const idOf = (guidance: string) => tuningId(tuning({ jobKind: "hypothesis", guidance: [guidance], context: "inline" }));

type Behaviour = "all" | "development" | "test" | "none";

/**
 * Agents whose tune job answers the next of `proposals`, and whose hypothesis jobs answer right on the clusters a
 * configuration's behaviour names: the code's prompt by `base`, a guidance line by `behaviours`.
 */
export function agents(proposals: unknown[], base: Behaviour, behaviours: Readonly<Record<string, Behaviour>>, hang?: (call: JobCall) => boolean) {
  let next = 0;
  return new FakeAgents((call): Reply => {
    if (call.kind === "tune") return { answer: proposals[next++] ?? { outcome: "abstain", reason: "Nothing left.", guidance: null, context: null } };
    if (hang?.(call) === true) return { hang: true };
    const configuration = /^PROMPT_VERSION=\S+?(?:\+(tuned-[0-9a-f]{12}))?\n/.exec(call.prompt)![1];
    const behaviour = configuration === undefined ? base : Object.entries(behaviours).find(([guidance]) => idOf(guidance) === configuration)?.[1] ?? "none";
    const development = call.prompt.includes(developmentCluster);
    const right = behaviour === "all" || (behaviour === "development" && development) || (behaviour === "test" && !development);
    return right ? { answer: hypothesisAnswer() } : { answer: { outcome: "abstain", reason: "No idea.", explanation: null } };
  });
}

/**
 * Two diagnosed threads' records in a store, and an evaluation context over them whose tuning is due with exactly those
 * records; its repository is `root`, by default a folder that is not one.
 */
export async function dueTuning(fake: FakeAgents, root = scratch("workflow-auto-"), overrides: Partial<EvalContext> = {}) {
  const threads = await twoThreads({ spots });
  const records = await newHypothesisRecords(threads.store, new Set());
  const paths = { ...workflowPaths(root), threadFolder: (id: string) => join(threads.root, "threads", id) };
  const context = evalContext({
    store: threads.store, paths, agents: () => fake, autoTuning: () => ({ ...resolveAutoTuning(undefined), every: records.length, minPass: 0.3 }), ...overrides,
  });
  return { context, records };
}

/** Steps that refuse to run: a graph compiled from them only reads its checkpoints. */
export function refusingSteps(): TuningSteps {
  const refuse = () => {
    throw new Error("a step ran");
  };
  return {
    count: refuse, freeze: refuse, worktree: refuse, baseline: refuse, propose: refuse, holdout: refuse, testBaseline: refuse, activate: refuse, conclude: refuse,
    commit: refuse, merge: refuse,
  };
}
