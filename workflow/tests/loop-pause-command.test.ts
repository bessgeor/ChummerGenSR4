import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { controlPath, LanePausedSchema, lanePausedPath, readControl } from "../src/loop/loop-control.js";
import { parseLoopArguments } from "../src/loop-driver/loop-arguments.js";
import { loopPaths, writeLoopDocument } from "../src/loop-driver/loop-document.js";
import { pauseLoop } from "../src/loop-driver/pause-loop.js";
import { scratch } from "./diagnosis-fixtures.js";

const now = () => new Date("2026-11-01T10:00:00Z");

test("--pause and --unpause with --lane parse, and anything else beside them is a setup error", () => {
  deepStrictEqual(parseLoopArguments(["--pause", "loop-1"]), { kind: "pause", loopId: "loop-1", paused: true, lane: null });
  deepStrictEqual(parseLoopArguments(["--unpause", "loop-1", "--lane", "vm"]), { kind: "pause", loopId: "loop-1", paused: false, lane: "vm" });
  deepStrictEqual(parseLoopArguments(["--lane", "vm", "--pause", "loop-1"]), { kind: "pause", loopId: "loop-1", paused: true, lane: "vm" });
  for (const args of [["--pause"], ["--pause", "--lane", "vm"], ["--lane", "vm"], ["--pause", "loop-1", "--unpause", "loop-1"], ["--pause", "loop-1", "--max-runs", "2"],
    ["--pause", "loop-1", "--lane", "a", "--lane", "b"], ["--case", "a", "--pause", "loop-1"], ["--pause", "loop-1", "--lane"]]) {
    throws(() => parseLoopArguments(args), SetupError, args.join(" "));
  }
});

test("--pause and --unpause write the loop's flag or a lane's, and an agent lane's paused.json; an unknown loop or lane is a setup error", () => {
  const root = scratch("workflow-loop-pause-");
  const paths = loopPaths(root);
  const agentFolder = join(root, "lane-vm");
  const lanes = [{ name: "desktop", kind: "local" as const }, { name: "vm", kind: "agent" as const, folder: agentFolder, rider: null }];
  const lines: string[] = [];
  const dependencies = { paths, lanes, now, log: (line: string) => lines.push(line) };
  const loopId = "loop-20261101T100000Z-0000abcd";
  throws(() => pauseLoop({ kind: "pause", loopId, paused: true, lane: null }, dependencies), (error: Error) => error instanceof SetupError && error.message.includes(`There is no loop ${loopId}`));
  throws(() => pauseLoop({ kind: "pause", loopId: "../x", paused: true, lane: null }, dependencies), SetupError);
  writeLoopDocument(paths.document(loopId), {
    schemaVersion: 1, loopId, startedUtc: now().toISOString(), options: { arguments: [], maxRuns: null }, status: "running", iterations: [],
  });
  throws(() => pauseLoop({ kind: "pause", loopId, paused: true, lane: "other" }, dependencies),
    (error: Error) => error instanceof SetupError && error.message.includes("declares no desktop lane other; its lanes are desktop, vm"));
  equal(existsSync(controlPath(paths.folder(loopId))), false);
  equal(pauseLoop({ kind: "pause", loopId, paused: true, lane: null }, dependencies), 0);
  equal(pauseLoop({ kind: "pause", loopId, paused: true, lane: "vm" }, dependencies), 0);
  equal(pauseLoop({ kind: "pause", loopId, paused: true, lane: "desktop" }, dependencies), 0);
  deepStrictEqual(readControl(paths.folder(loopId)), { paused: true, lanes: { vm: { paused: true }, desktop: { paused: true } }, updatedUtc: now().toISOString() });
  deepStrictEqual(LanePausedSchema.parse(JSON.parse(readFileSync(lanePausedPath(agentFolder), "utf8"))), { paused: true, updatedUtc: now().toISOString() });
  equal(pauseLoop({ kind: "pause", loopId, paused: false, lane: "vm" }, dependencies), 0);
  equal(pauseLoop({ kind: "pause", loopId, paused: false, lane: null }, dependencies), 0);
  deepStrictEqual(readControl(paths.folder(loopId)), { paused: false, lanes: { vm: { paused: false }, desktop: { paused: true } }, updatedUtc: now().toISOString() });
  deepStrictEqual(JSON.parse(readFileSync(lanePausedPath(agentFolder), "utf8")), { paused: false, updatedUtc: now().toISOString() });
  deepStrictEqual(lines, [
    `Loop ${loopId} is paused: running jobs and captures finish, and nothing new starts until --unpause.`,
    `Desktop lane vm of loop ${loopId} is paused: the capture it runs finishes, and it takes no new one until --unpause.`,
    `Desktop lane desktop of loop ${loopId} is paused: the capture it runs finishes, and it takes no new one until --unpause.`,
    `Desktop lane vm of loop ${loopId} is unpaused.`,
    `Loop ${loopId} is unpaused.`,
  ]);
});
