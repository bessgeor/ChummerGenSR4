import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { CpuPool } from "../src/host/cpu-pool.js";
import { DesktopLane, type DesktopLaneSettings } from "../src/host/desktop-lane.js";
import { ProcessHostRunner, type HostCommand, type HostRunner } from "../src/host/host-runner.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { SetupError } from "../src/host/setup-error.js";
import { laneDefinitions, LanesSchema } from "../src/lanes/lane-settings.js";
import { LanePool, type HostLane } from "../src/lanes/lane-pool.js";
import type { LaneCommand, LaneIdentity, RemoteLane } from "../src/lanes/remote-lane.js";
import { ProfileSchema } from "../src/options/profile.js";
import { workflowPaths } from "../src/paths.js";
import { readEnvironmentFingerprint } from "../src/steps/capture-step.js";

function folder(): string {
  return mkdtempSync(join(tmpdir(), "workflow-lanes-"));
}

function lock(name: string, path: string, lines: string[] = []): DesktopLane {
  const settings: DesktopLaneSettings = {
    name, lockPath: path, pollMilliseconds: 10, unreadableTimeoutMilliseconds: 100, heartbeatMilliseconds: 20, staleAfterMilliseconds: 60_000,
    host: "this-host", processId: 1000, isRunning: () => true, log: (line) => lines.push(line),
  };
  return new DesktopLane(settings);
}

function holdLock(path: string, processId: number): void {
  writeFileSync(path, JSON.stringify({ host: "this-host", processId, startedUtc: "2026-01-01T00:00:00Z", token: `other-${processId}` }));
}

/** A lane served elsewhere: records its commands and answers with its identity. */
class FakeRemote implements RemoteLane {
  readonly commands: { command: LaneCommand; workingFolder: string }[] = [];
  identities = 0;

  constructor(private readonly who: LaneIdentity | Error, private readonly status = 0) {}

  async identity(): Promise<LaneIdentity> {
    this.identities++;
    if (this.who instanceof Error) throw this.who;
    return this.who;
  }

  async run(command: LaneCommand, workingFolder: string, write: (text: string) => void): Promise<number> {
    this.commands.push({ command, workingFolder });
    write(`[${command.label}] remote\n`);
    return this.status;
  }
}

const me: LaneIdentity = { host: "this-host", user: "me" };

test("the profile's lanes: one local lane by default, and invalid sets of lanes are refused", () => {
  deepStrictEqual(laneDefinitions(undefined), [{ name: "desktop", kind: "local" }]);
  deepStrictEqual(laneDefinitions(LanesSchema.parse([{ name: "here" }, { name: "vm-1", agent: "lanes/vm1" }])), [
    { name: "here", kind: "local" }, { name: "vm-1", kind: "agent", folder: resolve("lanes/vm1"), rider: null },
  ]);
  const problems = (lanes: unknown) => {
    const parsed = ProfileSchema.safeParse({ lanes });
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  };
  ok(problems([{ name: "a" }, { name: "b" }]).some((message) => message.includes("only one lane may be this machine's desktop")));
  ok(problems([{ name: "a", agent: "x" }, { name: "a", agent: "y" }]).some((message) => message.includes("two lanes are named a")));
  ok(problems([{ name: "a", agent: "x" }, { name: "b", agent: "X" }]).some((message) => message.includes("same agent folder")));
  ok(problems([{ name: "a", rider: { endpoint: "http://127.0.0.1:64482/stream", rootFolder: "r", configuration: "Lane agent" } }])
    .some((message) => message.includes("has rider but no agent folder")));
  ok(problems([{ name: "Bad Name" }]).length > 0);
  ok(problems([]).length > 0);
  deepStrictEqual(problems([{ name: "here" }, { name: "vm", agent: "x", rider: { endpoint: "http://127.0.0.1:64482/stream", rootFolder: "r", configuration: "Lane agent" } }]), []);
});

test("a desktop command takes the first free lane in order and prints it", async () => {
  const root = folder();
  holdLock(join(root, "a.lock"), 42);
  const remote = new FakeRemote({ host: "vm", user: "runner" }, 1);
  const pool = new LanePool([
    { name: "a", lock: lock("a", join(root, "a.lock")), remote: null },
    { name: "b", lock: lock("b", join(root, "b.lock")), remote },
  ], 10, me);
  const output: string[] = [];
  const host = new ProcessHostRunner(root, pool, new CpuPool(1), (text) => output.push(text));
  deepStrictEqual(host.lanes, ["a", "b"]);
  equal(await host.run({ resource: "desktop", label: "capture x", command: "dotnet", args: ["Parity.Capture.dll"] }), 1);
  deepStrictEqual(output, ["[capture x] on desktop lane b\n", "[capture x] remote\n"]);
  deepStrictEqual(remote.commands.map((entry) => [entry.command.desktop, entry.workingFolder, [...entry.command.args]]), [[true, root, ["Parity.Capture.dll"]]]);
  equal(existsSync(join(root, "b.lock")), false);
  equal(JSON.parse(readFileSync(join(root, "a.lock"), "utf8")).processId, 42);
});

test("two desktop commands run on two lanes at the same time, and a third waits for one of them", async () => {
  const root = folder();
  const lines: string[] = [];
  const pool = new LanePool([
    { name: "a", lock: lock("a", join(root, "a.lock"), lines), remote: null },
    { name: "b", lock: lock("b", join(root, "b.lock"), lines), remote: null },
  ], 10, me);
  const held = [await pool.acquire(), await pool.acquire()];
  deepStrictEqual(held.map((entry) => entry.lane.name), ["a", "b"]);
  lines.length = 0;
  let third: string | null = null;
  const waiting = pool.acquire().then((entry) => {
    third = entry.lane.name;
    return entry;
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  equal(third, null);
  // Each lane's owner is announced once, however often the pool tries it.
  deepStrictEqual(lines.map((line) => line.split(",")[0]), ["Waiting for desktop lane a", "Waiting for desktop lane b"]);
  await held[1]!.release();
  const next = await waiting;
  equal(next.lane.name, "b");
  await next.release();
  await held[0]!.release();
});

test("waiting for a lane ends when the run is stopped", async () => {
  const root = folder();
  holdLock(join(root, "a.lock"), 42);
  const pool = new LanePool([{ name: "a", lock: lock("a", join(root, "a.lock")), remote: null }], 10, me);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await rejects(pool.acquire(controller.signal), (error: Error) => error instanceof SetupError && /was stopped/.test(error.message));
});

test("a cpu command that names a lane runs on that lane without its lock; one that names none runs here", async () => {
  const root = folder();
  const remote = new FakeRemote({ host: "vm", user: "runner" }, 0);
  holdLock(join(root, "b.lock"), 42);
  const pool = new LanePool([
    { name: "a", lock: lock("a", join(root, "a.lock")), remote: null },
    { name: "b", lock: lock("b", join(root, "b.lock")), remote },
  ], 10, me);
  const output: string[] = [];
  const host = new ProcessHostRunner(root, pool, new CpuPool(1), (text) => output.push(text));
  equal(await host.run({ resource: "cpu", lane: "b", label: "environment", command: "dotnet", args: [] }), 0);
  equal(remote.commands[0]!.command.desktop, false);
  equal(await host.run({ resource: "cpu", lane: "a", label: "here", command: process.execPath, args: ["-e", "process.exit(4)"] }), 4);
  equal(await host.run({ resource: "cpu", label: "plain", command: process.execPath, args: ["-e", "process.exit(5)"] }), 5);
  equal(remote.commands.length, 1);
  equal(existsSync(join(root, "a.lock")), false);
});

test("two lanes of one user on one host are a setup error before any command, checked once", async () => {
  const root = folder();
  const twin = new FakeRemote({ host: "THIS-HOST", user: "Me" });
  const pool = new LanePool([
    { name: "a", lock: lock("a", join(root, "a.lock")), remote: null },
    { name: "b", lock: lock("b", join(root, "b.lock")), remote: twin },
  ], 10, me);
  const host = new ProcessHostRunner(root, pool, new CpuPool(1), () => {});
  await rejects(host.run({ resource: "desktop", label: "x", command: "dotnet", args: [] }),
    (error: Error) => error instanceof SetupError && error.message.includes("Desktop lanes a and b both run as Me on THIS-HOST"));
  await rejects(host.run({ resource: "cpu", lane: "a", label: "y", command: "dotnet", args: [] }), SetupError);
  equal(twin.identities, 1);
  equal(twin.commands.length, 0);

  const distinct = new FakeRemote({ host: "vm", user: "me" });
  const good = new LanePool([{ name: "a", lock: lock("a", join(root, "c.lock")), remote: null }, { name: "b", lock: lock("b", join(root, "d.lock")), remote: distinct }], 10, me);
  await good.check();
  await good.check();
  equal(distinct.identities, 1);

  const down = new LanePool([{ name: "b", lock: lock("b", join(root, "e.lock")), remote: new FakeRemote(new SetupError("The lane agent of desktop lane b is not running")) }], 10, me);
  await rejects(down.check(), /not running/);
});

/** A host whose lanes report scripted environment fingerprints. */
function fingerprintHost(fingerprints: Record<string, string>): HostRunner & { commands: HostCommand[] } {
  const commands: HostCommand[] = [];
  return {
    lanes: Object.keys(fingerprints),
    commands,
    async run(command) {
      commands.push(command);
      const file = command.args[command.args.indexOf("--environment-fingerprint-file") + 1]!;
      const lane = command.resource === "cpu" ? command.lane ?? "" : "";
      writeFileSync(file, `${fingerprints[lane]}\n`);
      return 0;
    },
  };
}

test("the environment fingerprint is read on every lane, in the lane scratch folder, and must be the same on all", async () => {
  const root = folder();
  const paths = workflowPaths(root);
  const same = fingerprintHost({ a: "a".repeat(64), b: "a".repeat(64) });
  equal(await readEnvironmentFingerprint(paths, same, createScratchFolder, "environment x"), "a".repeat(64));
  deepStrictEqual(same.commands.map((command) => [command.resource, command.resource === "cpu" ? command.lane : null, command.label]),
    [["cpu", "a", "environment x on a"], ["cpu", "b", "environment x on b"]]);
  ok(same.commands.every((command) => command.args.at(-1)!.startsWith(paths.laneScratch)));

  const different = fingerprintHost({ a: "a".repeat(64), b: "b".repeat(64) });
  await rejects(readEnvironmentFingerprint(paths, different, createScratchFolder, "environment x"),
    (error: Error) => error instanceof SetupError && error.message.includes(`a ${"a".repeat(64)}, b ${"b".repeat(64)}`));

  const one = fingerprintHost({ desktop: "c".repeat(64) });
  equal(await readEnvironmentFingerprint(paths, one, createScratchFolder, "environment thread"), "c".repeat(64));
  equal(one.commands[0]!.label, "environment thread");
});

test("a lane that is not in the pool is a programming error", () => {
  const lanes: HostLane[] = [{ name: "a", lock: lock("a", join(folder(), "a.lock")), remote: null }];
  const pool = new LanePool(lanes, 10, me);
  equal(pool.lane("a"), lanes[0]);
  let thrown: unknown = null;
  try {
    pool.lane("z");
  } catch (error) {
    thrown = error;
  }
  ok(thrown instanceof Error && !(thrown instanceof SetupError));
});
