import { open, rm, writeFile, mkdir } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { SetupError } from "../host/setup-error.js";
import { prefixLines } from "../host/prefix-lines.js";
import {
  agentStaleAfterMilliseconds, newRequestId, readAgent, readExit, requestFiles, requestsFolder, writeAtomically,
  type AgentDocument, type LaneExit, type LaneRequest,
} from "./agent-protocol.js";
import { AgentWatch } from "./agent-watch.js";
import type { LaneCommand, LaneIdentity, RemoteLane } from "./remote-lane.js";

export type AgentLaneSettings = {
  readonly name: string;
  readonly folder: string;
  readonly pollMilliseconds: number;
  /** An agent whose file this process has not seen change for this long counts as not running. */
  readonly staleAfterMilliseconds: number;
  /** How long a stopped request may take to confirm its stop. */
  readonly cancelWaitMilliseconds: number;
  /** How long an agent that was started may take to refresh its file. */
  readonly startWaitMilliseconds: number;
  /** Starts the lane's agent, or null when the lane does not say how. */
  readonly startAgent: ((signal?: AbortSignal) => Promise<void>) | null;
  readonly now: () => Date;
};

export function defaultAgentLaneSettings(name: string, folder: string, startAgent: AgentLaneSettings["startAgent"]): AgentLaneSettings {
  return {
    name, folder, pollMilliseconds: 200, staleAfterMilliseconds: agentStaleAfterMilliseconds, cancelWaitMilliseconds: 60_000,
    startWaitMilliseconds: 180_000, startAgent, now: () => new Date(),
  };
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** A desktop lane in another session or machine, reached through the folder its lane agent serves. */
export class AgentLane implements RemoteLane {
  /** The agent's host and user when they were first read; a later agent with others is a setup error. */
  private identified: LaneIdentity | null = null;
  private readonly watch: AgentWatch;
  /** The start that is under way, which every command that needs the agent meanwhile joins. */
  private starting: Promise<AgentDocument> | null = null;

  constructor(private readonly settings: AgentLaneSettings) {
    this.watch = new AgentWatch(settings.folder, settings.staleAfterMilliseconds, settings.pollMilliseconds);
  }

  async identity(signal?: AbortSignal): Promise<LaneIdentity> {
    const agent = await this.runningAgent(signal);
    const identity = { host: agent.host, user: agent.user };
    this.identified ??= identity;
    return identity;
  }

  async run(command: LaneCommand, workingFolder: string, write: (text: string) => void): Promise<number> {
    const { name, folder } = this.settings;
    if (command.signal?.aborted === true) throw new SetupError(`${command.label}: not started because the run was stopped.`);
    const agent = await this.runningAgent(command.signal);
    if (this.identified === null || agent.host !== this.identified.host || agent.user !== this.identified.user) {
      throw new SetupError(`The lane agent of desktop lane ${name} now runs as ${agent.user} on ${agent.host}, not as the lanes were checked with; start a new run.`);
    }
    const request: LaneRequest = {
      id: newRequestId(this.settings.now()), label: command.label, command: command.command, args: [...command.args], cwd: workingFolder, desktop: command.desktop,
    };
    const files = requestFiles(folder, request.id);
    await mkdir(requestsFolder(folder), { recursive: true });
    await writeAtomically(files.request, `${JSON.stringify(request, null, 2)}\n`);
    // Keep the cancel and request files if the agent went silent or did not confirm a stop. It may still be
    // running the child, and deleting the cancel would allow that child to continue if the agent recovers.
    const exit = await this.follow(command, files, write);
    await Promise.all(Object.values(files).map((path) => rm(path, { force: true })));
    return this.statusOf(command, exit);
  }

  /** Prints the request's output until its exit appears, cancelling it when the run stops or the agent goes silent. */
  private async follow(command: LaneCommand, files: ReturnType<typeof requestFiles>, write: (text: string) => void): Promise<LaneExit> {
    const { name } = this.settings;
    const output = prefixLines(command.label, write);
    const decoder = new StringDecoder("utf8");
    let offset = 0;
    let cancelDeadline: number | null = null;
    // The heartbeat is judged by when this process saw the agent's file change, so the two machines' clocks never meet.
    let heartbeat = -1;
    let heard = Date.now();
    const cancel = async () => {
      if (cancelDeadline !== null) return;
      cancelDeadline = Date.now() + this.settings.cancelWaitMilliseconds;
      await writeFile(files.cancel, "");
    };
    for (;;) {
      offset = await this.pump(files.log, offset, (text) => output.push(decoder.write(text)));
      const exit = await this.exitOf(command.label, files.exit);
      if (exit !== null) {
        offset = await this.pump(files.log, offset, (text) => output.push(decoder.write(text)));
        output.push(decoder.end());
        output.flush();
        return exit;
      }
      if (command.signal?.aborted === true) await cancel();
      if (cancelDeadline !== null && Date.now() > cancelDeadline) {
        throw new SetupError(`${command.label}: the lane agent of desktop lane ${name} did not confirm the stop within ${Math.round(this.settings.cancelWaitMilliseconds / 1000)} s; the command may still be running in that lane's session.`);
      }
      const agent = await readAgent(this.settings.folder);
      if (typeof agent === "object" && agent.refreshedMilliseconds !== heartbeat) {
        heartbeat = agent.refreshedMilliseconds;
        heard = Date.now();
      }
      if (Date.now() - heard > this.settings.staleAfterMilliseconds) {
        await cancel();
        throw new SetupError(`${command.label}: the lane agent of desktop lane ${name} stopped answering (no heartbeat for ${Math.round(this.settings.staleAfterMilliseconds / 1000)} s); the command may still be running in that lane's session.`);
      }
      await sleep(this.settings.pollMilliseconds);
    }
  }

  private statusOf(command: LaneCommand, exit: LaneExit): number {
    const lane = `desktop lane ${this.settings.name}`;
    if (command.signal?.aborted === true) {
      throw new SetupError(`${command.label}: ${command.command} on ${lane} was stopped because the run was stopped; nothing it wrote is trusted.`);
    }
    switch (exit.kind) {
      case "exited": return exit.status;
      case "signal": throw new SetupError(`${command.label}: ${command.command} on ${lane} ended from signal ${exit.signal}; nothing it wrote is trusted.`);
      case "failed": throw new SetupError(`${command.label}: ${lane}: ${exit.message}`);
      case "stopped": throw new SetupError(`${command.label}: ${command.command} on ${lane} was stopped by its lane agent; nothing it wrote is trusted.`);
    }
  }

  private async exitOf(label: string, path: string): Promise<LaneExit | null> {
    try {
      return await readExit(path);
    } catch (error) {
      throw new SetupError(`${label}: the exit file ${path} of desktop lane ${this.settings.name} cannot be read: ${(error as Error).message}`);
    }
  }

  /** Passes the bytes the log gained since the offset and returns the new offset; a log not yet created has none. */
  private async pump(path: string, offset: number, push: (bytes: Buffer) => void): Promise<number> {
    let handle;
    try {
      handle = await open(path, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return offset;
      throw error;
    }
    try {
      const buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) return offset;
        push(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
    } finally {
      await handle.close();
    }
  }

  /** The folder's running agent; starts it when the lane says how and it is not running. */
  private async runningAgent(signal: AbortSignal | undefined): Promise<AgentDocument> {
    const running = await this.freshAgent(signal);
    if (running !== null) return running;
    const { name, folder, startAgent } = this.settings;
    if (startAgent === null) {
      throw new SetupError(`The lane agent of desktop lane ${name} is not running; start \`npm run lane-agent -- --folder "${folder}"\` in that lane's session.`);
    }
    // Commands that find the agent missing together share one start: a second agent would take its folder over.
    if (this.starting === null) {
      const starting = this.startAndAwait(startAgent, signal).finally(() => {
        if (this.starting === starting) this.starting = null;
      });
      this.starting = starting;
    }
    return this.starting;
  }

  private async startAndAwait(startAgent: (signal?: AbortSignal) => Promise<void>, signal: AbortSignal | undefined): Promise<AgentDocument> {
    const { name } = this.settings;
    await startAgent(signal);
    const deadline = Date.now() + this.settings.startWaitMilliseconds;
    for (;;) {
      const started = await this.freshAgent(signal);
      if (started !== null) return started;
      if (Date.now() > deadline) {
        throw new SetupError(`The lane agent of desktop lane ${name} did not start within ${Math.round(this.settings.startWaitMilliseconds / 1000)} s of being started; check that lane's session.`);
      }
      await sleep(this.settings.pollMilliseconds);
    }
  }

  private async freshAgent(signal: AbortSignal | undefined): Promise<AgentDocument | null> {
    const look = await this.watch.look(signal);
    if (look === "unreadable") throw new SetupError(`The lane agent file of desktop lane ${this.settings.name} in ${this.settings.folder} cannot be read.`);
    if (signal?.aborted === true) throw new SetupError(`The lane agent of desktop lane ${this.settings.name} was not awaited because the run was stopped.`);
    return look === "not-running" ? null : look.running;
  }
}
