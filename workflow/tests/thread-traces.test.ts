import { deepStrictEqual, equal } from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { threadTraces, type ThreadTraceSources } from "../src/thread-traces.js";

function sources(refs: string[]) {
  const root = mkdtempSync(join(tmpdir(), "thread-traces-"));
  const calls: string[][] = [];
  const value: ThreadTraceSources = {
    threadFolder: (threadId) => join(root, "workflow", "threads", threadId),
    discoveryThreadFolder: (threadId) => join(root, "discovery", "threads", threadId),
    git: (args) => {
      calls.push([...args]);
      return refs.join("\n");
    },
  };
  return { root, value, calls };
}

test("a thread ID nothing uses has no traces", () => {
  const { value } = sources(["accepted/wf-other", "workflow/wf-other/source", "master"]);
  deepStrictEqual(threadTraces(value, "wf-new"), []);
});

test("the folder of the thread, the folder of its discovery thread and its branches are traces, whatever the case", () => {
  const { root, value } = sources(["accepted/wf-a", "workflow/WF-A/source", "workflow/wf-b/source"]);
  mkdirSync(join(root, "workflow", "threads", "wf-a"), { recursive: true });
  mkdirSync(join(root, "discovery", "threads", "disc-wf-a"), { recursive: true });
  const traces = threadTraces(value, "WF-a");
  equal(traces.length, 4, traces.join("\n"));
  deepStrictEqual(traces.slice(2), ["the branch accepted/wf-a", "the branch workflow/WF-A/source"]);
  deepStrictEqual(threadTraces(value, "wf-b"), ["the branch workflow/wf-b/source"]);
});
