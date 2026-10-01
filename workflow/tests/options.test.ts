import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { parseArguments, type Arguments } from "../src/options/arguments.js";
import { loadProfile } from "../src/options/profile.js";
import { resolveRunOptions } from "../src/options/run-options.js";

function start(args: string[]): Arguments {
  const command = parseArguments(args);
  if (command.kind !== "start") throw new Error(`expected start, got ${command.kind}`);
  return command.arguments;
}

test("capture, compare and workflow options are parsed", () => {
  const parsed = start(["--case", "a,b", "--case", "c", "--capture", "common", "--settings-overlay", "o",
    "--threshold", "0.5", "--case-file", "f.json", "--no-ocr", "--tessdata", "t", "--only", "compare"]);
  deepStrictEqual(parsed, {
    cases: ["a", "b", "c"], captures: ["common"], settingsOverlay: "o", threshold: 0.5, caseFile: "f.json",
    canonicalCache: null, liveCanonical: false, noOcr: true, tessdata: "t", only: "compare", recapture: false, noDiagnosis: false, noRepair: false, unattended: false,
  });
});

test("options the workflow sets itself are rejected", () => {
  for (const option of ["--canonical-exe", "--candidate-exe", "--runs-dir", "--run-folder-file", "--repo-root"]) {
    throws(() => parseArguments([option, "x"]), (error: Error) => error instanceof SetupError && /set by the workflow/.test(error.message));
  }
});

test("unknown options, missing values and bad values are setup errors", () => {
  throws(() => parseArguments(["--bogus"]), SetupError);
  throws(() => parseArguments(["--case"]), SetupError);
  throws(() => parseArguments(["--case", "--no-ocr"]), SetupError);
  throws(() => parseArguments(["--threshold", "2"]), SetupError);
  throws(() => parseArguments(["--threshold", "x"]), SetupError);
  throws(() => parseArguments(["--only", "build"]), SetupError);
  throws(() => parseArguments(["--live-canonical", "--canonical-cache", "c"]), SetupError);
});

test("--recapture is a capture option and needs the capture node", () => {
  equal(start(["--recapture"]).recapture, true);
  equal(start(["--only", "capture", "--recapture"]).recapture, true);
  equal(start([]).recapture, false);
  throws(() => parseArguments(["--recapture", "--only", "compare"]), /needs the capture node/);
  throws(() => parseArguments(["--only", "triage", "--recapture"]), /needs the capture node/);
});

test("--no-diagnosis ends the run after triage and contradicts --only diagnose", () => {
  equal(start(["--no-diagnosis"]).noDiagnosis, true);
  equal(start(["--only", "diagnose"]).only, "diagnose");
  throws(() => parseArguments(["--only", "diagnose", "--no-diagnosis"]), /contradict/);
  throws(() => parseArguments(["--only", "diagnose", "--recapture"]), /needs the capture node/);
  const root = scratch();
  equal(resolveRunOptions(start(["--no-diagnosis"]), {}, { LOCALAPPDATA: root }, root).diagnosis, false);
  equal(resolveRunOptions(start([]), {}, { LOCALAPPDATA: root }, root).diagnosis, true);
});

test("--no-repair ends the run after diagnosis; the profile sets the repair deadline", () => {
  const root = scratch();
  const env = { LOCALAPPDATA: root };
  equal(start(["--no-repair"]).noRepair, true);
  equal(resolveRunOptions(start(["--no-repair"]), { repair: { deadlineMinutes: 5 } }, env, root).repair, null);
  deepStrictEqual(resolveRunOptions(start([]), {}, env, root).repair, { deadlineMinutes: 60 });
  deepStrictEqual(resolveRunOptions(start([]), { repair: { deadlineMinutes: 5 } }, env, root).repair, { deadlineMinutes: 5 });
});

test("--resume takes a thread and nothing else", () => {
  deepStrictEqual(parseArguments(["--resume", "wf-1"]), { kind: "resume", threadId: "wf-1" });
  throws(() => parseArguments(["--resume", "wf-1", "--no-ocr"]), /takes no other options/);
  throws(() => parseArguments(["--resume"]), SetupError);
});

test("--help wins over everything", () => {
  deepStrictEqual(parseArguments(["--case", "x", "--help"]), { kind: "help" });
});

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "workflow-options-"));
}

test("the canonical cache comes from the option, the environment, the profile or local app data, in that order", () => {
  const root = scratch();
  const env = { LOCALAPPDATA: join(root, "local") };
  const resolveWith = (args: string[], environment: Record<string, string>, profile = {}) =>
    resolveRunOptions(start(args), profile, environment, root);

  const option = resolveWith(["--canonical-cache", "c"], { ...env, PARITY_CANONICAL_CACHE: "e" }, { canonicalCache: "p" });
  deepStrictEqual([option.canonicalCache, option.canonicalCacheSource], [join(root, "c"), "option"]);
  const environment = resolveWith([], { ...env, PARITY_CANONICAL_CACHE: join(root, "e") }, { canonicalCache: "p" });
  deepStrictEqual([environment.canonicalCache, environment.canonicalCacheSource], [join(root, "e"), "environment"]);
  const profile = resolveWith([], env, { canonicalCache: join(root, "p") });
  deepStrictEqual([profile.canonicalCache, profile.canonicalCacheSource], [join(root, "p"), "profile"]);
  const fallback = resolveWith([], env);
  deepStrictEqual([fallback.canonicalCache, fallback.canonicalCacheSource], [join(root, "local", "ChummerGenSR4", "canonical-cache"), "default"]);
  const live = resolveWith(["--live-canonical"], { ...env, PARITY_CANONICAL_CACHE: "e" });
  deepStrictEqual([live.canonicalCache, live.canonicalCacheSource], [null, "off"]);
});

test("the command line's overlay wins over the profile's, and paths become absolute", () => {
  const root = scratch();
  const env = { LOCALAPPDATA: root };
  equal(resolveRunOptions(start(["--settings-overlay", "a"]), { settingsOverlay: "b" }, env, root).settingsOverlay, join(root, "a"));
  equal(resolveRunOptions(start([]), { settingsOverlay: "b" }, env, root).settingsOverlay, join(root, "b"));
  equal(resolveRunOptions(start([]), {}, env, root).settingsOverlay, null);
  equal(resolveRunOptions(start([]), {}, env, root).caseFile, join(root, "parity", "cases", "characters.json"));
});

test("the profile is optional, validated strictly and read from PARITY_WORKFLOW_PROFILE", () => {
  const root = scratch();
  deepStrictEqual(loadProfile({ LOCALAPPDATA: root }), {});
  const path = join(root, "profile.json");
  writeFileSync(path, JSON.stringify({ canonicalCache: "c", cpuPool: 2 }));
  deepStrictEqual(loadProfile({ PARITY_WORKFLOW_PROFILE: path }), { canonicalCache: "c", cpuPool: 2 });
  writeFileSync(path, JSON.stringify({ cpuPool: 0 }));
  throws(() => loadProfile({ PARITY_WORKFLOW_PROFILE: path }), SetupError);
  writeFileSync(path, JSON.stringify({ unknown: true }));
  throws(() => loadProfile({ PARITY_WORKFLOW_PROFILE: path }), SetupError);
  writeFileSync(path, "{");
  throws(() => loadProfile({ PARITY_WORKFLOW_PROFILE: path }), SetupError);
});

test("local app data is required when nothing else names the cache", () => {
  throws(() => resolveRunOptions(start([]), {}, {}, scratch()), /LOCALAPPDATA/);
});
