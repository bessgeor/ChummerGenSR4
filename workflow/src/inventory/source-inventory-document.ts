import { z } from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const InventoryControlSchema = z.strictObject({
  name: z.string().min(1),
  /** The field's declared type as the designer writes it, for example `System.Windows.Forms.Button`. */
  type: z.string().min(1),
  /** The control it is added to, `(self)` for the class itself, or null when nothing contains it (components, menus). */
  parent: z.string().min(1).nullable(),
  /** The designer line of the field declaration. */
  line: z.number().int().positive(),
  text: z.string().nullable(),
  /** The translation key the app's language manager reads. */
  tag: z.string().nullable(),
  contextMenu: z.string().min(1).nullable(),
});
export type InventoryControl = z.infer<typeof InventoryControlSchema>;

export const InventoryInteractionSchema = z.strictObject({
  /** `<Class>.<target>[.<member>].<Event>`, with `(self)` as the target of the class's own events. */
  id: z.string().min(1),
  /** The control whose event is bound; null for the class's own events. */
  target: z.string().min(1).nullable(),
  /** The part of the control that raises the event, for example `Panel1` of a `SplitContainer`. */
  member: z.string().min(1).nullable(),
  event: z.string().min(1),
  handlerType: z.string().min(1),
  handler: z.string().min(1),
  handlerFile: z.string().min(1),
  handlerLine: z.number().int().positive(),
  designerLine: z.number().int().positive(),
});
export type InventoryInteraction = z.infer<typeof InventoryInteractionSchema>;

export const InventoryClassSchema = z.strictObject({
  name: z.string().min(1),
  namespace: z.string().min(1).nullable(),
  baseType: z.string().min(1),
  designerFile: z.string().min(1),
  codeFile: z.string().min(1),
  /** The `Name` the designer gives the class's instances, which is their automation ID. */
  instanceName: z.string().min(1).nullable(),
  controls: z.array(InventoryControlSchema),
  interactions: z.array(InventoryInteractionSchema),
});
export type InventoryClass = z.infer<typeof InventoryClassSchema>;

/** `source-inventory.json`: every WinForms class of the compiled source with its controls and event bindings. */
export const SourceInventorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** SHA-256 over the lines `path<TAB>SHA-256` of every designer and code file read, sorted by path. */
  sourceSha256: sha256,
  classes: z.array(InventoryClassSchema),
  totals: z.strictObject({ classes: z.number().int(), controls: z.number().int(), interactions: z.number().int() }),
});
export type SourceInventory = z.infer<typeof SourceInventorySchema>;
