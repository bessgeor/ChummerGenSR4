import { delay, type DesktopLane } from "../host/desktop-lane.js";
import { SetupError } from "../host/setup-error.js";
import type { LaneIdentity, RemoteLane } from "./remote-lane.js";

/** A desktop lane: its lock, and where its commands run: on this machine (no remote) or through its agent. */
export type HostLane = { readonly name: string; readonly lock: DesktopLane; readonly remote: RemoteLane | null };

/** A lane a desktop command holds until it releases it. */
export type HeldLane = { readonly lane: HostLane; release(): Promise<void> };

/** The desktop lanes of a run: a desktop command takes the first lane, in their order, whose lock it gets. */
export class LanePool {
  private checked: Promise<void> | null = null;

  constructor(
    readonly lanes: readonly HostLane[],
    private readonly pollMilliseconds: number,
    /** This process's host and user, which the local lane runs as. */
    private readonly localIdentity: LaneIdentity,
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
   * a desktop session or the app's settings. A lane whose agent does not run fails the check.
   */
  check(signal?: AbortSignal): Promise<void> {
    this.checked ??= this.compareIdentities(signal);
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
        throw new SetupError(`Desktop lanes ${other} and ${lane} both run as ${identity.user} on ${identity.host}; one user on one host has one desktop session and one set of the app's settings, so give each lane its own user or machine.`);
      }
      seen.set(key, lane);
    }
  }

  /** Waits until a lane is free (or the signal aborts) and holds it. */
  async acquire(signal?: AbortSignal): Promise<HeldLane> {
    const attempts = this.lanes.map((lane) => ({ lane, attempts: lane.lock.attempts() }));
    for (;;) {
      for (const { lane, attempts: next } of attempts) {
        const release = await next.next(signal);
        if (release !== null) return { lane, release };
      }
      await delay(this.pollMilliseconds, signal);
    }
  }
}
