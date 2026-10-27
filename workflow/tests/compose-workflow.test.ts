import { equal, ok, throws } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import Database from "better-sqlite3";
import { composeWorkflow } from "../src/compose-workflow.js";
import { workflowPaths } from "../src/paths.js";

test("the composed workflow runs threads of its checkpointer until it is closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-compose-"));
  const lines: string[] = [];
  const workflow = composeWorkflow(root, {}, (line) => lines.push(line));
  try {
    ok(existsSync(workflowPaths(root).checkpoints));
    equal(await workflow.run({ kind: "resume", threadId: "wf-unknown" }), 3);
    ok(lines.some((line) => line.includes("There is no thread wf-unknown to resume.")), lines.join("\n"));
    equal(await workflow.run({ kind: "resume", threadId: "wf-other" }), 3);
    ok(lines.some((line) => line.includes("There is no thread wf-other to resume.")), lines.join("\n"));
  } finally {
    workflow.close();
  }
  // Closed: its checkpoint database is closed.
  lines.length = 0;
  equal(await workflow.run({ kind: "resume", threadId: "wf-unknown" }), 3);
  ok(lines.some((line) => line.startsWith("Setup error:") && line.includes("not open")), lines.join("\n"));
});

test("the checkpoint database is closed when the rest of the composition cannot be opened", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-compose-"));
  // A folder where the store's database belongs: the store cannot open after the checkpoint database did.
  mkdirSync(workflowPaths(root).store, { recursive: true });
  const close = mock.method(Database.prototype, "close");
  try {
    throws(() => composeWorkflow(root, {}, () => undefined));
    equal(close.mock.callCount(), 1);
  } finally {
    close.mock.restore();
  }
});
