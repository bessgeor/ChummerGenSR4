import { deepStrictEqual } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { writeDocument } from "../src/steps/write-document.js";
import { scratch } from "./diagnosis-fixtures.js";

test("a state file is replaced whole through a temporary file that is not left behind", () => {
  const folder = join(scratch("workflow-write-"), "state");
  const path = join(folder, "ledger.json");
  writeDocument(path, { schemaVersion: 1, exposures: [] });
  writeDocument(path, { schemaVersion: 1, exposures: [{ candidate: "tuned-0" }] });
  deepStrictEqual(JSON.parse(readFileSync(path, "utf8")), { schemaVersion: 1, exposures: [{ candidate: "tuned-0" }] });
  deepStrictEqual(readdirSync(folder), ["ledger.json"]);
});
