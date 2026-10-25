import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renameWithRetry } from "../src/host/rename-with-retry.js";
import { scratch } from "./diagnosis-fixtures.js";

function failing(codes: readonly (string | null)[]) {
  const calls: string[] = [];
  let index = 0;
  const rename = (from: string, to: string) => {
    calls.push(`${from}->${to}`);
    const code = codes[index++];
    if (code === undefined || code === null) return;
    throw Object.assign(new Error(`${code}: rename`), { code });
  };
  return { calls, rename };
}

test("a rename that fails with a transient lock error is tried again with a doubling wait", () => {
  const sleeps: number[] = [];
  const { calls, rename } = failing(["EPERM", "EBUSY", "EACCES", null]);
  renameWithRetry("a", "b", { rename, sleep: (ms) => sleeps.push(ms) });
  equal(calls.length, 4);
  deepStrictEqual(sleeps, [50, 100, 200]);
});

test("another error is thrown at once, and a lock that outlasts every try is thrown", () => {
  const sleeps: number[] = [];
  const other = failing(["ENOENT"]);
  throws(() => renameWithRetry("a", "b", { rename: other.rename, sleep: (ms) => sleeps.push(ms) }), /ENOENT/);
  equal(other.calls.length, 1);
  const locked = failing(["EPERM", "EPERM", "EPERM"]);
  throws(() => renameWithRetry("a", "b", { attempts: 3, rename: locked.rename, sleep: (ms) => sleeps.push(ms) }), /EPERM/);
  equal(locked.calls.length, 3);
  deepStrictEqual(sleeps, [50, 100]);
});

test("a folder is renamed on disk", () => {
  const root = scratch("workflow-rename-");
  mkdirSync(join(root, "v1.partial"));
  writeFileSync(join(root, "v1.partial", "dataset.json"), "{}");
  renameWithRetry(join(root, "v1.partial"), join(root, "v1"));
  equal(existsSync(join(root, "v1.partial")), false);
  equal(readFileSync(join(root, "v1", "dataset.json"), "utf8"), "{}");
});
