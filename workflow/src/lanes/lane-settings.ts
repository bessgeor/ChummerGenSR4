import { resolve } from "node:path";
import { z } from "zod";

/** How Rider starts a lane's agent: the MCP endpoint, the project folder it has open and the run configuration to execute. */
export const RiderEntrySchema = z.strictObject({
  endpoint: z.url({ protocol: /^https?$/ }),
  rootFolder: z.string().min(1),
  configuration: z.string().min(1),
});
export type RiderEntry = z.infer<typeof RiderEntrySchema>;

const LaneSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "a lane name is 1 to 32 lower-case letters, digits and hyphens, starting with a letter or digit"),
  /** The folder a lane agent in another session or machine serves; absent for this machine's desktop. */
  agent: z.string().min(1).optional(),
  rider: RiderEntrySchema.optional(),
});

/** The profile's desktop lanes: at most one on this machine's desktop, the others served by lane agents. */
export const LanesSchema = z.array(LaneSchema).min(1).max(8).superRefine((lanes, context) => {
  const problem = (message: string) => context.addIssue({ code: "custom", message });
  const names = lanes.map((lane) => lane.name);
  for (const name of new Set(names)) {
    if (names.filter((other) => other === name).length > 1) problem(`two lanes are named ${name}`);
  }
  const local = lanes.filter((lane) => lane.agent === undefined);
  if (local.length > 1) problem(`only one lane may be this machine's desktop (without agent), not ${local.map((lane) => lane.name).join(" and ")}`);
  const folders = lanes.flatMap((lane) => (lane.agent === undefined ? [] : [resolve(lane.agent).toLowerCase()]));
  if (new Set(folders).size !== folders.length) problem("two lanes name the same agent folder");
  for (const lane of lanes) {
    if (lane.rider !== undefined && lane.agent === undefined) problem(`lane ${lane.name} has rider but no agent folder for Rider to start an agent on`);
  }
});

/** A lane as the host runs it: this machine's desktop, or a folder served by a lane agent that Rider may start. */
export type LaneDefinition =
  | { readonly name: string; readonly kind: "local" }
  | { readonly name: string; readonly kind: "agent"; readonly folder: string; readonly rider: RiderEntry | null };

/** The profile's lanes, or one lane on this machine's desktop when it declares none. */
export function laneDefinitions(lanes: z.infer<typeof LanesSchema> | undefined): LaneDefinition[] {
  if (lanes === undefined) return [{ name: "desktop", kind: "local" }];
  return lanes.map((lane) => (lane.agent === undefined
    ? { name: lane.name, kind: "local" as const }
    : { name: lane.name, kind: "agent" as const, folder: resolve(lane.agent), rider: lane.rider ?? null }));
}
