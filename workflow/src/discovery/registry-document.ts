import { z } from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** The actions a scenario may hold: the case-file actions without `include` and `optional`. */
export const ScenarioActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("selectTab"), name: z.string().min(1) }),
  z.strictObject({ type: z.literal("waitFor"), label: z.string().min(1) }),
  z.strictObject({ type: z.literal("wait"), milliseconds: z.number().int().min(0) }),
  z.strictObject({ type: z.literal("capture"), name: z.string().min(1) }),
]);
export type ScenarioAction = z.infer<typeof ScenarioActionSchema>;

/** One admitted scenario: what it runs, what its run proved and where it came from. */
export const RegistryEntrySchema = z.strictObject({
  /** `<fixture case>@<scenario>`, its case name in `parity/cases/discovered.json`. */
  case: z.string().min(1),
  /** The suite case whose fixture and mode it uses. */
  fixtureCase: z.string().min(1),
  mode: z.enum(["build", "career"]),
  scenario: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** The fixture path relative to `parity/cases/`. */
  fixture: z.string().min(1),
  actions: z.array(ScenarioActionSchema).min(1),
  /** SHA-256 of the canonical JSON of the fixture case and the actions. */
  actionsSha256: sha256,
  target: z.string().min(1),
  /** The source inventory's hash the proofs hold for. */
  sourceSha256: sha256,
  /** Control IDs (`<Class>.<control>`) and binding IDs its run proved, unobserved or unexercised before. */
  proofs: z.strictObject({ controls: z.array(z.string().min(1)), interactions: z.array(z.string().min(1)) }),
  visual: z.strictObject({ outcome: z.enum(["clear", "finding"]), differing: z.array(z.string().min(1)) }),
  provenance: z.strictObject({ thread: z.string().min(1), runId: z.string().min(1), records: z.array(z.string().min(1)).min(1) }),
  admittedUtc: z.string().min(1),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

/** `parity/discovery/registry.json`: every admitted scenario, by case name. */
export const RegistrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** The timings its case file renders with. */
  startupDelaySeconds: z.number().int().min(0),
  settleMilliseconds: z.number().int().min(0),
  entries: z.array(RegistryEntrySchema),
});
export type Registry = z.infer<typeof RegistrySchema>;
