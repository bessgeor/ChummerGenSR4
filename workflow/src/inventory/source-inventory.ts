import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SetupError } from "../host/setup-error.js";
import { sha256Lines, sha256Text } from "../steps/fingerprint.js";
import { parseDesigner } from "./designer-parser.js";
import type { InventoryClass, SourceInventory } from "./source-inventory-document.js";

const designerSuffix = ".Designer.cs";

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The designer files among the compiled source's paths (`compiledSourcePaths`), relative and sorted. */
export function designerPaths(compiledPaths: readonly string[]): string[] {
  return compiledPaths.filter((path) => path.endsWith(designerSuffix));
}

/**
 * Parses every designer file (paths relative to `root`, with / separators) with its code file beside it, and lists
 * every class that has `InitializeComponent`. Two classes with one name fail it.
 */
export function buildSourceInventory(root: string, designerPaths: readonly string[]): SourceInventory {
  const hashed: string[] = [];
  const read = (path: string): string | null => {
    const full = join(root, path);
    if (!existsSync(full)) return null;
    const text = readFileSync(full, "utf8");
    hashed.push(`${path}\t${sha256Text(text)}`);
    return text;
  };
  const classes: InventoryClass[] = [];
  for (const designerPath of [...designerPaths].sort(ordinal)) {
    if (!designerPath.endsWith(designerSuffix)) throw new SetupError(`${designerPath} is not a designer file.`);
    const designerText = read(designerPath);
    if (designerText === null) throw new SetupError(`The designer file ${designerPath} does not exist.`);
    const codePath = `${designerPath.slice(0, -designerSuffix.length)}.cs`;
    const parsed = parseDesigner({ designerPath, designerText, codePath, codeText: read(codePath) });
    if (parsed === null) continue;
    const other = classes.find((item) => item.name === parsed.name);
    if (other !== undefined) throw new SetupError(`The class ${parsed.name} is declared by ${other.designerFile} and ${designerPath}.`);
    classes.push(parsed);
  }
  classes.sort((left, right) => ordinal(left.name, right.name));
  return {
    schemaVersion: 1,
    sourceSha256: sha256Lines(hashed.sort(ordinal)),
    classes,
    totals: {
      classes: classes.length,
      controls: classes.reduce((sum, item) => sum + item.controls.length, 0),
      interactions: classes.reduce((sum, item) => sum + item.interactions.length, 0),
    },
  };
}
