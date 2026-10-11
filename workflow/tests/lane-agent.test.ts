import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DesktopLane } from "../src/host/desktop-lane.js";
import { SetupError } from "../src/host/setup-error.js";
import { agentFile, requestFiles, requestsFolder } from "../src/lanes/agent-protocol.js";
import { AgentLane, type AgentLaneSettings } from "../src/lanes/agent-lane.js";
import { LaneAgent } from "../src/lanes/lane-agent.js";

function folder(): string {
  return mkdtempSync(join(tmpdir(), "workflow-agent-"));
}

type Fixture = { readonly laneFolder: string; readonly workingFolder: string; readonly sessionLock: string; readonly stopped: string[]; readonly log: string[] };

function fixture(): Fixture {
  const root = folder();
  const workingFolder = join(root, "repository");
  mkdirSync(workingFolder, { recursive: true });
  return { laneFolder: join(root, "lane"), workingFolder, sessionLock: join(root, "session.lock"), stopped: [], log: [] };
}

function agent(setup: Fixture, overrides: { user?: string; isRunning?: (id: number) => boolean } = {}): LaneAgent {
  return new LaneAgent({
    folder: setup.laneFolder, host: "vm", user: overrides.user ?? "runner", processId: process.pid,
    pollMilliseconds: 20, heartbeatMilliseconds: 50, staleAfterMilliseconds: 500,
    sessionLane: new DesktopLane({
      name: "of this session", lockPath: setup.sessionLock, pollMilliseconds: 20, unreadableTimeoutMilliseconds: 1000, heartbeatMilliseconds: 50,
      staleAfterMilliseconds: 60_000, host: "vm", processId: 1000, isRunning: overrides.isRunning ?? (() => true), log: (line) => setup.log.push(line),
    }),
    spawnProcess: spawn, stopApps: (path) => setup.stopped.push(path), log: (line) => setup.log.push(line),
  });
}

function lane(setup: Fixture, overrides: Partial<AgentLaneSettings> = {}): AgentLane {
  return new AgentLane({
    name: "vm", folder: setup.laneFolder, pollMilliseconds: 20, staleAfterMilliseconds: 500, cancelWaitMilliseconds: 5000, startWaitMilliseconds: 1000,
    startAgent: null, now: () => new Date(), ...overrides,
  });
}

const node = (script: string, desktop = true, signal?: AbortSignal) => ({
  label: "job", command: process.execPath, args: ["-e", script], desktop, ...(signal === undefined ? {} : { signal }),
});

test("a request runs through the agent: its output is printed with the label, its status returned and its files removed", async () => {
  const setup = fixture();
  const served = agent(setup);
  await served.start();
  try {
    const remote = lane(setup);
    deepStrictEqual(await remote.identity(), { host: "vm", user: "runner" });
    const output: string[] = [];
    const status = await remote.run(node("console.log('a\\nü'); console.error('b'); console.log(process.cwd()); process.exit(3)"), setup.workingFolder, (text) => output.push(text));
    equal(status, 3);
    ok(output.includes("[job] a\n") && output.includes("[job] ü\n") && output.includes("[job] b\n"), output.join(""));
    ok(output.includes(`[job] ${setup.workingFolder}\n`), output.join(""));
    deepStrictEqual(readdirSync(requestsFolder(setup.laneFolder)), []);
    equal(existsSync(setup.sessionLock), false);
  } finally {
    await served.stop();
  }
  equal(existsSync(agentFile(setup.laneFolder)), false);
});

test("a desktop request waits for the session's desktop lock; a query does not", async () => {
  const setup = fixture();
  writeFileSync(setup.sessionLock, JSON.stringify({ host: "vm", processId: 42, startedUtc: "2026-01-01T00:00:00Z", token: "local-run" }));
  const served = agent(setup);
  await served.start();
  try {
    const remote = lane(setup);
    await remote.identity();
    equal(await remote.run(node("process.exit(0)", false), setup.workingFolder, () => {}), 0);
    const controller = new AbortController();
    const waiting = remote.run(node("process.exit(0)", true, controller.signal), setup.workingFolder, () => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    ok(setup.log.some((line) => line.startsWith("Waiting for desktop lane of this session")), setup.log.join("\n"));
    controller.abort();
    await rejects(waiting, (error: Error) => error instanceof SetupError && /was stopped because the run was stopped/.test(error.message));
    equal(JSON.parse(readFileSync(setup.sessionLock, "utf8")).token, "local-run");
  } finally {
    await served.stop();
  }
});

test("stopping the run cancels the request: the agent kills it and stops the apps started from the working folder", async () => {
  const setup = fixture();
  const served = agent(setup);
  await served.start();
  try {
    const remote = lane(setup);
    await remote.identity();
    const controller = new AbortController();
    const started = Date.now();
    const running = remote.run(node("console.log('up'); setTimeout(() => {}, 60000)", true, controller.signal), setup.workingFolder, () => {});
    setTimeout(() => controller.abort(), 300);
    await rejects(running, (error: Error) => error instanceof SetupError && /stopped/.test(error.message));
    ok(Date.now() - started < 20_000);
    deepStrictEqual(setup.stopped, [join(setup.workingFolder, "out", "runs")]);
    equal(existsSync(setup.sessionLock), false);
  } finally {
    await served.stop();
  }
});

test("a working folder the lane cannot see fails the request with a message naming it", async () => {
  const setup = fixture();
  const served = agent(setup);
  await served.start();
  try {
    const remote = lane(setup);
    await remote.identity();
    const missing = join(setup.workingFolder, "elsewhere");
    await rejects(remote.run(node("process.exit(0)"), missing, () => {}),
      (error: Error) => error instanceof SetupError && error.message.includes(`cannot see the working folder ${missing}`));
  } finally {
    await served.stop();
  }
});

test("stopping the agent fails its running request, and a restarted agent fails the requests it finds unanswered", async () => {
  const setup = fixture();
  const first = agent(setup);
  await first.start();
  const remote = lane(setup);
  await remote.identity();
  const running = remote.run(node("setTimeout(() => {}, 60000)"), setup.workingFolder, () => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  await first.stop();
  await rejects(running, (error: Error) => error instanceof SetupError && error.message.includes("The lane agent was stopped while it ran the command"));

  mkdirSync(requestsFolder(setup.laneFolder), { recursive: true });
  const left = requestFiles(setup.laneFolder, "left-behind");
  writeFileSync(left.request, JSON.stringify({ id: "left-behind", label: "old", command: process.execPath, args: [], cwd: setup.workingFolder, desktop: true }));
  const second = agent(setup);
  await second.start();
  try {
    deepStrictEqual(JSON.parse(readFileSync(left.exit, "utf8")), { kind: "failed", message: "The lane agent was not running when this request was sent, or stopped while it ran it." });
  } finally {
    await second.stop();
  }
});

test("a second agent refuses a folder another agent keeps fresh", async () => {
  const setup = fixture();
  const first = agent(setup);
  await first.start();
  try {
    await rejects(agent(setup, { user: "other" }).start(), (error: Error) => error instanceof SetupError && /Another lane agent/.test(error.message));
  } finally {
    await first.stop();
  }
});

test("an agent that stops answering fails the request after the stale time, and a missing agent names the command to start it", async () => {
  const setup = fixture();
  await rejects(lane(setup).identity(), (error: Error) => error instanceof SetupError && error.message.includes(`npm run lane-agent -- --folder "${setup.laneFolder}"`));

  // A file nobody refreshes: the agent was killed without a chance to remove it.
  mkdirSync(setup.laneFolder, { recursive: true });
  writeFileSync(agentFile(setup.laneFolder), JSON.stringify({ host: "vm", user: "runner", processId: 1, startedUtc: "2026-01-01T00:00:00Z", token: "gone" }));
  const remote = lane(setup);
  await remote.identity();
  const started = Date.now();
  await rejects(remote.run(node("process.exit(0)"), setup.workingFolder, () => {}),
    (error: Error) => error instanceof SetupError && /stopped answering/.test(error.message) && /may still be running/.test(error.message));
  ok(Date.now() - started >= 500);
  const request = readdirSync(requestsFolder(setup.laneFolder)).find((name) => name.endsWith(".json") && !name.endsWith(".exit.json"));
  ok(request !== undefined);
  ok(existsSync(requestFiles(setup.laneFolder, request.slice(0, -5)).cancel), "leave the cancel for an agent that resumes answering");
});

test("a lane that says how starts its agent and waits for it; one that never starts is a setup error", async () => {
  const setup = fixture();
  const served = agent(setup);
  let starts = 0;
  const remote = lane(setup, {
    startAgent: async () => {
      starts++;
      setTimeout(() => void served.start(), 100);
    },
  });
  try {
    deepStrictEqual(await remote.identity(), { host: "vm", user: "runner" });
    equal(starts, 1);
    equal(await remote.run(node("process.exit(0)"), setup.workingFolder, () => {}), 0);
    equal(starts, 1);
  } finally {
    await served.stop();
  }

  const never = lane(fixture(), { startAgent: async () => {}, startWaitMilliseconds: 200 });
  await rejects(never.identity(), (error: Error) => error instanceof SetupError && /did not start within/.test(error.message));
});

test("an agent that now runs as another user than the lanes were checked with is a setup error", async () => {
  const setup = fixture();
  const first = agent(setup);
  await first.start();
  const remote = lane(setup);
  await remote.identity();
  await first.stop();
  const second = agent(setup, { user: "someone-else" });
  await second.start();
  try {
    await rejects(remote.run(node("process.exit(0)"), setup.workingFolder, () => {}), /now runs as someone-else on vm/);
  } finally {
    await second.stop();
  }
});
