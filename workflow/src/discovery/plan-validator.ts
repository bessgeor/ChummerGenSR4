import type { ContextFixture } from "./discovery-context.js";
import type { Plan, PlanAction } from "./job-schemas.js";
import type { ScenarioAction } from "./registry-document.js";

export const maximumActions = 24;
export const maximumCaptures = 4;
export const maximumWaitMilliseconds = 10_000;
const captureName = /^[a-z0-9][a-z0-9-]*$/;

/** What a plan may name: the fixture cases, the tab texts by form class and the `waitFor` labels. */
export type PlanVocabulary = {
  readonly fixtures: readonly Pick<ContextFixture, "case" | "form">[];
  readonly tabTexts: Readonly<Record<string, readonly string[]>>;
  readonly labels: ReadonlySet<string>;
};

/** The fields each action type takes; every other field must be null. */
const fields: Readonly<Record<PlanAction["type"], readonly ("name" | "label" | "milliseconds")[]>> = {
  selectTab: ["name"], waitFor: ["label"], wait: ["milliseconds"], capture: ["name"], include: [],
};

function actionReasons(action: PlanAction, index: number, form: string | null, vocabulary: PlanVocabulary): string[] {
  const where = `action ${index + 1} (${action.type})`;
  if (action.type === "include") return [`${where}: include is not a plan action; write the actions out`];
  const reasons: string[] = [];
  for (const field of ["name", "label", "milliseconds"] as const) {
    const wanted = fields[action.type].includes(field);
    if (wanted && action[field] === null) reasons.push(`${where}: it needs ${field}`);
    if (!wanted && action[field] !== null) reasons.push(`${where}: it takes no ${field}`);
  }
  if (action.optional !== null) reasons.push(`${where}: optional is not allowed in a plan`);
  if (action.type === "selectTab" && action.name !== null && form !== null && !(vocabulary.tabTexts[form] ?? []).includes(action.name)) {
    reasons.push(`${where}: '${action.name}' is not a known tab text of ${form}`);
  }
  if (action.type === "waitFor" && action.label !== null && !vocabulary.labels.has(action.label)) reasons.push(`${where}: '${action.label}' is not a known label`);
  if (action.type === "wait" && action.milliseconds !== null
    && (!Number.isInteger(action.milliseconds) || action.milliseconds < 0 || action.milliseconds > maximumWaitMilliseconds)) {
    reasons.push(`${where}: ${action.milliseconds} ms is not a whole number from 0 to ${maximumWaitMilliseconds}`);
  }
  if (action.type === "capture" && action.name !== null && !captureName.test(action.name)) {
    reasons.push(`${where}: the capture name '${action.name}' is not lower-case letters, digits and dashes`);
  }
  return reasons;
}

/** Every reason a plan breaks the action vocabulary; empty for a valid plan, which alone may use the desktop lane. */
export function validatePlan(plan: Plan, vocabulary: PlanVocabulary): string[] {
  const reasons: string[] = [];
  const fixture = vocabulary.fixtures.find((item) => item.case === plan.case);
  if (fixture === undefined) reasons.push(`the case '${plan.case}' is not a fixture case of the case file`);
  if (plan.actions.length > maximumActions) reasons.push(`${plan.actions.length} actions, at most ${maximumActions} allowed`);
  plan.actions.forEach((action, index) => reasons.push(...actionReasons(action, index, fixture?.form ?? null, vocabulary)));
  const captures = plan.actions.filter((action) => action.type === "capture").map((action) => action.name ?? "");
  if (captures.length < 1 || captures.length > maximumCaptures) reasons.push(`${captures.length} captures, expected 1 to ${maximumCaptures}`);
  const repeated = [...new Set(captures.filter((name, index) => captures.indexOf(name) !== index))];
  if (repeated.length > 0) reasons.push(`capture names used twice: ${repeated.join(", ")}`);
  if (plan.actions.length > 0 && plan.actions.at(-1)!.type !== "capture") reasons.push("the plan does not end with a capture");
  return reasons;
}

/** A valid plan's actions as a case file states them. */
export function scenarioActions(plan: Plan): ScenarioAction[] {
  return plan.actions.map((action): ScenarioAction => {
    switch (action.type) {
      case "selectTab": return { type: "selectTab", name: action.name! };
      case "waitFor": return { type: "waitFor", label: action.label! };
      case "wait": return { type: "wait", milliseconds: action.milliseconds! };
      case "capture": return { type: "capture", name: action.name! };
      default: throw new Error(`An ${action.type} action is not part of a valid plan.`);
    }
  });
}
