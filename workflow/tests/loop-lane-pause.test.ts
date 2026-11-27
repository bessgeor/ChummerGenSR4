import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CpuPool } from "../src/host/cpu-pool.js";
import { DesktopLane } from "../src/host/desktop-lane.js";
import { ProcessHostRunner } from "../src/host/host-runner.js";
import { SetupError } from "../src/host/setup-error.js";
import { controlFilePauses } from "../src/lanes/host-lanes.js";
import { LanePool } from "../src/lanes/lane-pool.js";
import type { LaneDefinition } from "../src/lanes/lane-settings.js";
import type { LaneCommand, LaneIdentity, RemoteLane } from "../src/lanes/remote-lane.js";
import { controlPath, lanePausedPath, setPaused } from "../src/loop/loop-control.js";

const now = () => new Date("2026-11-01T10:00:00Z");
const tick = (milliseconds = 40) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function folder(): string {
  return mkdtempSync(join(tmpdir(), "workflow-lane-pause-"));
}

function lock(name: string, path: string): DesktopLane {
  return new DesktopLane({
    name, lockPath: path, pollMilliseconds: 10, unreadableTimeoutMilliseconds: 100, heartbeatMilliseconds: 20, staleAfterMilliseconds: 60_000,
    host: "this-host", processId: 1000, isRunning: () => true, log: () => {},
  });
}

/** Waits until what a test expects to happen has happened; how long it takes depends on the machine's load. */
async function until(happened: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!happened()) {
    if (Date.now() >= deadline) throw new Error(`Nothing happened within 10 s: ${happened.toString()}`);
    await tick(5);
  }
}

/** A lane served by an agent whose commands run until the test ends them. */
class HeldRemote implements RemoteLane {
  readonly started: string[] = [];
  identityRequests = 0;
  private readonly ends = new Map<string, () => void>();

  constructor(private readonly who: LaneIdentity) {}

  async identity(): Promise<LaneIdentity> {
    this.identityRequests++;
    return this.who;
  }

  run(command: LaneCommand): Promise<number> {
    this.started.push(command.label);
    return new Promise((resolve) => this.ends.set(command.label, () => resolve(0)));
  }

  end(label: string): void {
    const end = this.ends.get(label);
    if (end === undefined) throw new Error(`${label} is not running here`);
    end();
  }
}

/** Two agent lanes, `vm` before `desktop`, whose flags the control file in `loop` sets. */
function twoLanes() {
  const root = folder();
  const loop = join(root, "loop");
  const vm = new HeldRemote({ host: "vm", user: "runner" });
  const desktop = new HeldRemote({ host: "this-host", user: "me" });
  const definitions: LaneDefinition[] = [
    { name: "vm", kind: "agent", folder: join(root, "vm"), rider: null },
    { name: "desktop", kind: "agent", folder: join(root, "desktop"), rider: null },
  ];
  const lines: string[] = [];
  const pool = new LanePool([
    { name: "vm", lock: lock("vm", join(root, "vm.lock")), remote: vm },
    { name: "desktop", lock: lock("desktop", join(root, "desktop.lock")), remote: desktop },
  ], 10, { host: "this-host", user: "workflow" }, controlFilePauses(loop, definitions, (line) => lines.push(line), now));
  const output: string[] = [];
  const host = new ProcessHostRunner(root, pool, new CpuPool(1), (text) => output.push(text));
  const capture = (name: string) => host.run({ resource: "desktop", label: `capture ${name}`, command: "dotnet", args: [name] });
  return { root, loop, vm, desktop, definitions, lines, output, capture, host };
}

test("a lane paused while it captures finishes that case and takes no new one; the other cases go one after the other to the other lane", async () => {
  const lanes = twoLanes();
  const a = lanes.capture("a");
  await until(() => lanes.vm.started.length === 1);
  deepStrictEqual(lanes.vm.started, ["capture a"]);
  setPaused(lanes.loop, "vm", true, now());
  const b = lanes.capture("b");
  await until(() => lanes.desktop.started.length === 1);
  const c = lanes.capture("c");
  await tick();
  deepStrictEqual([lanes.vm.started, lanes.desktop.started], [["capture a"], ["capture b"]]);
  // The paused lane's case runs to its end; the lane, free and paused, takes neither waiting case.
  lanes.vm.end("capture a");
  equal(await a, 0);
  await tick();
  deepStrictEqual([lanes.vm.started, lanes.desktop.started], [["capture a"], ["capture b"]]);
  lanes.desktop.end("capture b");
  equal(await b, 0);
  await until(() => lanes.desktop.started.length === 2);
  deepStrictEqual([lanes.vm.started, lanes.desktop.started], [["capture a"], ["capture b", "capture c"]]);
  lanes.desktop.end("capture c");
  equal(await c, 0);
  deepStrictEqual(lanes.output, ["[capture a] on desktop lane vm\n", "[capture b] on desktop lane desktop\n", "[capture c] on desktop lane desktop\n"]);
  // Not every lane was paused, so nobody was told so.
  deepStrictEqual(lanes.lines, []);
  // The agent lanes' flags are beside their agents, in paused.json.
  deepStrictEqual(JSON.parse(readFileSync(lanePausedPath(join(lanes.root, "vm")), "utf8")), { paused: true, updatedUtc: now().toISOString() });
  // A lane this loop set no flag for keeps whatever another loop wrote there.
  equal(existsSync(lanePausedPath(join(lanes.root, "desktop"))), false);
  // Unpaused, the lane takes commands again.
  setPaused(lanes.loop, "vm", false, now());
  const d = lanes.capture("d");
  await until(() => lanes.vm.started.length === 2);
  deepStrictEqual(lanes.vm.started, ["capture a", "capture d"]);
  lanes.vm.end("capture d");
  equal(await d, 0);
  deepStrictEqual(JSON.parse(readFileSync(lanePausedPath(join(lanes.root, "vm")), "utf8")), { paused: false, updatedUtc: now().toISOString() });
});

test("a paused lane is still asked for its identity and still runs a command that names it without taking its desktop", async () => {
  const lanes = twoLanes();
  setPaused(lanes.loop, "vm", true, now());
  // The environment reading of a capture step names every lane of the host, the paused one included.
  deepStrictEqual(lanes.host.lanes, ["vm", "desktop"]);
  const reading = lanes.host.run({ resource: "cpu", lane: "vm", label: "environment a on vm", command: "dotnet", args: [] });
  await until(() => lanes.vm.started.length === 1);
  deepStrictEqual([lanes.vm.identityRequests, lanes.desktop.identityRequests, lanes.vm.started], [1, 1, ["environment a on vm"]]);
  lanes.vm.end("environment a on vm");
  equal(await reading, 0);
});

test("while every lane is paused a case waits, says so once, does not fail, and is captured when either lane is unpaused", async () => {
  const lanes = twoLanes();
  setPaused(lanes.loop, "vm", true, now());
  setPaused(lanes.loop, "desktop", true, now());
  let ended: number | Error | null = null;
  const a = lanes.capture("a").then((status) => {
    ended = status;
    return status;
  }, (error: Error) => {
    ended = error;
    throw error;
  });
  await until(() => lanes.lines.length === 1);
  await tick(120);
  deepStrictEqual([lanes.vm.started, lanes.desktop.started, ended], [[], [], null]);
  deepStrictEqual(lanes.lines, ["Every desktop lane (vm, desktop) is paused; the desktop command waits until one is unpaused."]);
  setPaused(lanes.loop, "desktop", false, now());
  await until(() => lanes.desktop.started.length === 1);
  deepStrictEqual([lanes.vm.started, lanes.desktop.started], [[], ["capture a"]]);
  lanes.desktop.end("capture a");
  equal(await a, 0);
  equal(lanes.lines.length, 1);
});

test("a waiting case still ends when the run is stopped, and an invalid control file fails the desktop command with a setup error that names it", async () => {
  const lanes = twoLanes();
  setPaused(lanes.loop, "vm", true, now());
  setPaused(lanes.loop, "desktop", true, now());
  const root = folder();
  const controller = new AbortController();
  const pool = new LanePool([{ name: "vm", lock: lock("vm", join(root, "vm.lock")), remote: lanes.vm }], 10, { host: "this-host", user: "workflow" },
    controlFilePauses(lanes.loop, lanes.definitions, () => {}, now));
  setTimeout(() => controller.abort(), 50);
  await rejects(pool.acquire(controller.signal), (error: Error) => error instanceof SetupError && /was stopped/.test(error.message));
  writeFileSync(controlPath(lanes.loop), "{}");
  await rejects(lanes.capture("a"), (error: Error) => error instanceof SetupError && error.message.includes(controlPath(lanes.loop)));
  deepStrictEqual([lanes.vm.started, lanes.desktop.started], [[], []]);
  ok(!existsSync(join(lanes.root, "vm.lock")));
});
