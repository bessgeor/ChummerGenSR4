import type { RankContext, ScenarioContext } from "./discovery-context.js";
import type { RankOutput, ScenarioOutput } from "./job-schemas.js";
import type { Target } from "./targets.js";

/** Every reason a rank answer does not rank each target of its context exactly once with a valid score, case and reason. */
export function validateRank(output: RankOutput, context: Pick<RankContext, "targets" | "fixtures">): string[] {
  const errors: string[] = [];
  const known = new Set(context.targets.map((target) => target.id));
  const cases = new Set(context.fixtures.map((fixture) => fixture.case));
  const seen = new Set<string>();
  for (const ranking of output.rankings) {
    const label = `ranking of ${ranking.targetId}`;
    if (!known.has(ranking.targetId)) errors.push(`${label}: no such target`);
    if (seen.has(ranking.targetId)) errors.push(`${label}: the target is ranked twice`);
    seen.add(ranking.targetId);
    if (!(ranking.score >= 0 && ranking.score <= 1)) errors.push(`${label}: score ${ranking.score} is not between 0 and 1`);
    if (ranking.case !== null && !cases.has(ranking.case)) errors.push(`${label}: '${ranking.case}' is not a fixture case`);
    if (ranking.reason.trim().length === 0) errors.push(`${label}: the reason is empty`);
  }
  const missing = [...known].filter((id) => !seen.has(id));
  if (missing.length > 0) errors.push(`targets not ranked: ${missing.join(", ")}`);
  return errors;
}

/** The control names a scenario may expect to show for a target: its controls, or its tab control and pages. */
export function expectableControls(target: Target): Set<string> {
  return new Set([...target.controls.map((control) => control.name), ...(target.tabControl === null ? [] : [target.tabControl.name, ...target.tabControl.pages.map((page) => page.name)])]);
}

/** Every reason a scenario answer's references are wrong: a plan with an unknown case or an expected control outside the target. */
export function validateScenario(output: ScenarioOutput, context: Pick<ScenarioContext, "target" | "fixtures">): string[] {
  const errors: string[] = [];
  if (output.reason.trim().length === 0) errors.push("the reason is empty");
  if (output.outcome === "abstain") {
    if (output.plan !== null) errors.push("an abstention has no plan");
    return errors;
  }
  if (output.plan === null) return [...errors, "outcome plan needs a plan"];
  if (!context.fixtures.some((fixture) => fixture.case === output.plan!.case)) errors.push(`the case '${output.plan.case}' is not a fixture case`);
  const expectable = expectableControls(context.target);
  const outside = output.plan.expect.filter((name) => !expectable.has(name));
  if (outside.length > 0) errors.push(`expected controls outside the target ${context.target.id}: ${outside.join(", ")}`);
  return errors;
}
