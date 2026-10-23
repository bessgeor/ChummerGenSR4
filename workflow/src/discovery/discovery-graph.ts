import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { QuotaWaitMark } from "../diagnosis/cluster-diagnosis.js";
import { DiscoveryState, type Concluded, type DiscoveryOptions, type DiscoveryStateValue, type Execution, type JobState, type Prepared, type Registered, type ScenarioJob, type ScenarioUpdate, type TargetTask } from "./discovery-state.js";
import type { RankOutput } from "./job-schemas.js";

/** The host work behind the discovery graph's nodes. */
export interface DiscoverySteps {
  prepare(threadId: string, options: DiscoveryOptions, signal?: AbortSignal): Promise<Prepared>;
  rank(state: DiscoveryStateValue, store: BaseStore, signal?: AbortSignal): Promise<{ rank: JobState<RankOutput>; chargedMs: number }>;
  select(state: DiscoveryStateValue): Promise<{ selected: string[]; scenarios: Record<string, ScenarioJob> }>;
  scenario(state: DiscoveryStateValue, targetId: string, store: BaseStore, signal?: AbortSignal): Promise<{ update: ScenarioUpdate; chargedMs: number }>;
  waitForQuota(marks: readonly QuotaWaitMark[], signal?: AbortSignal): Promise<void>;
  validate(state: DiscoveryStateValue): Record<string, ScenarioUpdate>;
  execute(state: DiscoveryStateValue, signal?: AbortSignal): Promise<Execution>;
  register(state: DiscoveryStateValue, store: BaseStore): Promise<Registered>;
  conclude(state: DiscoveryStateValue): Concluded;
}

function requireStore(config: LangGraphRunnableConfig): BaseStore {
  if (config.store === undefined) throw new Error("The discovery graph was compiled without a store.");
  return config.store;
}

/** After the rank job: wait for its quota, run it, select, or conclude when it failed or found no budget. */
export function rankRoute(rank: JobState<RankOutput>): "rank" | "wait_for_rank_quota" | "select" | "conclude" {
  if (rank.waiting !== null) return "wait_for_rank_quota";
  if (rank.status === "pending") return "rank";
  return rank.status === "done" ? "select" : "conclude";
}

/** After the scenario jobs: wait when one hit a usage limit, run the pending ones side by side, else validate. */
export function scenarioRoute(scenarios: Readonly<Record<string, ScenarioJob>>): { kind: "wait" } | { kind: "run"; targets: string[] } | { kind: "validate" } {
  const all = Object.values(scenarios);
  if (all.some((job) => job.waiting !== null)) return { kind: "wait" };
  const pending = all.filter((job) => job.status === "pending").sort((left, right) => left.index - right.index).map((job) => job.targetId);
  return pending.length > 0 ? { kind: "run", targets: pending } : { kind: "validate" };
}

/**
 * prepare → rank → select → scenario (one per selected target, side by side) → validate → execute (when a plan is valid) →
 * register → conclude. A usage limit routes to a wait node and back; each job is one task, so a resumed thread repeats only
 * the jobs that did not finish.
 */
export function buildDiscoveryGraph(steps: DiscoverySteps) {
  return new StateGraph(DiscoveryState)
    .addNode("prepare", async (state: DiscoveryStateValue, config: LangGraphRunnableConfig) => ({ prepared: await steps.prepare(state.threadId, state.options, config.signal) }))
    .addNode("route_rank", () => ({}))
    .addNode("rank", async (state: DiscoveryStateValue, config: LangGraphRunnableConfig) => {
      const step = await steps.rank(state, requireStore(config), config.signal);
      return { rankJob: step.rank, agentMilliseconds: step.chargedMs };
    })
    .addNode("wait_for_rank_quota", async (state: DiscoveryStateValue, config: LangGraphRunnableConfig) => {
      await steps.waitForQuota([state.rankJob.waiting!], config.signal);
      return { rankJob: { ...state.rankJob, waiting: null } };
    })
    .addNode("select", async (state: DiscoveryStateValue) => steps.select(state))
    .addNode("route_scenarios", () => ({}))
    .addNode("scenario", async (state: TargetTask, config: LangGraphRunnableConfig) => {
      const step = await steps.scenario(state, state.targetId, requireStore(config), config.signal);
      return { scenarios: { [state.targetId]: step.update }, agentMilliseconds: step.chargedMs };
    })
    .addNode("wait_for_scenario_quota", async (state: DiscoveryStateValue, config: LangGraphRunnableConfig) => {
      const waiting = Object.values(state.scenarios).filter((job) => job.waiting !== null);
      await steps.waitForQuota(waiting.map((job) => job.waiting!), config.signal);
      return { scenarios: Object.fromEntries(waiting.map((job) => [job.targetId, { targetId: job.targetId, waiting: null }])) };
    })
    .addNode("validate", (state: DiscoveryStateValue) => ({ scenarios: steps.validate(state) }))
    .addNode("execute", async (state: DiscoveryStateValue, config: LangGraphRunnableConfig) => ({ execution: await steps.execute(state, config.signal) }))
    .addNode("register", async (state: DiscoveryStateValue, config: LangGraphRunnableConfig) => ({ registered: await steps.register(state, requireStore(config)) }))
    .addNode("conclude", (state: DiscoveryStateValue) => ({ concluded: steps.conclude(state) }))
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", (state: DiscoveryStateValue) => (state.prepared?.rankContext == null ? "conclude" : "route_rank"), ["route_rank", "conclude"])
    .addConditionalEdges("route_rank", (state: DiscoveryStateValue) => rankRoute(state.rankJob), ["rank", "wait_for_rank_quota", "select", "conclude"])
    .addEdge("rank", "route_rank")
    .addEdge("wait_for_rank_quota", "route_rank")
    .addEdge("select", "route_scenarios")
    .addConditionalEdges("route_scenarios", (state: DiscoveryStateValue) => {
      const route = scenarioRoute(state.scenarios);
      if (route.kind === "wait") return "wait_for_scenario_quota";
      if (route.kind === "validate") return "validate";
      return route.targets.map((targetId) => new Send("scenario", { ...state, targetId }));
    }, ["scenario", "wait_for_scenario_quota", "validate"])
    // Plain edges: the router runs once after every job of the step finished, and sees all their writes.
    .addEdge("scenario", "route_scenarios")
    .addEdge("wait_for_scenario_quota", "route_scenarios")
    .addConditionalEdges("validate", (state: DiscoveryStateValue) => (Object.values(state.scenarios).some((job) => job.validation !== null && job.validation.length === 0) ? "execute" : "register"),
      ["execute", "register"])
    .addEdge("execute", "register")
    .addEdge("register", "conclude")
    .addEdge("conclude", END);
}
