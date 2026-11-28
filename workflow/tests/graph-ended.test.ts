import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { Annotation, Command, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { graphEnded } from "../src/graph/graph-ended.js";
import { loopControlKey, pausable, setPaused } from "../src/loop/loop-control.js";
import { scratch } from "./diagnosis-fixtures.js";

test("a graph whose resumed node failed and was interrupted again has not ended, though no node is listed as next", async () => {
  const folder = scratch("workflow-graph-ended-");
  const pause = (paused: boolean) => setPaused(folder, null, paused, new Date("2026-11-01T10:00:00Z"));
  let fail = true;
  const state = Annotation.Root({ done: Annotation<boolean>() });
  const graph = new StateGraph(state)
    .addNode("step", pausable(() => {
      if (fail) throw new Error("the step failed");
      return { done: true };
    }))
    .addEdge(START, "step")
    .addEdge("step", END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "t-1", [loopControlKey]: folder }, durability: "sync" as const };
  pause(true);
  await graph.invoke({ done: false }, config);
  pause(false);
  await rejects(graph.invoke(new Command({ resume: true }), config), /the step failed/);
  // Interrupted once more: the node takes the value it was resumed with before and finds the loop paused again.
  pause(true);
  await graph.invoke(null, config);
  const interrupted = await graph.getState(config);
  deepStrictEqual([interrupted.next, interrupted.tasks.map((task) => task.name), graphEnded(interrupted)], [[], ["step"], false]);
  pause(false);
  fail = false;
  equal((await graph.invoke(null, config)).done, true);
  equal(graphEnded(await graph.getState(config)), true);
});
