import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { defaultLaneSettings, DesktopLane } from "../host/desktop-lane.js";
import { AgentLane, defaultAgentLaneSettings } from "./agent-lane.js";
import type { LaneDefinition, RiderEntry } from "./lane-settings.js";
import { LanePool, type HostLane } from "./lane-pool.js";

/** Starts the agent of a lane folder through Rider. */
export type RiderStarter = (entry: RiderEntry, folder: string, signal?: AbortSignal) => Promise<void>;

/**
 * The run's lane pool: the local lane locks the machine-wide desktop lock in the user's local application data, the
 * lock every run takes; an agent lane locks `lane.lock` in its folder, which every machine using the lane shares.
 */
export function hostLanePool(definitions: readonly LaneDefinition[], localData: string, log: (line: string) => void, startWithRider: RiderStarter): LanePool {
  const lanes = definitions.map((definition): HostLane => {
    if (definition.kind === "local") {
      return { name: definition.name, lock: new DesktopLane(defaultLaneSettings(definition.name, join(localData, "desktop-lane.lock"), log)), remote: null };
    }
    const { rider, folder } = definition;
    const start = rider === null ? null : (signal?: AbortSignal) => {
      log(`Starting the lane agent of desktop lane ${definition.name} through Rider (${rider.configuration}).`);
      return startWithRider(rider, folder, signal);
    };
    return {
      name: definition.name,
      lock: new DesktopLane(defaultLaneSettings(definition.name, join(folder, "lane.lock"), log)),
      remote: new AgentLane(defaultAgentLaneSettings(definition.name, folder, start)),
    };
  });
  return new LanePool(lanes, 2000, { host: hostname(), user: userInfo().username });
}
