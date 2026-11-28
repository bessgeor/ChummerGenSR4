import { delay, type DesktopLane } from "../host/desktop-lane.js";
import { LaneConflict } from "./lane-conflict.js";
import type { LaneIdentity, RemoteLane } from "./remote-lane.js";

/** A desktop lane: its lock, and where its commands run: on this machine (no remote) or through its agent. */
export type HostLane = { readonly name: string; readonly lock: DesktopLane; readonly remote: RemoteLane | null };

/** A lane a desktop command holds until it releases it. */
export type HeldLane = { readonly lane: HostLane; release(): Promise<void> };

/** The lanes a loop paused, read each time a desktop command looks for a lane. */
export type LanePauses = {
  /** The names of the paused lanes; a control file that cannot be read is a setup error. */
  paused(): ReadonlySet<string>;
  readonly log: (line: string) => void;
  /** Learns that a desktop command took (`held`) or gave back the lane. */
  readonly held?: (lane: string, held: boolean) => void;
};

/**
 * The desktop lanes of a run: a desktop command takes the first lane, in their order, whose lock it gets, among the
 * lanes that are not paused.
 */
export class LanePool {
  private checked: Promise<void> | null = null;

  constructor(
    readonly lanes: readonly HostLane[],
    private readonly pollMilliseconds: number,
    /** This process's host and user, which the local lane runs as. */
    private readonly localIdentity: LaneIdentity,
    /** The lanes the loop that runs the commands paused; null outside a loop. */
    private readonly pauses: LanePauses | null = null,
  ) {
    if (lanes.length === 0) throw new RangeError("A lane pool needs at least one lane.");
  }

  lane(name: string): HostLane {
    const lane = this.lanes.find((candidate) => candidate.name === name);
    if (lane === undefined) throw new Error(`There is no desktop lane ${name}.`);
    return lane;
  }

  /**
   * Checks once, before the first command on any lane, that no two lanes run as one user on one host: they would share
   * a desktop session or the app's settings. A lane whose agent does not run fails the check, a paused lane too.
   */
  check(signal?: AbortSignal): Promise<void> {
    this.checked ??= this.compareIdentities(signal).catch((error: unknown) => {
      // A conflict is final; a lane that could not be asked (its agent is not running, the run was stopped) is asked again.
      if (!(error instanceof LaneConflict)) this.checked = null;
      throw error;
    });
    return this.checked;
  }

  private async compareIdentities(signal: AbortSignal | undefined): Promise<void> {
    const identities = await Promise.all(this.lanes.map(async (lane) => ({
      lane: lane.name, identity: lane.remote === null ? this.localIdentity : await lane.remote.identity(signal),
    })));
    const seen = new Map<string, string>();
    for (const { lane, identity } of identities) {
      const key = `${identity.user}@${identity.host}`.toLowerCase();
      const other = seen.get(key);
      if (other !== undefined) {
        throw new LaneConflict(`Desktop lanes ${other} and ${lane} both run as ${identity.user} on ${identity.host}; one user on one host has one desktop session and one set of the app's settings, so give each lane its own user or machine.`);
      }
      seen.set(key, lane);
    }
  }

  /** The lane held by a command, which the loop learns of until the command releases it. */
  private async hold(lane: HostLane, release: () => Promise<void>): Promise<HeldLane> {
    const held = this.pauses?.held;
    if (held === undefined) return { lane, release };
    try {
      held(lane.name, true);
    } catch (error) {
      await release();
      throw error;
    }
    return {
      lane,
      release: async () => {
        try {
          await release();
        } finally {
          held(lane.name, false);
        }
      },
    };
  }

  /**
   * Waits until a lane that is not paused is free (or the signal aborts) and holds it. A paused lane is not tried, so
   * it takes no new command while the one it runs goes on; while every lane is paused the command waits and says so.
   */
  async acquire(signal?: AbortSignal): Promise<HeldLane> {
    const attempts = this.lanes.map((lane) => ({ lane, attempts: lane.lock.attempts() }));
    let waitingForUnpause = false;
    for (;;) {
      const paused = this.pauses?.paused() ?? new Set<string>();
      const open = attempts.filter(({ lane }) => !paused.has(lane.name));
      if (open.length === 0 && !waitingForUnpause) {
        this.pauses?.log(`Every desktop lane (${this.lanes.map((lane) => lane.name).join(", ")}) is paused; the desktop command waits until one is unpaused.`);
      }
      waitingForUnpause = open.length === 0;
      for (const { lane, attempts: next } of open) {
        const release = await next.next(signal);
        if (release !== null) return this.hold(lane, release);
      }
      await delay(this.pollMilliseconds, signal);
    }
  }
}
