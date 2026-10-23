/** Who serves a lane: two lanes of one host and user would share a desktop session or the app's settings. */
export type LaneIdentity = { readonly host: string; readonly user: string };

/** A command for a lane's machine, run with the repository root as its working folder. */
export type LaneCommand = {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Whether it drives the lane's desktop, so the lane's session must not run another desktop command beside it. */
  readonly desktop: boolean;
  readonly signal?: AbortSignal;
};

/** A lane on another session or machine, reached through its agent. */
export interface RemoteLane {
  /** The lane's host and user; starts the lane's agent first when the lane says how, and fails when it does not run. */
  identity(signal?: AbortSignal): Promise<LaneIdentity>;
  /** Runs the command in the lane's session and returns its exit status, writing its output with the label prefixed. */
  run(command: LaneCommand, workingFolder: string, write: (text: string) => void): Promise<number>;
}
