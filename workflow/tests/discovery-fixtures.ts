import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCoverageManifest } from "../src/inventory/coverage-manifest.js";
import type { CoverageManifest, ExerciseProof, ManifestControl, ManifestInteraction } from "../src/inventory/coverage-manifest-document.js";
import type { InventoryControl, SourceInventory } from "../src/inventory/source-inventory-document.js";
import { inventory as baseInventory, scope } from "./inventory-fixtures.js";

export { scope };

function control(name: string, type: string, parent: string | null, text: string | null = null): InventoryControl {
  return { name, type, parent, line: 1, text, tag: null, contextMenu: null };
}

/** The inventory fixture with two detail labels on the armor page and a label beside the character tabs. */
export const inventory: SourceInventory = {
  ...baseInventory,
  classes: baseInventory.classes.map((item) => (item.name !== "frmCreate" ? item : {
    ...item,
    controls: [
      ...item.controls,
      control("lblArmorCost", "System.Windows.Forms.Label", "tabArmor", "Cost:"),
      control("lblArmorAvail", "System.Windows.Forms.Label", "tabArmor", "Avail:"),
      control("lblKarma", "System.Windows.Forms.Label", "(self)", "Karma"),
    ],
  })),
};

/** A manifest of the fixture inventory without runs, with the named controls observed and the named bindings exercised. */
export function manifestWith(observed: readonly string[], exercised: readonly (readonly [string, ExerciseProof])[] = []): CoverageManifest {
  const manifest = buildCoverageManifest({ inventory, scope, scopePath: scope.path, plan: [], runs: [] });
  return {
    ...manifest,
    controls: manifest.controls.map((item): ManifestControl => (observed.includes(item.id) && item.status === "unobserved"
      ? { id: item.id, class: item.class, name: item.name, type: item.type, status: "observed", seenIn: [{ case: "build-Alpha", capture: "common" }] } : item)),
    interactions: manifest.interactions.map((item): ManifestInteraction => {
      const proof = exercised.find(([id]) => id === item.id)?.[1];
      if (proof === undefined || item.status !== "unexercised") return item;
      const { status: _, ...rest } = item;
      return { ...rest, status: "exercised", proofs: [proof] };
    }),
  };
}

/** A source root with an English language file holding the given strings. */
export function languageRoot(strings: readonly (readonly [string, string])[]): string {
  const root = mkdtempSync(join(tmpdir(), "discovery-lang-"));
  mkdirSync(join(root, "bin", "lang"), { recursive: true });
  const body = strings.map(([key, text]) => `\t\t<string>\n\t\t\t<key>${key}</key>\n\t\t\t<text>${text}</text>\n\t\t</string>`).join("\n");
  writeFileSync(join(root, "bin", "lang", "en-us.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<chummer>\n\t<strings>\n${body}\n\t</strings>\n</chummer>\n`);
  return root;
}
