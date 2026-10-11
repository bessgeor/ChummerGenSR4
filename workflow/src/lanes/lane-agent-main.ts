// `npm run lane-agent -- --folder <dir>` serves a desktop lane in this session until Ctrl+C; exits with 0 when stopped, 3 on a setup error.
import { spawn } from "node:child_process";
import { hostname, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { defaultLaneSettings, DesktopLane } from "../host/desktop-lane.js";
import { SetupError } from "../host/setup-error.js";
import { stopAppsUnder } from "../host/stray-apps.js";
import { localDataFolder } from "../options/profile.js";
import { agentHeartbeatMilliseconds, agentStaleAfterMilliseconds } from "./agent-protocol.js";
import { LaneAgent } from "./lane-agent.js";

const usage = `Usage: npm run lane-agent -- --folder <dir>

Serves the desktop lane of <dir> (or LANE_AGENT_FOLDER) in this Windows session: runs the
commands a workflow writes to <dir>/requests/, a desktop command under this session's desktop
lock, until Ctrl+C. Every path a command names, the repository first, must be the same here as
on the machine that sends it. Exit status: 0 when stopped, 3 on a setup error.`;

function folderOf(args: readonly string[]): string | "help" {
  if (args.includes("--help")) return "help";
  let folder = process.env["LANE_AGENT_FOLDER"];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--folder" && args[index + 1] !== undefined) folder = args[++index];
    else throw new SetupError(`Unknown or incomplete option ${arg}; see --help.`);
  }
  if (folder === undefined || folder.length === 0) throw new SetupError("Name the lane folder with --folder <dir> or LANE_AGENT_FOLDER.");
  return resolve(folder);
}

async function main(): Promise<number> {
  const log = (line: string) => console.log(line);
  const folder = folderOf(process.argv.slice(2));
  if (folder === "help") {
    log(usage);
    return 0;
  }
  const agent = new LaneAgent({
    folder, host: hostname(), user: userInfo().username, processId: process.pid,
    pollMilliseconds: 200, heartbeatMilliseconds: agentHeartbeatMilliseconds, staleAfterMilliseconds: agentStaleAfterMilliseconds,
    sessionLane: new DesktopLane(defaultLaneSettings("of this session", join(localDataFolder(process.env), "desktop-lane.lock"), log)),
    spawnProcess: spawn, stopApps: stopAppsUnder, log,
  });
  const document = await agent.start();
  log(`Lane agent serving ${folder} as ${document.user} on ${document.host} (process ${document.processId}); Ctrl+C stops it.`);
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) {
    process.on(signal, () => {
      log(`Stopping the lane agent (${signal}).`);
      void agent.stop();
    });
  }
  await agent.wait();
  log("Lane agent stopped.");
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `lane-agent failed: ${(error as Error).stack ?? String(error)}`);
  return 3;
});
