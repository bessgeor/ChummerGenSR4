import type { ScenarioContext } from "../discovery/discovery-context.js";
import type { RankOutput, ScenarioOutput } from "../discovery/job-schemas.js";
import { validatePlan } from "../discovery/plan-validator.js";
import type { DiscoveryDatasetItem } from "./discovery-dataset.js";

export type DiscoveryScores = { readonly valid: boolean; readonly reached: boolean | null };

/** Whether an item's gold can decide `reached` at all. */
function hasGold(item: DiscoveryDatasetItem): boolean {
  if (item.gold === null) return false;
  return item.gold.kind === "scenario" || item.gold.proven.length + item.gold.notProven.length > 0;
}

/** A rank answer that passed validation is valid; it reaches when its best target that is not infeasible was proven, and fails when that target ran without proof. */
export function scoreRank(output: RankOutput, item: DiscoveryDatasetItem): DiscoveryScores {
  const best = output.rankings.filter((ranking) => ranking.feasibility !== "infeasible")
    .sort((left, right) => right.score - left.score || (left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0))[0];
  const gold = item.gold?.kind === "rank" ? item.gold : null;
  const reached = gold === null || best === undefined ? null : gold.proven.includes(best.targetId) ? true : gold.notProven.includes(best.targetId) ? false : null;
  return { valid: true, reached };
}

/** A scenario answer is valid when its plan passes the plan validator; it reaches when it is valid and selects every tab of the proven plan. */
export function scoreScenario(output: ScenarioOutput, item: DiscoveryDatasetItem, context: ScenarioContext, labels: readonly string[]): DiscoveryScores {
  const plan = output.plan;
  const valid = plan !== null && validatePlan(plan, { fixtures: context.fixtures, tabTexts: context.tabTexts, labels: new Set(labels) }).length === 0;
  const gold = item.gold?.kind === "scenario" ? item.gold : null;
  if (gold === null) return { valid, reached: null };
  const selected = new Set(plan?.actions.filter((action) => action.type === "selectTab").map((action) => action.name ?? "") ?? []);
  return { valid, reached: valid && gold.selectedTabs.every((tab) => selected.has(tab)) };
}

/** A failed job fails both metrics where the item can decide them. */
export function failedDiscoveryScores(item: DiscoveryDatasetItem): DiscoveryScores {
  return { valid: false, reached: hasGold(item) ? false : null };
}
