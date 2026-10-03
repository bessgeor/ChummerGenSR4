import type { ScenarioContext } from "../discovery/discovery-context.js";
import type { RankOutput, ScenarioOutput } from "../discovery/job-schemas.js";
import { selectedTabNames, validatePlan } from "../discovery/plan-validator.js";
import { selectableRankings } from "../discovery/validation.js";
import type { DiscoveryDatasetItem } from "./discovery-dataset.js";

/** `valid` is null for an abstention, which has no plan to judge; `reached` is null where the item's gold cannot decide it. */
export type DiscoveryScores = { readonly valid: boolean | null; readonly reached: boolean | null };

/** Whether an item's gold can decide `reached` at all. */
function hasGold(item: DiscoveryDatasetItem): boolean {
  if (item.gold === null) return false;
  return item.gold.kind === "scenario" || item.gold.proven.length + item.gold.notProven.length > 0;
}

/**
 * A rank answer that passed validation is valid; it reaches when the target selection would take first was proven, and fails when that target ran
 * without proof or, on an item whose gold can decide it, when it leaves no target to take.
 */
export function scoreRank(output: RankOutput, item: DiscoveryDatasetItem): DiscoveryScores {
  const best = selectableRankings(output)[0];
  const gold = item.gold?.kind === "rank" ? item.gold : null;
  const reached = gold === null ? null : best === undefined ? hasGold(item) ? false : null : gold.proven.includes(best.targetId) ? true : gold.notProven.includes(best.targetId) ? false : null;
  return { valid: true, reached };
}

/**
 * A scenario plan is valid when it passes the plan validator; an abstention has no validity. An answer reaches when its plan is
 * valid, uses the proven plan's fixture case and selects every tab it selected; an abstention on an item with a proven plan does not.
 */
export function scoreScenario(output: ScenarioOutput, item: DiscoveryDatasetItem, context: ScenarioContext, labels: readonly string[]): DiscoveryScores {
  const plan = output.plan;
  const valid = plan === null ? null : validatePlan(plan, { fixtures: context.fixtures, tabTexts: context.tabTexts, labels: new Set(labels) }).length === 0;
  const gold = item.gold?.kind === "scenario" ? item.gold : null;
  if (gold === null) return { valid, reached: null };
  const selected = new Set(plan === null ? [] : selectedTabNames(plan.actions));
  return { valid, reached: valid === true && plan!.case === gold.case && gold.selectedTabs.every((tab) => selected.has(tab)) };
}

/** A failed job fails both metrics where the item can decide them. */
export function failedDiscoveryScores(item: DiscoveryDatasetItem): DiscoveryScores {
  return { valid: false, reached: hasGold(item) ? false : null };
}
