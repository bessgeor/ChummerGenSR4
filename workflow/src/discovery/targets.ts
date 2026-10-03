import { z } from "zod";
import { selectionEvents } from "../inventory/coverage-manifest.js";
import type { CoverageManifest } from "../inventory/coverage-manifest-document.js";
import type { InventoryClass, InventoryControl, SourceInventory } from "../inventory/source-inventory-document.js";

/** The form a character opens in, by mode; the suite's cases show one of them. */
export const formOfMode = { build: "frmCreate", career: "frmCareer" } as const;

/** The mode whose cases open a class as their form, or null for any other class. */
export function modeOfForm(className: string): "build" | "career" | null {
  return className === formOfMode.build ? "build" : className === formOfMode.career ? "career" : null;
}

const PageSchema = z.strictObject({ tabControl: z.string().min(1), page: z.string().min(1), text: z.string().nullable() });
const TargetControlSchema = z.strictObject({ name: z.string().min(1), type: z.string().min(1), text: z.string().nullable() });

export const TargetSchema = z.strictObject({
  /** `<Class>/<page>/…` for a group of controls, or `<Class>.<tabControl>#selection` for a tab control's selection bindings. */
  id: z.string().min(1),
  kind: z.enum(["controls", "selection"]),
  class: z.string().min(1),
  /** The mode whose form the class is, or null for a class no case opens as its form. */
  mode: z.enum(["build", "career"]).nullable(),
  /** The tab pages that contain the target, outermost first. */
  pages: z.array(PageSchema),
  /** The unobserved controls of a `controls` target; empty for `selection`. */
  controls: z.array(TargetControlSchema),
  /** The tab control and its pages of a `selection` target; null for `controls`. */
  tabControl: z.strictObject({ name: z.string().min(1), pages: z.array(z.strictObject({ name: z.string().min(1), text: z.string().nullable() })) }).nullable(),
  /** The unexercised selection binding IDs of a `selection` target; empty for `controls`. */
  interactions: z.array(z.string().min(1)),
});
export type Target = z.infer<typeof TargetSchema>;
export type TargetPage = z.infer<typeof PageSchema>;

/** `targets.json`: what discovery may aim at, and what lies out of the action vocabulary's reach. */
export const TargetsDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baselineThread: z.string().min(1),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  targets: z.array(TargetSchema),
  /** Unobserved controls and unexercised selection bindings that registry entries for this source proved. */
  coveredByRegistry: z.strictObject({ controls: z.number().int().nonnegative(), interactions: z.number().int().nonnegative() }),
  /** Unexercised bindings of events no case-file action can raise, counted per event. */
  outOfReach: z.array(z.strictObject({ event: z.string().min(1), count: z.number().int().positive() })),
});
export type TargetsDocument = z.infer<typeof TargetsDocumentSchema>;

export type TargetInput = {
  readonly baselineThread: string;
  readonly inventory: SourceInventory;
  readonly manifest: CoverageManifest;
  /** Control and binding IDs that registry entries for the inventory's source proved. */
  readonly provedControls: ReadonlySet<string>;
  readonly provedInteractions: ReadonlySet<string>;
};

function isType(control: Pick<InventoryControl, "type">, name: string): boolean {
  return control.type === name || control.type.endsWith(`.${name}`);
}

/** The tab pages that contain a control, outermost first; a tab page contains itself. */
export function pageChain(item: InventoryClass, control: InventoryControl): TargetPage[] {
  const byName = new Map(item.controls.map((entry) => [entry.name, entry]));
  const chain: TargetPage[] = [];
  const seen = new Set<string>();
  for (let current: InventoryControl | undefined = control; current !== undefined; current = current.parent === null ? undefined : byName.get(current.parent)) {
    if (seen.has(current.name)) break;
    seen.add(current.name);
    if (isType(current, "TabPage") && current.parent !== null) chain.unshift({ tabControl: current.parent, page: current.name, text: current.text });
  }
  return chain;
}

function targetId(className: string, pages: readonly TargetPage[]): string {
  return pages.length === 0 ? `${className}/-` : `${className}/${pages.map((page) => page.page).join("/")}`;
}

/**
 * The targets of a baseline: unobserved controls of the active classes grouped by class and page chain, and tab controls
 * with unexercised selection bindings. What the registry proved for this source counts as covered.
 */
export function computeTargets(input: TargetInput): TargetsDocument {
  const statuses = new Map(input.manifest.controls.map((control) => [control.id, control.status]));
  const bindings = new Map(input.manifest.interactions.map((interaction) => [interaction.id, interaction.status]));
  const groups = new Map<string, Target>();
  const coveredByRegistry = { controls: 0, interactions: 0 };
  const outOfReach = new Map<string, number>();
  for (const item of input.inventory.classes) {
    const mode = modeOfForm(item.name);
    for (const control of item.controls) {
      if (statuses.get(`${item.name}.${control.name}`) !== "unobserved") continue;
      if (input.provedControls.has(`${item.name}.${control.name}`)) {
        coveredByRegistry.controls++;
        continue;
      }
      const pages = pageChain(item, control);
      const id = targetId(item.name, pages);
      const target = groups.get(id) ?? { id, kind: "controls" as const, class: item.name, mode, pages, controls: [], tabControl: null, interactions: [] };
      target.controls.push({ name: control.name, type: control.type, text: control.text });
      groups.set(id, target);
    }
    for (const interaction of item.interactions) {
      if (bindings.get(interaction.id) !== "unexercised") continue;
      const control = interaction.target === null ? undefined : item.controls.find((entry) => entry.name === interaction.target);
      const selection = control !== undefined && interaction.member === null && isType(control, "TabControl") && selectionEvents.has(interaction.event);
      if (!selection) {
        outOfReach.set(interaction.event, (outOfReach.get(interaction.event) ?? 0) + 1);
        continue;
      }
      if (input.provedInteractions.has(interaction.id)) {
        coveredByRegistry.interactions++;
        continue;
      }
      const id = `${item.name}.${control.name}#selection`;
      const target = groups.get(id) ?? {
        id, kind: "selection" as const, class: item.name, mode, pages: pageChain(item, control), controls: [],
        tabControl: { name: control.name, pages: item.controls.filter((entry) => entry.parent === control.name && isType(entry, "TabPage")).map((entry) => ({ name: entry.name, text: entry.text })) },
        interactions: [],
      };
      target.interactions.push(interaction.id);
      groups.set(id, target);
    }
  }
  return {
    schemaVersion: 1, baselineThread: input.baselineThread, sourceSha256: input.inventory.sourceSha256,
    targets: [...groups.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    coveredByRegistry,
    outOfReach: [...outOfReach].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([event, count]) => ({ event, count })),
  };
}
