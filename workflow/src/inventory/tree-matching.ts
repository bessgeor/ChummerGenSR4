import type { UiNode } from "../../../contracts/generated/typescript/parity-ui-tree.js";
import { SetupError } from "../host/setup-error.js";
import type { InventoryClass, InventoryControl } from "./source-inventory-document.js";

/** What one recorded tree shows: the controls it matched, the IDs it could not, and the visible page of each tab control. */
export type TreeMatch = {
  /** `<Class>.<control>` of every matched control. */
  readonly controls: ReadonlySet<string>;
  /** Control names of shown nodes that matched no declared control and no class instance, sorted, each once. */
  readonly unresolved: readonly string[];
  /** `<Class>.<tab control>` to the tab text of the one page it shows; a tab control showing two is left out. */
  readonly pages: ReadonlyMap<string, string>;
};

/** The inventory's classes, by name and by the instance name their designer sets. */
export class ClassIndex {
  private readonly byName = new Map<string, InventoryClass>();
  private readonly byInstance = new Map<string, InventoryClass>();
  private readonly controlMaps = new Map<string, ReadonlyMap<string, InventoryControl>>();

  constructor(classes: readonly InventoryClass[]) {
    for (const item of classes) {
      this.byName.set(item.name, item);
      this.controlMaps.set(item.name, new Map(item.controls.map((control) => [control.name, control])));
      if (item.instanceName === null) continue;
      const other = this.byInstance.get(item.instanceName);
      if (other !== undefined) throw new SetupError(`The classes ${other.name} and ${item.name} both name their instances ${item.instanceName}.`);
      this.byInstance.set(item.instanceName, item);
    }
  }

  control(className: string, name: string): InventoryControl | undefined {
    return this.controlMaps.get(className)?.get(name);
  }

  /** The tab pages a class declares in one of its tab controls. */
  tabPages(className: string, tabControl: string): InventoryControl[] {
    const controls = this.controlMaps.get(className);
    if (controls === undefined) return [];
    return [...controls.values()].filter((control) => control.parent === tabControl && lastSegment(control.type) === "TabPage");
  }

  instance(automationId: string): InventoryClass | undefined {
    return this.byInstance.get(automationId);
  }

  /** The inventoried class a control's declared type names, by its last segment. */
  classOfType(type: string): InventoryClass | undefined {
    return this.byName.get(lastSegment(type));
  }
}

function lastSegment(type: string): string {
  return type.slice(type.lastIndexOf(".") + 1);
}

/** Declared types that are never a window of their own: components, tool strip items, pop-up menus, dialogs and columns. */
const windowlessTypes: ReadonlySet<string> = new Set([
  "ToolStripMenuItem", "ToolStripSeparator", "ToolStripButton", "ToolStripLabel", "ToolStripStatusLabel", "ToolStripProgressBar",
  "ToolStripComboBox", "ToolStripTextBox", "ToolStripDropDownButton", "ToolStripSplitButton", "ToolStripControlHost", "ContextMenuStrip",
  "ToolTip", "Timer", "ImageList", "ErrorProvider", "HelpProvider", "BackgroundWorker", "NotifyIcon", "BindingSource", "ColumnHeader",
  "OpenFileDialog", "SaveFileDialog", "FolderBrowserDialog", "ColorDialog", "FontDialog",
]);

/**
 * Whether a declared type can never show as a node of the tree whose automation ID is its name: UI Automation reports
 * a control's name only for a WinForms window, and these are not windows. Any other type, one this list does not know
 * included, counts as observable.
 */
export function isWindowless(type: string): boolean {
  const name = lastSegment(type);
  return windowlessTypes.has(name) || /^DataGridView\w*Column$/.test(name);
}

type Rect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

function rect(node: UiNode): Rect {
  const { x, y, width, height } = node.bounds;
  return { left: x, top: y, right: x + width, bottom: y + height };
}

function intersect(a: Rect, b: Rect): Rect {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}

function isEmpty(area: Rect): boolean {
  return area.right <= area.left || area.bottom <= area.top;
}

/** WinForms window classes are `WindowsForms10.<class>.app.<n>.<hash>`; only these report a control's name as automation ID. */
function isWinFormsWindow(node: UiNode): boolean {
  return node.className.startsWith("WindowsForms10.");
}

/**
 * The control name a node carries: its automation ID when it is a WinForms window and the ID is not a number. Elements
 * that are not WinForms windows (title bar and scroll bar parts, a combo box's button and edit, list headers) carry
 * fixed UI Automation IDs, and a WinForms window without a name reports its Win32 control ID, a number.
 */
function controlName(node: UiNode): string {
  const id = node.automationId;
  return isWinFormsWindow(node) && !/^[0-9]+$/.test(id) ? id : "";
}

/**
 * Matches a tree's nodes to declared controls. Each node is read in the context of a class, inherited from its parent:
 * a control name that names a control declared in the context class matches it (and, when that control's type is an
 * inventoried class, sets the context for its subtree); otherwise a name that is a class's instance name sets the context
 * to that class. Any other control name is unresolved. Nodes without a control name keep their parent's context. The
 * root starts without a context.
 *
 * A node is shown only when its parent is and its bounds overlap those of every WinForms window above it: a window is
 * clipped by its parents, and UI Automation reports the children of a window scrolled out of its panel as on screen.
 * An element that is not a window and has no rectangle is shown with its parent. Nodes that are not shown count for nothing.
 *
 * A tab control's pages are its `TabItem` children, without IDs, named by their tab text; the shown page's content is
 * the children of its item. The page a tab control shows is the name of its one item with children; its `TabPage`
 * control is matched when exactly one tab page of that tab control has that text in the designer.
 */
export function matchTree(nodes: readonly UiNode[], index: ClassIndex): TreeMatch {
  const contexts: (string | null)[] = [];
  const clips: (Rect | null)[] = [];
  const tabControls = new Map<number, { readonly className: string; readonly control: InventoryControl }>();
  const hasChildren = new Set<number>();
  for (const node of nodes) if (node.parent !== null) hasChildren.add(node.parent);
  const controls = new Set<string>();
  const unresolved = new Set<string>();
  const pages = new Map<string, Set<string>>();
  nodes.forEach((node, position) => {
    const parentClip = node.parent === null ? undefined : clips[node.parent];
    if (parentClip === null) {
      clips[position] = null;
      return;
    }
    const own = rect(node);
    const window = isWinFormsWindow(node);
    const visible = parentClip === undefined ? own : intersect(parentClip, own);
    // An element that is not a window and has no rectangle (the tree records it with zero bounds) has nothing to clip.
    const unbounded = !window && parentClip !== undefined && isEmpty(own);
    if (isEmpty(visible) && !unbounded) {
      clips[position] = null;
      return;
    }
    clips[position] = window ? visible : parentClip ?? visible;
    const inherited = node.parent === null ? null : contexts[node.parent] ?? null;
    contexts[position] = inherited;
    const tab = node.parent === null ? undefined : tabControls.get(node.parent);
    if (tab !== undefined && node.controlType === "ControlType.TabItem" && hasChildren.has(position)) {
      const key = `${tab.className}.${tab.control.name}`;
      if (node.name !== "") pages.set(key, (pages.get(key) ?? new Set<string>()).add(node.name));
      const page = tabPageByText(index, tab.className, tab.control.name, node.name);
      if (page !== undefined) controls.add(`${tab.className}.${page.name}`);
      return;
    }
    const id = controlName(node);
    if (id === "") return;
    const control = inherited === null ? undefined : index.control(inherited, id);
    if (control !== undefined && inherited !== null) {
      controls.add(`${inherited}.${id}`);
      if (lastSegment(control.type) === "TabControl") tabControls.set(position, { className: inherited, control });
      contexts[position] = index.classOfType(control.type)?.name ?? inherited;
      return;
    }
    const instance = index.instance(id);
    if (instance !== undefined) {
      contexts[position] = instance.name;
      return;
    }
    unresolved.add(id);
  });
  const shown = new Map<string, string>();
  for (const [key, names] of pages) {
    if (names.size === 1) shown.set(key, [...names][0]!);
  }
  return { controls, unresolved: [...unresolved].sort(), pages: shown };
}

/** The one tab page of a tab control whose designer text is `text`, if exactly one has it. */
function tabPageByText(index: ClassIndex, className: string, tabControl: string, text: string): InventoryControl | undefined {
  const found = index.tabPages(className, tabControl).filter((page) => page.text === text);
  return found.length === 1 ? found[0] : undefined;
}
