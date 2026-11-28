import { existsSync } from "node:fs";
import { SetupError } from "../host/setup-error.js";
import type { LaneDefinition } from "../lanes/lane-settings.js";
import { setPaused, writeLanePaused } from "../loop/loop-control.js";
import type { LoopCommand } from "./loop-arguments.js";
import type { LoopPaths } from "./loop-document.js";

export type PauseDependencies = {
  readonly paths: LoopPaths;
  /** The desktop lanes the profile declares. */
  readonly lanes: readonly LaneDefinition[];
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/**
 * `--pause` or `--unpause`: sets the loop's flag, or a lane's, in the loop's control file, and an agent lane's in
 * `paused.json` in its folder. A loop that does not exist and a lane the profile does not declare are setup errors.
 */
export function pauseLoop(command: Extract<LoopCommand, { kind: "pause" }>, dependencies: PauseDependencies): number {
  const { paths, log } = dependencies;
  const { loopId, lane, paused } = command;
  if (!/^loop-[A-Za-z0-9._-]+$/.test(loopId) || !existsSync(paths.document(loopId))) throw new SetupError(`There is no loop ${loopId} (${paths.document(loopId)}).`);
  const definition = lane === null ? null : dependencies.lanes.find((candidate) => candidate.name === lane);
  if (definition === undefined) {
    throw new SetupError(`The profile declares no desktop lane ${lane}; its lanes are ${dependencies.lanes.map((candidate) => candidate.name).join(", ")}.`);
  }
  const now = dependencies.now();
  setPaused(paths.folder(loopId), lane, paused, now);
  if (definition?.kind === "agent") writeLanePaused(definition.folder, paused, now);
  const subject = lane === null ? `Loop ${loopId}` : `Desktop lane ${lane} of loop ${loopId}`;
  log(paused
    ? `${subject} is paused: ${lane === null ? "running jobs and captures finish, and nothing new starts" : "the capture it runs finishes, and it takes no new one"} until --unpause.`
    : `${subject} is unpaused.`);
  return 0;
}
