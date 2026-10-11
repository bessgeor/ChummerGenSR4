import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopLane } from "../host/desktop-lane.js";
import { killTree } from "../host/host-runner.js";
import { SetupError } from "../host/setup-error.js";
import {
  agentFile, LaneRequestSchema, readAgent, requestFiles, requestIdOf, requestsFolder, writeAtomically,
  type AgentDocument, type LaneExit, type LaneRequest,
} from "./agent-protocol.js";

export type LaneAgentSettings = {
  readonly folder: string;
  readonly host: string;
  readonly user: string;
  readonly processId: number;
  readonly pollMilliseconds: number;
  readonly heartbeatMilliseconds: number;
  /** An `agent.json` refreshed within this time belongs to a running agent. */
  readonly staleAfterMilliseconds: number;
  /** The desktop lock of the agent's own session, held while a desktop request runs. */
  readonly sessionLane: DesktopLane;
  readonly spawnProcess: typeof spawn;
  /** Stops the apps of this session that run from the folder. */
  readonly stopApps: (folder: string) => void;
  readonly log: (line: string) => void;
};

/** A request the agent runs, and why it is being stopped, if it is. */
type Running = {
  readonly id: string;
  readonly controller: AbortController;
  request: LaneRequest | null;
  child: ChildProcess | null;
  stopping: "cancel" | "agent" | null;
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Serves a lane folder in this session: runs each request side by side in its working folder, a desktop request under
 * the session's desktop lock, writes its output to the request's log and then its exit, and stops a request whose
 * cancel file appears with its process tree and, for a desktop request, the apps it started.
 */
export class LaneAgent {
  private readonly running = new Map<string, { readonly run: Running; readonly done: Promise<void> }>();
  /** Requests that have an exit, until the workflow removes their files. */
  private readonly answered = new Set<string>();
  private readonly token = randomUUID();
  private heartbeat: NodeJS.Timeout | null = null;
  private serving: Promise<void> | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private failure: Error | null = null;

  constructor(private readonly settings: LaneAgentSettings) {}

  /** Claims the folder, fails the requests a previous agent left unanswered and starts serving. */
  async start(): Promise<AgentDocument> {
    const { folder } = this.settings;
    await mkdir(requestsFolder(folder), { recursive: true });
    const current = await readAgent(folder);
    if (typeof current === "object" && Date.now() - current.refreshedMilliseconds <= this.settings.staleAfterMilliseconds) {
      const other = current.document;
      throw new SetupError(`Another lane agent (process ${other.processId} of ${other.user} on ${other.host}, started ${other.startedUtc}) serves ${folder}; stop it first.`);
    }
    const document: AgentDocument = {
      host: this.settings.host, user: this.settings.user, processId: this.settings.processId, startedUtc: new Date().toISOString(), token: this.token,
    };
    for (const id of await this.requestIds()) {
      if (existsSync(requestFiles(folder, id).exit)) continue;
      await this.answer(id, { kind: "failed", message: "The lane agent was not running when this request was sent, or stopped while it ran it." });
    }
    // Publish the heartbeat only after stale requests have been answered. Otherwise a workflow can see this
    // agent, submit a new request, and have the startup scan incorrectly fail it as an old request.
    await writeAtomically(agentFile(folder), `${JSON.stringify(document, null, 2)}\n`);
    this.heartbeat = setInterval(() => void this.beat(), this.settings.heartbeatMilliseconds);
    this.serving = this.serve();
    return document;
  }

  /** Resolves when the agent was stopped and gave up the folder; rejects when it failed. */
  async wait(): Promise<void> {
    await this.serving;
    await this.stopping;
    if (this.failure !== null) throw this.failure;
  }

  /** Stops every running request, fails it, and gives up the folder. */
  stop(): Promise<void> {
    this.stopping ??= this.giveUp();
    return this.stopping;
  }

  private async giveUp(): Promise<void> {
    this.stopped = true;
    for (const { run } of this.running.values()) this.cancel(run, "agent");
    await Promise.all([...this.running.values()].map((entry) => entry.done));
    await this.serving;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    const current = await readAgent(this.settings.folder);
    if (typeof current === "object" && current.document.token === this.token) await rm(agentFile(this.settings.folder), { force: true });
  }

  /** Refreshes the heartbeat; another agent's file in its place stops this one. */
  private async beat(): Promise<void> {
    try {
      const current = await readAgent(this.settings.folder);
      if (typeof current !== "object" || current.document.token !== this.token) {
        throw new SetupError(`${agentFile(this.settings.folder)} no longer belongs to this agent; another agent took the folder over.`);
      }
      const now = new Date();
      await utimes(agentFile(this.settings.folder), now, now);
    } catch (error) {
      this.fail(error as Error);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.settings.log(`Lane agent failed: ${error.message}`);
    void this.stop();
  }

  private async serve(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.scan();
      } catch (error) {
        this.fail(error as Error);
        return;
      }
      await sleep(this.settings.pollMilliseconds);
    }
  }

  private async requestIds(): Promise<string[]> {
    return (await readdir(requestsFolder(this.settings.folder))).flatMap((name) => {
      const id = requestIdOf(name);
      return id === null ? [] : [id];
    });
  }

  private async scan(): Promise<void> {
    const { folder } = this.settings;
    const ids = new Set(await this.requestIds());
    for (const id of ids) {
      if (this.stopped) return;
      if (this.running.has(id) || this.answered.has(id) || existsSync(requestFiles(folder, id).exit)) continue;
      this.begin(id);
    }
    for (const { run } of this.running.values()) {
      if (run.stopping === null && existsSync(requestFiles(folder, run.id).cancel)) this.cancel(run, "cancel");
    }
    for (const id of this.answered) if (!ids.has(id)) this.answered.delete(id);
  }

  private begin(id: string): void {
    const run: Running = { id, controller: new AbortController(), request: null, child: null, stopping: null };
    const done = this.execute(run)
      .catch((error: Error): LaneExit => ({ kind: "failed", message: error.message }))
      .then((exit) => this.answer(id, exit))
      .catch((error: Error) => this.fail(error))
      .finally(() => this.running.delete(id));
    this.running.set(id, { run, done });
  }

  private async answer(id: string, exit: LaneExit): Promise<void> {
    await writeAtomically(requestFiles(this.settings.folder, id).exit, `${JSON.stringify(exit)}\n`);
    this.answered.add(id);
    this.settings.log(`${id}: ${exit.kind === "exited" ? `exited with ${exit.status}` : exit.kind === "failed" ? `failed: ${exit.message}` : exit.kind}`);
  }

  private stoppedExit(run: Running): LaneExit {
    return run.stopping === "cancel" ? { kind: "stopped" } : { kind: "failed", message: "The lane agent was stopped while it ran the command." };
  }

  private async execute(run: Running): Promise<LaneExit> {
    const files = requestFiles(this.settings.folder, run.id);
    let request: LaneRequest;
    try {
      request = LaneRequestSchema.parse(JSON.parse(await readFile(files.request, "utf8")));
    } catch (error) {
      return { kind: "failed", message: `The request ${files.request} cannot be read: ${(error as Error).message}` };
    }
    if (request.id !== run.id) return { kind: "failed", message: `The request ${files.request} names another ID, ${request.id}.` };
    run.request = request;
    if (!existsSync(request.cwd)) {
      return { kind: "failed", message: `This lane cannot see the working folder ${request.cwd}; every path a command names must be the same in the lane's session.` };
    }
    this.settings.log(`${run.id}: ${request.label}${request.desktop ? " (desktop)" : ""}`);
    let release: (() => Promise<void>) | null = null;
    if (request.desktop) {
      try {
        release = await this.settings.sessionLane.acquire(run.controller.signal);
      } catch (error) {
        if (run.stopping !== null) return this.stoppedExit(run);
        throw error;
      }
    }
    try {
      return run.stopping !== null ? this.stoppedExit(run) : await this.spawnRequest(run, request, files.log);
    } finally {
      // The exit is written only after the session's desktop is free again.
      if (release !== null) await release();
    }
  }

  private spawnRequest(run: Running, request: LaneRequest, logPath: string): Promise<LaneExit> {
    return new Promise((resolve) => {
      const log = createWriteStream(logPath, { flags: "a" });
      const settle = (exit: LaneExit) => log.end(() => resolve(exit));
      let child: ChildProcess;
      try {
        child = this.settings.spawnProcess(request.command, request.args, { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        settle({ kind: "failed", message: `${request.command} could not be started: ${(error as Error).message}` });
        return;
      }
      run.child = child;
      child.stdout!.pipe(log, { end: false });
      child.stderr!.pipe(log, { end: false });
      let started = true;
      child.on("error", (error) => {
        started = false;
        settle({ kind: "failed", message: `${request.command} could not be started: ${error.message}` });
      });
      child.on("close", (code, signal) => {
        if (!started) return;
        if (run.stopping !== null) settle(this.stoppedExit(run));
        else settle(code === null ? { kind: "signal", signal: signal ?? "unknown" } : { kind: "exited", status: code });
      });
    });
  }

  private cancel(run: Running, why: "cancel" | "agent"): void {
    run.stopping = why;
    run.controller.abort();
    if (run.child !== null) killTree(run.child);
    if (run.request?.desktop === true) {
      try {
        this.settings.stopApps(join(run.request.cwd, "out", "runs"));
      } catch (error) {
        this.settings.log(`${run.id}: the apps started from ${join(run.request.cwd, "out", "runs")} could not be stopped: ${(error as Error).message}`);
      }
    }
  }
}
