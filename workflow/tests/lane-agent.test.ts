import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DesktopLane } from "../src/host/desktop-lane.js";
import { SetupError } from "../src/host/setup-error.js";
import { agentFile, requestFiles, requestsFolder } from "../src/lanes/agent-protocol.js";
import { AgentLane, type AgentLaneSettings } from "../src/lanes/agent-lane.js";
import { LaneAgent } from "../src/lanes/lane-agent.js";
import { AgentWatch } from "../src/lanes/agent-watch.js";

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

function agent(setup: Fixture, overrides: { user?: string; isRunning?: (id: number) => boolean; retention?: number; heartbeat?: number } = {}): LaneAgent {
  return new LaneAgent({
    folder: setup.laneFolder, host: "vm", user: overrides.user ?? "runner", processId: process.pid,
    pollMilliseconds: 20, heartbeatMilliseconds: overrides.heartbeat ?? 50, staleAfterMilliseconds: 500, answeredRetentionMilliseconds: overrides.retention ?? 60_000,
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
    for (let waited = 0; !setup.log.some((line) => line.startsWith("Waiting for desktop lane of this session")); waited += 20) {
      ok(waited < 10_000, setup.log.join("\n"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    await rejects(waiting, (error: Error) => error instanceof SetupError && /was stopped because the run was stopped/.test(error.message));
    equal(JSON.parse(readFileSync(setup.sessionLock, "utf8")).token, "local-run");
    deepStrictEqual(setup.stopped, [], "the apps in the session belong to the lock's holder");
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
  // The expectation is attached at once: the request fails while the agent is being stopped.
  const failed = rejects(remote.run(node("setTimeout(() => {}, 60000)"), setup.workingFolder, () => {}),
    (error: Error) => error instanceof SetupError && error.message.includes("The lane agent was stopped while it ran the command"));
  for (let waited = 0; !setup.log.some((line) => line.endsWith(": job (desktop)")); waited += 20) {
    ok(waited < 10_000, "the agent never began the request");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await first.stop();
  await failed;

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

  // An agent that refreshes its file for a while and is then killed without a chance to remove it.
  mkdirSync(setup.laneFolder, { recursive: true });
  writeFileSync(agentFile(setup.laneFolder), JSON.stringify({ host: "vm", user: "runner", processId: 1, startedUtc: "2026-01-01T00:00:00Z", token: "gone" }));
  const beating = setInterval(() => {
    const now = new Date();
    utimesSync(agentFile(setup.laneFolder), now, now);
  }, 30);
  const remote = lane(setup);
  try {
    await remote.identity();
  } finally {
    clearInterval(beating);
  }
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

test("an agent counts as running when its file changes as seen here, whatever clock set its time", async () => {
  const setup = fixture();
  mkdirSync(setup.laneFolder, { recursive: true });
  const file = agentFile(setup.laneFolder);
  writeFileSync(file, JSON.stringify({ host: "vm", user: "runner", processId: 1, startedUtc: "2001-01-01T00:00:00Z", token: "behind" }));
  // The agent's clock is years behind, yet it refreshes the file.
  let behind = Date.UTC(2001, 0, 1) / 1000;
  utimesSync(file, behind, behind);
  const beating = setInterval(() => utimesSync(file, ++behind, behind), 30);
  try {
    deepStrictEqual(await lane(setup).identity(), { host: "vm", user: "runner" });
  } finally {
    clearInterval(beating);
  }
  // A clock years ahead makes a file nobody refreshes look new; it is still not running.
  const ahead = Date.UTC(2100, 0, 1) / 1000;
  utimesSync(file, ahead, ahead);
  const started = Date.now();
  await rejects(lane(setup).identity(), (error: Error) => error instanceof SetupError && /is not running/.test(error.message));
  ok(Date.now() - started >= 500);
});

test("a change seen after a long gap between looks does not count as a heartbeat heard now", async () => {
  const setup = fixture();
  mkdirSync(setup.laneFolder, { recursive: true });
  const file = agentFile(setup.laneFolder);
  writeFileSync(file, JSON.stringify({ host: "vm", user: "runner", processId: 1, startedUtc: "2026-01-01T00:00:00Z", token: "gone" }));
  let beats = 0;
  const beat = () => {
    const now = new Date(Date.now() + ++beats * 1000);
    utimesSync(file, now, now);
  };
  const remote = lane(setup);
  const beating = setInterval(beat, 30);
  try {
    deepStrictEqual(await remote.identity(), { host: "vm", user: "runner" });
    // The agent keeps beating while nobody looks, then its session closes.
    await new Promise((resolve) => setTimeout(resolve, 800));
  } finally {
    clearInterval(beating);
  }
  const started = Date.now();
  // The assertion names the error it got, so a failure shows which way the run was refused.
  await rejects(remote.run(node("process.exit(0)"), setup.workingFolder, () => {}), (error: Error) => {
    ok(error instanceof SetupError, `not a setup error: ${error.stack ?? error.message}`);
    ok(error.message.includes(`npm run lane-agent -- --folder "${setup.laneFolder}"`), `another setup error: ${error.message}`);
    return true;
  });
  ok(Date.now() - started >= 500, "the change seen after the gap starts a new observation that has to see another one");
  ok(!existsSync(requestsFolder(setup.laneFolder)) || readdirSync(requestsFolder(setup.laneFolder)).length === 0, "no request went to the silent agent");

  // A watch that is looked at again within the stale time hears the change at once.
  const watch = new AgentWatch(setup.laneFolder, 500, 20);
  const again = setInterval(beat, 30);
  try {
    ok(typeof (await watch.look()) === "object");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const looked = Date.now();
    ok(typeof (await watch.look()) === "object");
    ok(Date.now() - looked < 100);
  } finally {
    clearInterval(again);
  }
});
test("stopping an agent while its heartbeat is refreshing is a normal stop", async () => {
  for (let attempt = 0; attempt < 15; attempt++) {
    const setup = fixture();
    const served = agent(setup, { heartbeat: 1 });
    await served.start();
    await new Promise((resolve) => setTimeout(resolve, attempt % 5));
    await served.stop();
    await served.wait();
    equal(existsSync(agentFile(setup.laneFolder)), false);
    ok(!setup.log.some((line) => line.startsWith("Lane agent failed")), setup.log.join("\n"));
  }
});

test("commands that find the agent missing together start it once", async () => {
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
    const identities = await Promise.all([remote.identity(), remote.identity(), remote.identity()]);
    deepStrictEqual(identities, Array(3).fill({ host: "vm", user: "runner" }));
    equal(starts, 1);
  } finally {
    await served.stop();
  }
});
test("a heartbeat that cannot read the agent's file once does not stop the agent, and a file that stays unreadable does", async () => {
  const setup = fixture();
  const served = agent(setup);
  await served.start();
  const file = agentFile(setup.laneFolder);
  const original = readFileSync(file, "utf8");
  writeFileSync(file, "{");
  await new Promise((resolve) => setTimeout(resolve, 70));
  writeFileSync(file, original);
  const remote = lane(setup);
  await remote.identity();
  equal(await remote.run(node("process.exit(0)", false), setup.workingFolder, () => {}), 0);
  ok(!setup.log.some((line) => line.startsWith("Lane agent failed")), setup.log.join("\n"));

  writeFileSync(file, "{");
  await rejects(served.wait(), /no longer belongs to this agent/);
  await served.stop();
});
test("the files of an answered request that no workflow collects are removed after the retention", async () => {
  const setup = fixture();
  const served = agent(setup, { retention: 200 });
  mkdirSync(requestsFolder(setup.laneFolder), { recursive: true });
  const files = requestFiles(setup.laneFolder, "uncollected");
  writeFileSync(files.request, JSON.stringify({ id: "uncollected", label: "x", command: process.execPath, args: ["-e", ""], cwd: setup.workingFolder, desktop: false }));
  await served.start();
  try {
    // The files of the request are removed together, and a reader may see the folder between two removals; the
    // agent logs the removal once every file is gone, which a reader may see a moment after the folder is empty.
    const removed = () => setup.log.some((line) => line.startsWith("uncollected: removed"));
    for (let waited = 0; readdirSync(requestsFolder(setup.laneFolder)).length > 0 || !removed(); waited += 20) {
      ok(waited < 10_000, `the request was never removed: ${readdirSync(requestsFolder(setup.laneFolder)).join(", ")}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    deepStrictEqual(readdirSync(requestsFolder(setup.laneFolder)), []);
    ok(setup.log.some((line) => line.startsWith("uncollected: removed")), setup.log.join("\n"));
  } finally {
    await served.stop();
  }
});