import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ClusterDiagnosis } from "../src/diagnosis/cluster-diagnosis.js";
import { setPaused, type PauseGate } from "../src/loop/loop-control.js";
import type { OutcomeDocument } from "../src/loop/outcome.js";
import { scratch } from "./diagnosis-fixtures.js";
import { challengeAnswer, diagnosisHarness, FakeAgents, hypothesisAnswer, twoClusters } from "./diagnosis-harness.js";

const at = new Date("2026-11-01T10:00:00Z");

function outcomeOf(root: string, threadId: string): OutcomeDocument {
  return JSON.parse(readFileSync(join(root, "threads", threadId, "outcome.json"), "utf8")) as OutcomeDocument;
}

test("a loop paused while hypothesis jobs run: the jobs finish and are recorded, the next node is interrupted, and the challenges start after the unpause", async () => {
  const loopFolder = scratch("workflow-loop-folder-");
  let pauses = 0;
  const agents = new FakeAgents((call) => {
    // The pause is set once, while the hypothesis jobs run.
    if (call.kind === "hypothesis" && pauses++ === 0) setPaused(loopFolder, null, true, at);
    return { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() };
  });
  const harness = diagnosisHarness({ spots: twoClusters, agents });
  const seen: { stage: string | undefined; interrupted: boolean; clusters: string[] }[] = [];
  const gate: PauseGate = {
    folder: loopFolder, log: (line) => harness.lines.push(line), pollMilliseconds: 1,
    sleep: async () => {
      agents.events.push("paused");
      const threadId = harness.threadId();
      const snapshot = await harness.graph.getState({ configurable: { thread_id: threadId } }, { subgraphs: true });
      const stage = snapshot.tasks[0];
      const inner = (await harness.state(threadId)).clusters as Record<string, ClusterDiagnosis>;
      seen.push({
        stage: stage?.name, interrupted: snapshot.tasks.some((task) => task.interrupts.length > 0),
        clusters: Object.values(inner).map((cluster) => `${cluster.status} ${cluster.records.length}`),
      });
      setPaused(loopFolder, null, false, at);
    },
  };
  equal(await harness.start({}, gate), 1, harness.lines.join("\n"));
  // The diagnosis stage is interrupted with both hypotheses recorded and no challenge started.
  deepStrictEqual(seen, [{ stage: "diagnose", interrupted: true, clusters: ["hypothesized 1", "hypothesized 1"] }]);
  const paused = agents.events.indexOf("paused");
  deepStrictEqual(agents.events.slice(0, paused).map((event) => event.split(" ")[0]), ["hypothesis", "hypothesis", "hypothesis", "hypothesis"]);
  deepStrictEqual(agents.events.slice(paused + 1).map((event) => event.split(" ")[0]), ["challenge", "challenge", "challenge", "challenge"]);
  // No finished job ran again.
  deepStrictEqual(agents.calls.map((call) => call.kind).sort(), ["challenge", "challenge", "hypothesis", "hypothesis"]);
  const threadId = harness.threadId();
  ok(harness.lines.includes(`Thread ${threadId} is paused; it goes on once the loop is unpaused (npm run loop -- --unpause).`), harness.lines.join("\n"));
  ok(harness.lines.includes(`Thread ${threadId} goes on: the loop is unpaused.`), harness.lines.join("\n"));
  deepStrictEqual(Object.values((await harness.state(threadId)).clusters as Record<string, ClusterDiagnosis>).map((cluster) => cluster.status), ["challenged", "challenged"]);
});

test("a thread with a 60 min run budget paused for 90 min between two jobs: the second job starts, and only the jobs' model time is charged", async () => {
  const loopFolder = scratch("workflow-loop-folder-");
  const agents = new FakeAgents((call) => {
    if (call.kind === "hypothesis") setPaused(loopFolder, null, true, at);
    return { answer: call.kind === "hypothesis" ? hypothesisAnswer() : challengeAnswer() };
  }, Number.POSITIVE_INFINITY, 25 * 60_000);
  const harness = diagnosisHarness({ spots: [twoClusters[0]!], agents, budgetMinutes: 60 });
  // The pause's clock: it starts at 12:10 and the unpause comes 90 minutes later.
  const clock = [new Date("2026-10-01T12:10:00Z"), new Date("2026-10-01T13:40:00Z")];
  const gate: PauseGate = {
    folder: loopFolder, log: (line) => harness.lines.push(line), pollMilliseconds: 1, now: () => clock.shift()!,
    sleep: async () => {
      setPaused(loopFolder, null, false, at);
    },
  };
  equal(await harness.start({}, gate), 1, harness.lines.join("\n"));
  deepStrictEqual(agents.calls.map((call) => call.kind), ["hypothesis", "challenge"]);
  const [cluster] = Object.values((await harness.state(harness.threadId())).clusters as Record<string, ClusterDiagnosis>);
  equal(cluster!.status, "challenged");
  const outcome = outcomeOf(harness.root, harness.threadId());
  // The thread started at 12:00 and concluded at 14:00; 90 of those minutes it was paused.
  deepStrictEqual([outcome.measures.modelMilliseconds, outcome.measures.pausedMilliseconds, outcome.measures.elapsedMilliseconds], [50 * 60_000, 90 * 60_000, 30 * 60_000]);
  deepStrictEqual(JSON.parse(readFileSync(join(harness.root, "threads", harness.threadId(), "pauses.json"), "utf8")), {
    pauses: [{ startedUtc: "2026-10-01T12:10:00.000Z", endedUtc: "2026-10-01T13:40:00.000Z", milliseconds: 90 * 60_000 }],
  });
  ok(harness.lines.some((line) => line.startsWith("Outcome:") && line.includes("paused 90")), harness.lines.join("\n"));
});

test("a thread run without a loop records no pause and its elapsed time is the whole time", async () => {
  const harness = diagnosisHarness({ spots: [twoClusters[0]!] });
  equal(await harness.start(), 1);
  const outcome = outcomeOf(harness.root, harness.threadId());
  deepStrictEqual([outcome.measures.pausedMilliseconds, outcome.measures.elapsedMilliseconds], [0, 2 * 60 * 60_000]);
});
