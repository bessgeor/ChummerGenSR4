import { readAgent, type AgentDocument } from "./agent-protocol.js";

/** What a look at a lane folder found: its running agent, no running agent, or a file that cannot be read. */
export type AgentLook = { readonly running: AgentDocument } | "not-running" | "unreadable";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Judges whether a folder's agent runs without comparing clocks: the agent may set its file's modification time on
 * another machine's clock, so only a change this process observes counts. An agent runs when its file changed within
 * the stale time of this process's clock; a file seen for the first time is watched until it changes, for at most
 * the stale time. A change seen after a look more than the stale time ago says only that the file changed at some
 * time since, so it starts a new observation and the agent counts as running once a further change is seen.
 */
export class AgentWatch {
  private seen: { readonly modified: number; readonly since: number; readonly heard: number | null } | null = null;
  /** When this watch last read the file, or null before the first read and after the file was absent. */
  private looked: number | null = null;

  constructor(
    private readonly folder: string,
    private readonly staleAfterMilliseconds: number,
    private readonly pollMilliseconds: number,
  ) {}

  async look(signal?: AbortSignal): Promise<AgentLook> {
    for (;;) {
      const agent = await readAgent(this.folder);
      if (agent === "unreadable") return agent;
      const now = Date.now();
      const before = this.looked;
      if (agent === "absent") {
        this.seen = null;
        this.looked = null;
        return "not-running";
      }
      this.looked = now;
      if (this.seen === null) {
        this.seen = { modified: agent.refreshedMilliseconds, since: now, heard: null };
      } else if (agent.refreshedMilliseconds !== this.seen.modified) {
        // The change happened after the previous look; when that was long ago, it may have been the agent's last beat.
        const recent = before !== null && now - before <= this.staleAfterMilliseconds;
        this.seen = { modified: agent.refreshedMilliseconds, since: now, heard: recent ? before : null };
      }
      const { since, heard } = this.seen;
      if (heard !== null) return now - heard <= this.staleAfterMilliseconds ? { running: agent.document } : "not-running";
      if (now - since > this.staleAfterMilliseconds || signal?.aborted === true) return "not-running";
      await sleep(this.pollMilliseconds);
    }
  }
}
