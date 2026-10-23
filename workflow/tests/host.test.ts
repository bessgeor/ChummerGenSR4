import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { CpuPool, defaultCpuPoolSize } from "../src/host/cpu-pool.js";
import { DesktopLane, type DesktopLaneSettings } from "../src/host/desktop-lane.js";
import { ProcessHostRunner } from "../src/host/host-runner.js";
import { SetupError } from "../src/host/setup-error.js";
import { stopAppsUnder } from "../src/host/stray-apps.js";
import { LanePool } from "../src/lanes/lane-pool.js";

function laneSettings(lockPath: string, overrides: Partial<DesktopLaneSettings> = {}): DesktopLaneSettings & { lines: string[] } {
  const lines: string[] = [];
  return {
    name: "desktop", lockPath, pollMilliseconds: 10, unreadableTimeoutMilliseconds: 100, heartbeatMilliseconds: 20, staleAfterMilliseconds: 60_000,
    host: "this-host", processId: 1000,
    isRunning: () => true, log: (line) => lines.push(line), lines, ...overrides,
  };
}

/** One local lane with the lock. */
function poolOf(lock: DesktopLane): LanePool {
  return new LanePool([{ name: "desktop", lock, remote: null }], 10, { host: "this-host", user: "me" });
}

function lockFolder(): string {
  return mkdtempSync(join(tmpdir(), "workflow-lane-"));
}

function writeLock(path: string, processId: number, host = "this-host", token = "other"): void {
  writeFileSync(path, JSON.stringify({ host, processId, startedUtc: "2026-01-01T00:00:00Z", token }));
}

test("the lane is created, released, and can be taken again", async () => {
  const path = join(lockFolder(), "nested", "lane.lock");
  const lane = new DesktopLane(laneSettings(path));
  const release = await lane.acquire();
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 1000);
  await release();
  equal(existsSync(path), false);
  await (await lane.acquire())();
});

test("a running owner is waited for and announced once", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42);
  const settings = laneSettings(path);
  const acquired = new DesktopLane(settings).acquire();
  await new Promise((resolve) => setTimeout(resolve, 60));
  equal(existsSync(path), true);
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 42);
  (await import("node:fs")).unlinkSync(path);
  const release = await acquired;
  equal(settings.lines.filter((line) => line.startsWith("Waiting")).length, 1);
  ok(settings.lines[0]!.includes("42"));
  await release();
});

test("a lock of a process on this host that is no longer running is taken over", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42);
  const settings = laneSettings(path, { isRunning: (id) => id !== 42 });
  const release = await new DesktopLane(settings).acquire();
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 1000);
  ok(settings.lines.some((line) => line.includes("Taking over")));
  await release();
});

test("a lock of another host is taken over only once this process saw it unchanged for the stale time", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42, "other-host");
  // The other host's clock is years behind, and its process ID means nothing here.
  let behind = Date.UTC(2001, 0, 1) / 1000;
  utimesSync(path, behind, behind);
  const beating = setInterval(() => utimesSync(path, ++behind, behind), 30);
  const settings = laneSettings(path, { isRunning: () => false, staleAfterMilliseconds: 300 });
  const acquired = new DesktopLane(settings).acquire();
  await new Promise((resolve) => setTimeout(resolve, 500));
  clearInterval(beating);
  equal(JSON.parse(readFileSync(path, "utf8")).host, "other-host", "a refreshed lock is waited for");
  const release = await acquired;
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 1000);
  ok(settings.lines.some((line) => line.includes("Taking over") && line.includes("has not changed")), settings.lines.join("\n"));
  await release();
});

test("a lane held by another command of the same process is waited for without an announcement", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 1000, "this-host");
  const settings = laneSettings(path);
  const acquired = new DesktopLane(settings).acquire();
  await new Promise((resolve) => setTimeout(resolve, 60));
  (await import("node:fs")).unlinkSync(path);
  await (await acquired)();
  deepStrictEqual(settings.lines, []);
});

test("a lock that stays unreadable is a setup error naming the file", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeFileSync(path, "not json");
  await rejects(new DesktopLane(laneSettings(path)).acquire(), (error: Error) => error instanceof SetupError && error.message.includes(path));
});

test("release refuses a lock that another owner replaced", async () => {
  const path = join(lockFolder(), "lane.lock");
  const release = await new DesktopLane(laneSettings(path)).acquire();
  writeLock(path, 7);
  await rejects(release(), SetupError);
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 7);
});

test("the CPU pool never runs more than its size at once", async () => {
  const pool = new CpuPool(2);
  let active = 0;
  let peak = 0;
  const work = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
  };
  await Promise.all(Array.from({ length: 7 }, () => pool.run(work)));
  equal(peak, 2);
  throws(() => new CpuPool(0), RangeError);
  deepStrictEqual([defaultCpuPoolSize(1), defaultCpuPoolSize(4), defaultCpuPoolSize(32)], [1, 2, 4]);
});

function runner(output: string[]) {
  const lane = new DesktopLane(laneSettings(join(lockFolder(), "lane.lock")));
  return new ProcessHostRunner(process.cwd(), poolOf(lane), new CpuPool(1), (text) => output.push(text));
}

test("children report their status with prefixed output, on either resource", async () => {
  const output: string[] = [];
  const host = runner(output);
  equal(await host.run({ resource: "cpu", label: "one", command: process.execPath, args: ["-e", "console.log('a\\nb'); process.exit(2)"] }), 2);
  equal(await host.run({ resource: "desktop", label: "two", command: process.execPath, args: ["-e", "console.error('c')"] }), 0);
  deepStrictEqual(output, ["[one] a\n", "[one] b\n", "[two] on desktop lane desktop\n", "[two] c\n"]);
});

test("a child that cannot start is a setup error and the lane is released", async () => {
  const lockPath = join(lockFolder(), "lane.lock");
  const host = new ProcessHostRunner(process.cwd(), poolOf(new DesktopLane(laneSettings(lockPath))), new CpuPool(1), () => {});
  await rejects(host.run({ resource: "cpu", label: "x", command: join(lockFolder(), "missing.exe"), args: [] }), SetupError);
  await rejects(host.run({ resource: "desktop", label: "y", command: join(lockFolder(), "missing.exe"), args: [] }), SetupError);
  equal(existsSync(lockPath), false);
});

test("a child that ends from a signal is a setup error and the lane is released", async () => {
  const lockPath = join(lockFolder(), "lane.lock");
  const signalled = ((): ChildProcess => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough() });
    setImmediate(() => child.emit("close", null, "SIGTERM"));
    return child;
  }) as unknown as typeof spawn;
  const host = new ProcessHostRunner(process.cwd(), poolOf(new DesktopLane(laneSettings(lockPath))), new CpuPool(1), () => {}, signalled);
  await rejects(host.run({ resource: "desktop", label: "z", command: "tool", args: [] }),
    (error: Error) => error instanceof SetupError && error.message.includes("SIGTERM"));
  equal(existsSync(lockPath), false);
});

test("an aborted run stops its child, starts no later one, and releases the lane", async () => {
  const lockPath = join(lockFolder(), "lane.lock");
  const host = new ProcessHostRunner(lockFolder(), poolOf(new DesktopLane(laneSettings(lockPath))), new CpuPool(1), () => {});
  const controller = new AbortController();
  const started = Date.now();
  const running = host.run({
    resource: "desktop", label: "slow", command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"], signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 300);
  await rejects(running, (error: Error) => error instanceof SetupError && /stopped/.test(error.message));
  ok(Date.now() - started < 30_000);
  equal(existsSync(lockPath), false);
  await rejects(host.run({ resource: "cpu", label: "late", command: process.execPath, args: ["-e", ""], signal: controller.signal }),
    (error: Error) => error instanceof SetupError && /not started/.test(error.message));
});

test("a waiter that judged a lock abandoned never removes a live lock created since", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42, "this-host", "abandoned");
  // The judgment of the owner happens after the waiter read the lock; by then another run replaced it.
  const settings = laneSettings(path, {
    isRunning: (id) => {
      if (id !== 42) return true;
      writeLock(path, 77, "this-host", "live");
      return false;
    },
  });
  const acquired = new DesktopLane(settings).acquire();
  // The waiter announces its wait only after the takeover attempt released its guard.
  for (let waited = 0; !settings.lines.some((line) => line.startsWith("Waiting for desktop lane")); waited += 10) {
    ok(waited < 10_000, "the waiter never announced its wait");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  equal(JSON.parse(readFileSync(path, "utf8")).token, "live");
  equal(existsSync(`${path}.takeover`), false);
  (await import("node:fs")).unlinkSync(path);
  const release = await acquired;
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 1000);
  await release();
});

test("a takeover guard that stays in place is a setup error naming it", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42);
  writeFileSync(`${path}.takeover`, "");
  const settings = laneSettings(path, { isRunning: (id) => id !== 42 });
  await rejects(new DesktopLane(settings).acquire(), (error: Error) => error instanceof SetupError && error.message.includes(`${path}.takeover`));
});
test("a waiter stops waiting for the lane when its run is stopped", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42);
  const controller = new AbortController();
  const acquired = new DesktopLane(laneSettings(path, { pollMilliseconds: 60_000 })).acquire(controller.signal);
  setTimeout(() => controller.abort(), 50);
  await rejects(acquired, (error: Error) => error instanceof SetupError && /was stopped/.test(error.message));
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 42);
  await rejects(new DesktopLane(laneSettings(path)).acquire(controller.signal), SetupError);
});

test("the owner refreshes the lock while it holds the lane", async () => {
  const path = join(lockFolder(), "lane.lock");
  const release = await new DesktopLane(laneSettings(path)).acquire();
  const created = statSync(path).mtimeMs;
  utimesSync(path, new Date(created - 60_000), new Date(created - 60_000));
  await new Promise((resolve) => setTimeout(resolve, 100));
  ok(statSync(path).mtimeMs > created - 1000);
  await release();
});

test("a lock nobody refreshes is abandoned even when a process with its ID exists", async () => {
  const path = join(lockFolder(), "lane.lock");
  writeLock(path, 42);
  const old = new Date(Date.now() - 120_000);
  utimesSync(path, old, old);
  const settings = laneSettings(path, { isRunning: () => true, staleAfterMilliseconds: 5000, heartbeatMilliseconds: 60_000 });
  const release = await new DesktopLane(settings).acquire();
  ok(settings.lines.some((line) => line.includes("Taking over") && line.includes("may belong to another program")), settings.lines.join("\n"));
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 1000);
  await release();
  writeLock(path, 42);
  const fresh = laneSettings(path, { isRunning: () => true, staleAfterMilliseconds: 60_000, heartbeatMilliseconds: 60_000 });
  const waiting = new DesktopLane(fresh).acquire();
  await new Promise((resolve) => setTimeout(resolve, 60));
  equal(JSON.parse(readFileSync(path, "utf8")).processId, 42);
  (await import("node:fs")).unlinkSync(path);
  await (await waiting)();
});

test("a lock problem at release does not replace the child's own failure", async () => {
  const lockPath = join(lockFolder(), "lane.lock");
  const output: string[] = [];
  const failing = ((): ChildProcess => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough() });
    setImmediate(() => {
      writeLock(lockPath, 7);
      child.emit("error", new Error("spawn dotnet ENOENT"));
    });
    return child;
  }) as unknown as typeof spawn;
  const host = new ProcessHostRunner(process.cwd(), poolOf(new DesktopLane(laneSettings(lockPath))), new CpuPool(1), (text) => output.push(text), failing);
  await rejects(host.run({ resource: "desktop", label: "w", command: "dotnet", args: [] }),
    (error: Error) => error instanceof SetupError && error.message.includes("could not be started"));
  ok(output.some((line) => line.includes("no longer belongs to this run")), output.join(""));
});
test("stopping a desktop command also stops the apps started from the run folders, and a cpu command does not", async () => {
  const root = lockFolder();
  const stopped: string[] = [];
  const output: string[] = [];
  const host = new ProcessHostRunner(root, poolOf(new DesktopLane(laneSettings(join(root, "lane.lock")))), new CpuPool(1), (text) => output.push(text), spawn,
    (folder) => stopped.push(folder));
  for (const resource of ["desktop", "cpu"] as const) {
    const controller = new AbortController();
    const running = host.run({ resource, label: resource, command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"], signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    await rejects(running, SetupError);
  }
  deepStrictEqual(stopped, [join(root, "out", "runs")]);

  const failing = new ProcessHostRunner(root, poolOf(new DesktopLane(laneSettings(join(root, "lane2.lock")))), new CpuPool(1), (text) => output.push(text), spawn,
    () => {
      throw new Error("powershell is missing");
    });
  const controller = new AbortController();
  const running = failing.run({ resource: "desktop", label: "d", command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"], signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  await rejects(running, SetupError);
  ok(output.some((line) => line.includes("could not be stopped: powershell is missing")), output.join(""));
});

test("apps that run from a folder are stopped and others are left alone", { skip: process.platform !== "win32" }, async () => {
  const root = lockFolder();
  const appFolder = join(root, "runs", "one", "apps");
  mkdirSync(appFolder, { recursive: true });
  const copy = join(appFolder, "sleeper.exe");
  copyFileSync(process.execPath, copy);
  const inside = spawn(copy, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const outside = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    stopAppsUnder(join(root, "runs"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    ok(inside.exitCode !== null || inside.signalCode !== null, "the app under the folder is still running");
    equal(outside.exitCode, null);
  } finally {
    inside.kill();
    outside.kill();
  }
});
