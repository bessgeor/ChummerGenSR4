import { readFileSync } from "node:fs";
import { z } from "zod";
import { SetupError } from "../host/setup-error.js";
import { sha256Text } from "../steps/fingerprint.js";
import type { SourceInventory } from "./source-inventory-document.js";

const reason = z.string().refine((text) => text.trim().length > 0, "a reason must not be empty");

/** `parity/inventory/scope.json`: every class as active or deferred, and the events deferred everywhere, each with its reason. */
export const ScopeFileSchema = z.strictObject({
  classes: z.record(z.string().min(1), z.strictObject({ scope: z.enum(["active", "deferred"]), reason })),
  deferredEvents: z.record(z.string().min(1), reason),
});
export type ScopeFile = z.infer<typeof ScopeFileSchema>;

export type Scope = ScopeFile & { readonly path: string; readonly sha256: string };

/** Reads and validates a scope file; one that cannot be read or does not match its schema is a setup error. */
export function readScope(path: string): Scope {
  let text: string;
  let document: unknown;
  try {
    text = readFileSync(path, "utf8");
    document = JSON.parse(text);
  } catch (error) {
    throw new SetupError(`The scope file ${path} cannot be read: ${(error as Error).message}`);
  }
  const parsed = ScopeFileSchema.safeParse(document);
  if (!parsed.success) throw new SetupError(`The scope file ${path} is invalid: ${z.prettifyError(parsed.error)}`);
  return { ...parsed.data, path, sha256: sha256Text(text) };
}

/**
 * Fails unless the scope declares exactly the inventory's classes, and every deferred event is bound somewhere: a new
 * class must be placed in or out of scope on purpose, and a stale entry is not silently ignored.
 */
export function checkScope(scope: ScopeFile, inventory: SourceInventory, path: string): void {
  const names = new Set(inventory.classes.map((item) => item.name));
  const missing = [...names].filter((name) => scope.classes[name] === undefined);
  const unknown = Object.keys(scope.classes).filter((name) => !names.has(name));
  const events = new Set(inventory.classes.flatMap((item) => item.interactions.map((interaction) => interaction.event)));
  const unbound = Object.keys(scope.deferredEvents).filter((event) => !events.has(event));
  const problems = [
    ...(missing.length === 0 ? [] : [`it does not declare the classes ${missing.join(", ")}`]),
    ...(unknown.length === 0 ? [] : [`it declares classes the source does not have: ${unknown.join(", ")}`]),
    ...(unbound.length === 0 ? [] : [`it defers events no binding uses: ${unbound.join(", ")}`]),
  ];
  if (problems.length > 0) throw new SetupError(`The scope file ${path} does not match the source: ${problems.join("; ")}.`);
}

/** Why a class's binding is deferred, or null when it is in the active scope. */
export function deferral(scope: ScopeFile, className: string, event: string | null): string | null {
  const declared = scope.classes[className];
  if (declared === undefined) throw new SetupError(`The scope does not declare the class ${className}.`);
  if (declared.scope === "deferred") return declared.reason;
  return event === null ? null : scope.deferredEvents[event] ?? null;
}
