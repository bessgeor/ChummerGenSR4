import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SetupError } from "../host/setup-error.js";
import type { CoverageManifest } from "../inventory/coverage-manifest-document.js";
import type { SourceInventory } from "../inventory/source-inventory-document.js";

/** The English language file of the app, relative to its source root. */
export const languageFile = join("bin", "lang", "en-us.xml");

export type LanguageString = { readonly key: string; readonly text: string };

function decode(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) => {
    switch (entity) {
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return "\"";
      case "apos": return "'";
      case "amp": return "&";
      default: return String.fromCodePoint(entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    }
  });
}

/** Every `<string><key>…</key><text>…</text></string>` of a language file; a missing file or one without strings is a setup error. */
export function readLanguageStrings(root: string): LanguageString[] {
  const path = join(root, languageFile);
  if (!existsSync(path)) throw new SetupError(`The language file ${path} does not exist.`);
  const strings = [...readFileSync(path, "utf8").matchAll(/<string>\s*<key>([^<]*)<\/key>\s*<text>([^<]*)<\/text>\s*<\/string>/g)]
    .map((match) => ({ key: decode(match[1]!.trim()), text: decode(match[2]!) }));
  if (strings.length === 0) throw new SetupError(`The language file ${path} holds no string.`);
  return strings;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

/**
 * The tab texts a `selectTab` may name in a form class: the designer texts of its tab pages, the language file's `Tab_`
 * strings, and the pages the baseline's exercise proofs name for the class.
 */
export function knownTabTexts(className: string, inventory: SourceInventory, manifest: CoverageManifest, strings: readonly LanguageString[]): string[] {
  const item = inventory.classes.find((entry) => entry.name === className);
  if (item === undefined) throw new SetupError(`The source inventory has no class ${className}.`);
  const designer = item.controls.filter((control) => control.type.endsWith("TabPage")).map((control) => control.text ?? "");
  const language = strings.filter((entry) => entry.key.startsWith("Tab_")).map((entry) => entry.text);
  const proofs = manifest.interactions.flatMap((interaction) => (interaction.class === className && interaction.status === "exercised"
    ? interaction.proofs.flatMap((proof) => [proof.fromPage, proof.toPage]) : []));
  return sorted([...designer, ...language, ...proofs]);
}

/** The labels a `waitFor` may name: the designer texts of the active classes' controls and every string of the language file. */
export function knownLabels(inventory: SourceInventory, manifest: CoverageManifest, strings: readonly LanguageString[]): string[] {
  const active = new Set(manifest.classes.filter((item) => item.scope === "active").map((item) => item.name));
  const designer = inventory.classes.filter((item) => active.has(item.name)).flatMap((item) => item.controls.map((control) => control.text ?? ""));
  return sorted([...designer, ...strings.map((entry) => entry.text)]);
}
