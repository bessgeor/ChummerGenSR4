import { SetupError } from "../host/setup-error.js";
import type { InventoryClass, InventoryControl, InventoryInteraction } from "./source-inventory-document.js";

/** One designer file and its code file, read from the source, with paths relative to the source root. */
export type DesignerSource = {
  readonly designerPath: string;
  readonly designerText: string;
  readonly codePath: string;
  /** Null when the class has no code file. */
  readonly codeText: string | null;
};

const fieldPattern = /^\s*(?:private|internal|public|protected)(?:\s+(?:internal|readonly))*\s+([\w.]+)\s+(\w+)\s*;\s*$/;
const controlsAddPattern = /^\s*this\.(?:(\w+)(?:\.\w+)*\.)?Controls\.Add\(this\.(\w+)(?:\s*,[^)]*)?\);\s*$/;
/** A list of controls or tool strip items; lists of other objects (a combo box's strings) hold no controls. */
const addRangePattern = /^\s*this\.(?:(\w+)(?:\.\w+)*\.)?(?:Controls|Items|DropDownItems)\.AddRange\(new (?:[\w.]+\.)?(?:Control|ToolStripItem)\[\]\s*\{\s*$/;
/** Any list of controls or tool strip items, which `addRangePattern` must read. */
const controlListPattern = /\.AddRange\(new (?:[\w.]+\.)?(?:Control|ToolStripItem)\[\]/;
/** A line of an item list: items, each `this.<field>` with a comma between them, and optionally the closing `});`. */
const rangeLinePattern = /^\s*((?:this\.\w+\s*,?\s*)*)(\}\);)?\s*$/;
/** The start of a `Text` or `Tag` assignment of a control, or of the class itself when there is no control. */
const stringAssignmentPattern = /^\s*this\.(?:(\w+)\.)?(Text|Tag)\s*=(.*)$/;
/** One piece of a string assignment: a literal, then `+` when the next line continues it, or `;` when it ends. */
const stringPiecePattern = /^\s*("(?:[^"\\]|\\.)*")\s*(?:(\+)|(;))\s*$/;
const contextMenuPattern = /^\s*this\.(\w+)\.ContextMenuStrip\s*=\s*this\.(\w+);\s*$/;
const instanceNamePattern = /^\s*this\.Name\s*=\s*"(\w+)";\s*$/;
const bindingPattern = /^\s*this((?:\.\w+)*)\.(\w+)\s*\+=\s*new\s+([\w.]+)\(this\.(\w+)\);\s*$/;

/** The target of a class's own events and the container of the controls it holds directly. */
export const selfTarget = "(self)";

function fail(path: string, line: number, message: string): never {
  throw new SetupError(`${path}:${line}: ${message}`);
}

const simpleEscapes: Readonly<Record<string, string>> = {
  "'": "'", '"': '"', "\\": "\\", "0": "\0", a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
};

/** A C# regular string literal's value, with its quotes; an escape it does not know fails the file. */
function literal(text: string, path: string, line: number): string {
  const body = text.slice(1, -1);
  return body.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|x([0-9a-fA-F]{1,4})|(.))/gs, (_all, short?: string, long?: string, hex?: string, simple?: string) => {
    const code = short ?? long ?? hex;
    if (code !== undefined) {
      const point = Number.parseInt(code, 16);
      if (point > 0x10ffff) fail(path, line, `the string ${text} has the escape of a code point beyond U+10FFFF.`);
      return String.fromCodePoint(point);
    }
    const value = simpleEscapes[simple!];
    if (value === undefined) fail(path, line, `the string ${text} has the escape \\${simple!}, which the parser does not read.`);
    return value;
  });
}

/** The value of a string assignment that starts after its `=` on line `first` and may continue as `"a" +` on further lines. */
function stringValue(lines: readonly string[], first: number, rest: string, path: string): { readonly value: string; readonly last: number } {
  let value = "";
  let text = rest;
  for (let number = first; ; number++) {
    const piece = stringPiecePattern.exec(text);
    if (piece === null) fail(path, number, `cannot read this string assignment: ${text.trim()}`);
    value += literal(piece[1]!, path, number);
    if (piece[3] !== undefined) return { value, last: number };
    text = lines[number] ?? "";
  }
}

/** The 1-based lines of `InitializeComponent`: the first after its signature, and its closing brace at the signature's indent. */
function initializeComponentLines(lines: readonly string[]): { readonly first: number; readonly last: number } | null {
  const start = lines.findIndex((line) => /\bvoid\s+InitializeComponent\s*\(\s*\)/.test(line));
  if (start < 0) return null;
  const indent = /^\s*/.exec(lines[start] ?? "")?.[0] ?? "";
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "}" && (/^\s*/.exec(line)?.[0] ?? "") === indent) return { first: start + 2, last: index + 1 };
  }
  return null;
}

/** The 1-based line of the first `void <name>(` of each method name in a code file. */
function methodLines(text: string): ReadonlyMap<string, number> {
  const lines = new Map<string, number>();
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/\bvoid\s+(\w+)\s*\(/g)) {
      if (!lines.has(match[1]!)) lines.set(match[1]!, index + 1);
    }
  });
  return lines;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parses one WinForms designer file: the fields it declares, the containment and the strings `InitializeComponent`
 * sets, and its event bindings with each handler's line in the code file. Returns null for a file without
 * `InitializeComponent`. A binding it cannot read, a field it does not declare, or a handler the code file lacks fails it.
 */
export function parseDesigner(source: DesignerSource): InventoryClass | null {
  const { designerPath } = source;
  const lines = source.designerText.split(/\r?\n/);
  const body = initializeComponentLines(lines);
  if (body === null) {
    if (lines.some((line) => /\bvoid\s+InitializeComponent\s*\(/.test(line))) fail(designerPath, 1, "InitializeComponent has no closing brace at its indent.");
    return null;
  }
  const className = /\bpartial\s+class\s+(\w+)/.exec(source.designerText)?.[1];
  if (className === undefined) fail(designerPath, 1, "no partial class declaration.");
  const namespace = /^\s*namespace\s+([\w.]+)/m.exec(source.designerText)?.[1] ?? null;
  if (source.codeText === null) fail(designerPath, 1, `class ${className} has no code file ${source.codePath}.`);
  const baseType = new RegExp(`\\bpartial\\s+class\\s+${escapeRegExp(className)}\\s*:\\s*([\\w.]+)`).exec(source.codeText)?.[1];
  if (baseType === undefined) fail(source.codePath, 1, `class ${className} declares no base type.`);

  const controls = new Map<string, { -readonly [Key in keyof InventoryControl]: InventoryControl[Key] }>();
  lines.forEach((line, index) => {
    const match = fieldPattern.exec(line);
    if (match === null) return;
    const [, type, name] = match as unknown as [string, string, string];
    if (controls.has(name)) fail(designerPath, index + 1, `field ${name} is declared twice.`);
    controls.set(name, { name, type, parent: null, line: index + 1, text: null, tag: null, contextMenu: null });
  });
  const declared = (name: string, line: number, what: string) => {
    const control = controls.get(name);
    if (control === undefined) fail(designerPath, line, `${what} names the undeclared field ${name}.`);
    return control;
  };
  /** A null parent is the class itself, recorded as `(self)`. */
  const contain = (parent: string | null, child: string, line: number) => {
    if (parent !== null) declared(parent, line, "a containment");
    const control = declared(child, line, "a containment");
    const container = parent ?? selfTarget;
    if (control.parent !== null && control.parent !== container) fail(designerPath, line, `${child} is added to ${control.parent} and to ${container}.`);
    control.parent = container;
  };

  const handlerLines = methodLines(source.codeText);
  let instanceName: string | null = null;
  const interactions: InventoryInteraction[] = [];
  /** The open item list; a null owner is the class itself. */
  let range: { owner: string | null } | null = null;
  for (let number = body.first; number < body.last; number++) {
    const line = lines[number - 1] ?? "";
    if (range !== null) {
      const items = rangeLinePattern.exec(line);
      if (items === null) fail(designerPath, number, `cannot read this line of ${range.owner ?? className}'s item list: ${line.trim()}`);
      for (const item of items[1]!.matchAll(/this\.(\w+)/g)) contain(range.owner, item[1]!, number);
      if (items[2] !== undefined) range = null;
      continue;
    }
    const added = controlsAddPattern.exec(line);
    if (added !== null) {
      contain(added[1] ?? null, added[2]!, number);
      continue;
    }
    const rangeStart = addRangePattern.exec(line);
    if (rangeStart !== null) {
      const owner = rangeStart[1] ?? null;
      if (owner !== null) declared(owner, number, "an item list");
      range = { owner };
      continue;
    }
    if (controlListPattern.test(line)) fail(designerPath, number, `cannot read this item list: ${line.trim()}`);
    const text = stringAssignmentPattern.exec(line);
    if (text !== null) {
      const start = number;
      const read = stringValue(lines, number, text[3]!, designerPath);
      number = read.last;
      if (text[1] !== undefined) {
        const control = declared(text[1], start, `a ${text[2]}`);
        if (text[2] === "Text") control.text = read.value;
        else control.tag = read.value;
      }
      continue;
    }
    const menu = contextMenuPattern.exec(line);
    if (menu !== null) {
      declared(menu[2]!, number, "a context menu");
      declared(menu[1]!, number, "a context menu").contextMenu = menu[2]!;
      continue;
    }
    const instance = instanceNamePattern.exec(line);
    if (instance !== null) {
      instanceName = instance[1]!;
      continue;
    }
    if (line.includes("+=")) interactions.push(binding(source, className, controls, handlerLines, line, number));
  }
  if (range !== null) fail(designerPath, body.last, `the item list of ${range.owner ?? className} is not closed.`);

  const ids = new Set<string>();
  for (const interaction of interactions) {
    if (ids.has(interaction.id)) fail(designerPath, interaction.designerLine, `the interaction ${interaction.id} is bound twice.`);
    ids.add(interaction.id);
  }
  return {
    name: className, namespace, baseType, designerFile: designerPath, codeFile: source.codePath, instanceName,
    controls: [...controls.values()].sort((left, right) => left.line - right.line),
    interactions,
  };
}

function binding(
  source: DesignerSource, className: string, controls: ReadonlyMap<string, InventoryControl>, handlerLines: ReadonlyMap<string, number>, line: string, number: number,
): InventoryInteraction {
  const match = bindingPattern.exec(line);
  if (match === null) fail(source.designerPath, number, `cannot read this event binding: ${line.trim()}`);
  const [, path, event, handlerType, handler] = match as unknown as [string, string, string, string, string];
  const members = path.split(".").filter((part) => part.length > 0);
  const target = members[0] ?? null;
  if (target !== null && !controls.has(target)) fail(source.designerPath, number, `an event binding names the undeclared field ${target}.`);
  const member = members.length > 1 ? members.slice(1).join(".") : null;
  const handlerLine = handlerLines.get(handler);
  if (handlerLine === undefined) fail(source.designerPath, number, `the handler ${handler} is not defined in ${source.codePath}.`);
  return {
    id: `${className}.${target === null ? selfTarget : [target, ...(member === null ? [] : [member])].join(".")}.${event}`,
    target, member, event, handlerType, handler, handlerFile: source.codePath, handlerLine, designerLine: number,
  };
}
