import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { CpuPool } from "./cpu-pool.js";
import type { DesktopLane } from "./desktop-lane.js";
import { SetupError } from "./setup-error.js";
import { stopAppsUnder } from "./stray-apps.js";

export type HostResource = "desktop" | "cpu";

export type HostCommand = {
  readonly resource: HostResource;
  /** Prefix of every output line, for example `capture build-Diego`. */
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  /** When it aborts, the child and its descendants are killed and the run is a setup error. */
  readonly signal?: AbortSignal;
};

/** Runs child processes on the host, each under the resource it needs. */
export interface HostRunner {
  /** The child's exit status; a child that cannot start or ends from a signal is a setup error. */
  run(command: HostCommand): Promise<number>;
}

function prefixLines(label: string, write: (text: string) => void) {
  let pending = "";
  return {
    push(chunk: string) {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) write(`[${label}] ${line}\n`);
    },
    flush() {
      if (pending.length > 0) write(`[${label}] ${pending}\n`);
      pending = "";
    },
  };
}

/** Ends a child and everything it started; a capture run owns Chummer processes that must not outlive it. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).on("error", () => child.kill());
  } else {
    child.kill("SIGKILL");
  }
}

/** Starts children with the repository root as working directory and their output prefixed by their label. */
export class ProcessHostRunner implements HostRunner {
  constructor(
    private readonly repositoryRoot: string,
    private readonly lane: DesktopLane,
    private readonly pool: CpuPool,
    private readonly write: (text: string) => void,
    private readonly spawnProcess: typeof spawn = spawn,
    private readonly stopStrayApps: (folder: string) => void = stopAppsUnder,
  ) {}

  async run(command: HostCommand): Promise<number> {
    if (command.resource === "cpu") {
      return this.pool.run(() => this.spawnChild(command));
    }
    const release = await this.lane.acquire(command.signal);
    let status: number | undefined;
    let failure: unknown;
    try {
      status = await this.spawnChild(command);
    } catch (error) {
      failure = error;
    }
    try {
      await release();
    } catch (error) {
      // The child's own failure is the cause worth reporting; a lock problem must not replace it.
      if (failure === undefined) throw error;
      this.write(`[${command.label}] ${(error as Error).message}\n`);
    }
    if (failure !== undefined) throw failure;
    return status!;
  }

  /** Stops the apps a stopped capture left running: its runner may have died before its process tree could be killed. */
  private stopApps(label: string): void {
    try {
      this.stopStrayApps(join(this.repositoryRoot, "out", "runs"));
    } catch (error) {
      this.write(`[${label}] The apps started from ${join(this.repositoryRoot, "out", "runs")} could not be stopped: ${(error as Error).message}\n`);
    }
  }

  private spawnChild(command: HostCommand): Promise<number> {
    return new Promise((resolve, reject) => {
      if (command.signal?.aborted === true) {
        reject(new SetupError(`${command.label}: not started because the run was stopped.`));
        return;
      }
      const child = this.spawnProcess(command.command, [...command.args], { cwd: this.repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
      const out = prefixLines(command.label, this.write);
      const err = prefixLines(command.label, this.write);
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => out.push(chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => err.push(chunk));
      let aborted = false;
      const abort = () => {
        aborted = true;
        killTree(child);
        if (command.resource === "desktop") this.stopApps(command.label);
      };
      command.signal?.addEventListener("abort", abort, { once: true });
      child.on("error", (error) => reject(new SetupError(`${command.label}: ${command.command} could not be started: ${error.message}`)));
      child.on("close", (code, signal) => {
        command.signal?.removeEventListener("abort", abort);
        out.flush();
        err.flush();
        if (aborted) {
          reject(new SetupError(`${command.label}: ${command.command} was stopped because the run was stopped; nothing it wrote is trusted.`));
        } else if (code === null) {
          reject(new SetupError(`${command.label}: ${command.command} ended from signal ${signal ?? "unknown"}; nothing it wrote is trusted.`));
        } else {
          resolve(code);
        }
      });
    });
  }
}
