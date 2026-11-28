import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { defaultLaneSettings, DesktopLane } from "../host/desktop-lane.js";
import { AgentLane, defaultAgentLaneSettings } from "./agent-lane.js";
import type { LaneDefinition, RiderEntry } from "./lane-settings.js";
import { LanePool, type HostLane, type LanePauses } from "./lane-pool.js";
import { lanePaused, loopObserver, readControl, writeLanePaused } from "../loop/loop-control.js";

/** Starts the agent of a lane folder through Rider. */
export type RiderStarter = (entry: RiderEntry, folder: string, signal?: AbortSignal) => Promise<void>;

/**
 * The run's lane pool: the local lane locks the machine-wide desktop lock in the user's local application data, the
 * lock every run takes; an agent lane locks `lane.lock` in its folder, which every machine using the lane shares.
 */
export function hostLanePool(definitions: readonly LaneDefinition[], localData: string, log: (line: string) => void, startWithRider: RiderStarter,
  pauses: LanePauses | null = null): LanePool {
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
  return new LanePool(lanes, 2000, { host: hostname(), user: userInfo().username }, pauses);
}

/**
 * The lanes the control file of the loop in `loopFolder` pauses. Each time it is read, an agent lane the control file
 * names, whose flag differs from the one last written, gets it in `paused.json` in its folder, beside its agent's
 * heartbeat; a lane this loop never set a flag for keeps the file another loop wrote.
 */
export function controlFilePauses(loopFolder: string, definitions: readonly LaneDefinition[], log: (line: string) => void, now: () => Date): LanePauses {
  const written = new Map<string, boolean>();
  return {
    log,
    paused: () => {
      const control = readControl(loopFolder);
      const paused = new Set(definitions.filter((definition) => lanePaused(control, definition.name)).map((definition) => definition.name));
      for (const definition of definitions) {
        if (definition.kind !== "agent" || control.lanes[definition.name] === undefined) continue;
        const flag = paused.has(definition.name);
        if (written.get(definition.name) === flag) continue;
        writeLanePaused(definition.folder, flag, now());
        written.set(definition.name, flag);
      }
      return paused;
    },
    held: (lane, held) => loopObserver(loopFolder)?.laneHeld(lane, held),
  };
}
